import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptRequestId, configureLogging, createLogger, resolveLogFormat, type LogLevel } from '../src/observability/logging.js';

describe('resolveLogFormat (REV-220)', () => {
  it('uses JSON in production and text elsewhere unless LOG_FORMAT says otherwise', () => {
    expect(resolveLogFormat({ NODE_ENV: 'production' })).toBe('json');
    expect(resolveLogFormat({ NODE_ENV: 'development' })).toBe('text');
    expect(resolveLogFormat({})).toBe('text');
    expect(resolveLogFormat({ NODE_ENV: 'production', LOG_FORMAT: 'text' })).toBe('text');
    expect(resolveLogFormat({ NODE_ENV: 'development', LOG_FORMAT: 'JSON' })).toBe('json');
    expect(resolveLogFormat({ NODE_ENV: 'production', LOG_FORMAT: 'xml' })).toBe('json');
  });
});

describe('createLogger (REV-220)', () => {
  const capture = () => {
    const lines: Array<{ level: LogLevel; line: string }> = [];
    return { lines, write: (level: LogLevel, line: string) => lines.push({ level, line }) };
  };
  const now = () => new Date('2026-11-23T10:00:00.000Z');

  it('writes one JSON object per call with time, level, service and msg', () => {
    const { lines, write } = capture();
    createLogger({ service: 'api', write, now }).info('Server started', { port: 4000 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.line)).toEqual({ port: 4000, time: '2026-11-23T10:00:00.000Z', level: 'info', service: 'api', msg: 'Server started' });
  });

  it('moves a bracketed prefix into the component field', () => {
    const { lines, write } = capture();
    createLogger({ service: 'workers', write, now }).warn('[Redis Connection Error]: down');
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: 'warn', component: 'Redis Connection Error', msg: 'down' });
  });

  it('does not let a caller overwrite the reserved fields', () => {
    const { lines, write } = capture();
    createLogger({ service: 'api', write, now }).info('hello', { level: 'fatal', service: 'evil', msg: 'forged', time: 'never' });
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: 'info', service: 'api', msg: 'hello', time: '2026-11-23T10:00:00.000Z' });
  });

  it('keeps a message on one line even when it contains quotes and newlines', () => {
    const { lines, write } = capture();
    createLogger({ service: 'api', write, now }).error('bad "thing"\nsecond line');
    expect(lines[0]!.line).not.toContain('\n');
    expect(JSON.parse(lines[0]!.line).msg).toBe('bad "thing"\nsecond line');
  });

  it('prints readable text in text mode', () => {
    const { lines, write } = capture();
    createLogger({ service: 'api', format: 'text', write, now }).info('[API] up', { port: 1 });
    expect(lines[0]!.line).toBe('[API] up {"port":1}');
  });
});

describe('configureLogging (REV-220)', () => {
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  afterEach(() => {
    Object.assign(console, saved);
    delete (console as unknown as Record<symbol, unknown>)[Symbol.for('revamp.logging.configured')];
    vi.restoreAllMocks();
  });

  it('routes console calls through the JSON writer with the right levels', () => {
    const out: Array<{ level: LogLevel; line: string }> = [];
    configureLogging('workers', { format: 'json', write: (level, line) => out.push({ level, line }) });
    console.log('[Workers] ready %d', 3);
    console.warn('careful');
    console.error('failed', new Error('boom').message);
    expect(out.map((o) => o.level)).toEqual(['info', 'warn', 'error']);
    expect(JSON.parse(out[0]!.line)).toMatchObject({ service: 'workers', component: 'Workers', msg: 'ready 3' });
    expect(JSON.parse(out[2]!.line).msg).toBe('failed boom');
  });

  it('leaves the console alone in text mode', () => {
    configureLogging('api', { format: 'text' });
    expect(console.log).toBe(saved.log);
  });

  it('is safe to call twice', () => {
    const out: string[] = [];
    configureLogging('api', { format: 'json', write: (_l, line) => out.push(line) });
    configureLogging('api', { format: 'json', write: (_l, line) => out.push(line) });
    console.log('once');
    expect(out).toHaveLength(1);
  });
});

describe('acceptRequestId (REV-220)', () => {
  it('keeps a short safe id and replaces anything else', () => {
    expect(acceptRequestId('abc-123_X.y', () => 'new')).toBe('abc-123_X.y');
    expect(acceptRequestId('a'.repeat(65), () => 'new')).toBe('new');
    expect(acceptRequestId('has space', () => 'new')).toBe('new');
    expect(acceptRequestId('line\nbreak', () => 'new')).toBe('new');
    expect(acceptRequestId(undefined, () => 'new')).toBe('new');
    expect(acceptRequestId(['x'], () => 'new')).toBe('new');
  });
});
