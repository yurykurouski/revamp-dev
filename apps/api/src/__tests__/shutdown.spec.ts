import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShutdown, SHUTDOWN_TIMEOUT_MS, SERVER_DRAIN_TIMEOUT_MS } from '../shutdown.js';

describe('createShutdown (REV-66)', () => {
  let calls: string[];
  let closeCallback: (() => void) | undefined;
  let server: { close: ReturnType<typeof vi.fn>; closeIdleConnections: ReturnType<typeof vi.fn>; closeAllConnections: ReturnType<typeof vi.fn> };
  let deps: Parameters<typeof createShutdown>[0];
  const logger = { log: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    closeCallback = undefined;
    server = {
      close: vi.fn((cb: () => void) => {
        calls.push('server.close');
        closeCallback = cb;
      }),
      closeIdleConnections: vi.fn(() => calls.push('server.closeIdleConnections')),
      closeAllConnections: vi.fn(() => {
        calls.push('server.closeAllConnections');
        closeCallback?.();
      }),
    };
    deps = {
      server: server as any,
      closeQueues: vi.fn(async () => void calls.push('closeQueues')),
      closeRedis: vi.fn(async () => void calls.push('closeRedis')),
      disconnectMongo: vi.fn(async () => void calls.push('disconnectMongo')),
      exit: vi.fn((code: number) => void calls.push(`exit(${code})`)),
      logger,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('closes the server, then the queues, Redis and MongoDB, and exits 0', async () => {
    const done = createShutdown(deps)('SIGTERM');
    closeCallback!();
    await done;

    expect(calls).toEqual([
      'server.close',
      'server.closeIdleConnections',
      'closeQueues',
      'closeRedis',
      'disconnectMongo',
      'exit(0)',
    ]);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it('destroys open connections when requests do not drain in time', async () => {
    const done = createShutdown(deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SERVER_DRAIN_TIMEOUT_MS);
    await done;

    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(calls.slice(-4)).toEqual(['closeQueues', 'closeRedis', 'disconnectMongo', 'exit(0)']);
  });

  it('forces exit 1 when a step hangs past the shutdown timeout', async () => {
    deps.closeQueues = vi.fn(() => new Promise<void>(() => undefined));
    void createShutdown(deps)('SIGINT');
    closeCallback!();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);

    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.closeRedis).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('forcing exit'));
  });

  it('exits 1 when closing a connection fails', async () => {
    deps.closeRedis = vi.fn().mockRejectedValue(new Error('redis gone'));
    const done = createShutdown(deps)('SIGTERM');
    closeCallback!();
    await done;

    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
    // The force-exit timer was cleared, so it can't fire a second exit
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('ignores a second signal while shutting down', async () => {
    const shutdown = createShutdown(deps);
    const first = shutdown('SIGTERM');
    await shutdown('SIGINT');
    closeCallback!();
    await first;

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});
