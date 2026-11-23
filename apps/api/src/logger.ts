import { createLogger, resolveLogFormat } from '@revamp/db';

/** The API's structured logger (REV-220). Tests stay quiet; the console of the process is routed through the same writer in index.ts. */
export const logger = createLogger({
  service: 'api',
  format: resolveLogFormat(),
  ...(process.env.NODE_ENV === 'test' ? { write: () => undefined } : {}),
});
