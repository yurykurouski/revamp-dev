// ==============================================================================
// Structured logging (REV-220)
// ==============================================================================
// One JSON object per line on stdout (info, debug) or stderr (warn, error), so `docker logs` output can be
// shipped to any log collector and filtered by field. The apps log with plain `console.*`; `configureLogging`
// routes those calls through the same writer instead of rewriting every call site.
import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'text';

export interface LogFields {
  [key: string]: unknown;
}

/** The format the environment asks for: `LOG_FORMAT=json|text`, else JSON in production and text elsewhere */
export function resolveLogFormat(env: NodeJS.ProcessEnv = process.env): LogFormat {
  const wanted = (env.LOG_FORMAT ?? '').trim().toLowerCase();
  if (wanted === 'json' || wanted === 'text') return wanted;
  return env.NODE_ENV === 'production' ? 'json' : 'text';
}

type Sink = (line: string) => void;

export interface LoggerOptions {
  service: string;
  format?: LogFormat;
  /** Injected in tests; defaults to stdout for info and debug, stderr for warn and error */
  write?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

const defaultWrite = (level: LogLevel, line: string): void => {
  const sink: Sink = level === 'warn' || level === 'error' ? (l) => process.stderr.write(l) : (l) => process.stdout.write(l);
  sink(`${line}\n`);
};

/** `[API] Connecting…` carries its component in a bracketed prefix: move it into a field */
const PREFIX = /^\[([^\]\n]{1,40})\]:?\s*/;

export interface Logger {
  log: (level: LogLevel, message: string, fields?: LogFields) => void;
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
}

export function createLogger({ service, format: fmt = 'json', write = defaultWrite, now = () => new Date() }: LoggerOptions): Logger {
  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    const prefix = PREFIX.exec(message);
    const component = prefix?.[1];
    const text = prefix ? message.slice(prefix[0].length) : message;
    if (fmt === 'text') {
      const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
      write(level, `${prefix ? `[${component}] ` : ''}${text}${extra}`);
      return;
    }
    // Reserved fields come last so a caller cannot overwrite them
    write(level, JSON.stringify({ ...fields, time: now().toISOString(), level, service, ...(component ? { component } : {}), msg: text }));
  };
  return {
    log,
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}

const CONFIGURED = Symbol.for('revamp.logging.configured');

/**
 * Routes `console.log/info/debug/warn/error` of this process through a logger, so every existing log call
 * becomes a structured line. Call it once, first thing. Returns the logger for the code that wants fields.
 */
export function configureLogging(service: string, options: { format?: LogFormat; write?: LoggerOptions['write'] } = {}): Logger {
  const logger = createLogger({ service, format: options.format ?? resolveLogFormat(), ...(options.write ? { write: options.write } : {}) });
  const target = console as unknown as Record<symbol, boolean>;
  if (options.format === 'text' || (options.format === undefined && resolveLogFormat() === 'text')) {
    // Text mode keeps the console as it is: readable output for a terminal
    return logger;
  }
  if (target[CONFIGURED]) return logger;
  target[CONFIGURED] = true;
  const send = (level: LogLevel) => (...args: unknown[]) => logger.log(level, format(...args));
  console.log = send('info');
  console.info = send('info');
  console.debug = send('debug');
  console.warn = send('warn');
  console.error = send('error');
  return logger;
}

/** A client-supplied request id is kept when it is short and made of safe characters; otherwise a new one is used */
export function acceptRequestId(candidate: unknown, generate: () => string): string {
  return typeof candidate === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(candidate) ? candidate : generate();
}
