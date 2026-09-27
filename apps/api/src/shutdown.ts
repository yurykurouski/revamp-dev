import type { Server } from 'node:http';

/** How long in-flight requests get to finish before their sockets are destroyed */
export const SERVER_DRAIN_TIMEOUT_MS = 5_000;
/** Hard limit for the whole shutdown, below Docker's default 10s stop grace period */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

export interface ShutdownDeps {
  server: Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
  closeQueues: () => Promise<void>;
  closeRedis: () => Promise<unknown>;
  disconnectMongo: () => Promise<void>;
  exit: (code: number) => void;
  logger?: Pick<Console, 'log' | 'error'>;
  drainTimeoutMs?: number;
  timeoutMs?: number;
}

/**
 * Stops accepting requests, then releases the queues, Redis and MongoDB, and exits (REV-66).
 * Keep-alive sockets are closed so `server.close` can't hang, and a hard timeout forces the
 * exit if any step stalls.
 */
export function createShutdown({
  server,
  closeQueues,
  closeRedis,
  disconnectMongo,
  exit,
  logger = console,
  drainTimeoutMs = SERVER_DRAIN_TIMEOUT_MS,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
}: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;

  const closeServer = () =>
    new Promise<void>((resolve) => {
      const drainTimer = setTimeout(() => server.closeAllConnections(), drainTimeoutMs);
      // The callback's error only means the server wasn't listening, which is fine here
      server.close(() => {
        clearTimeout(drainTimer);
        resolve();
      });
      server.closeIdleConnections();
    });

  return async (signal: string) => {
    if (started) return;
    started = true;
    logger.log(`[API] Received ${signal}. Closing server gracefully...`);

    const forceExit = setTimeout(() => {
      logger.error(`[API] Shutdown did not finish within ${timeoutMs}ms, forcing exit.`);
      exit(1);
    }, timeoutMs);
    forceExit.unref?.();

    try {
      await closeServer();
      await closeQueues();
      await closeRedis();
      await disconnectMongo();
      logger.log('[API] Server closed; queues, Redis and MongoDB disconnected.');
      clearTimeout(forceExit);
      exit(0);
    } catch (error) {
      logger.error('[API] Error during shutdown:', error);
      clearTimeout(forceExit);
      exit(1);
    }
  };
}
