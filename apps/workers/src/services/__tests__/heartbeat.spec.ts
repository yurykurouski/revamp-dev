import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHeartbeat } from '../heartbeat.js';

describe('startHeartbeat (REV-217: the workers container HEALTHCHECK)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes at once and then every interval while the process is healthy', () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const stop = startHeartbeat({ isHealthy: () => true, file: '/tmp/beat', intervalMs: 1000, write });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('/tmp/beat', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    vi.advanceTimersByTime(3000);
    expect(write).toHaveBeenCalledTimes(4);
    stop();
  });

  it('writes nothing while MongoDB or Redis is down, so Docker marks the container unhealthy', () => {
    let healthy = true;
    const write = vi.fn().mockResolvedValue(undefined);
    const stop = startHeartbeat({ isHealthy: () => healthy, intervalMs: 1000, write });
    expect(write).toHaveBeenCalledTimes(1);

    healthy = false;
    vi.advanceTimersByTime(5000);
    expect(write).toHaveBeenCalledTimes(1);

    healthy = true;
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops beating after the returned stop function is called', () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const stop = startHeartbeat({ isHealthy: () => true, intervalMs: 1000, write });
    stop();
    vi.advanceTimersByTime(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('logs a failed write instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const write = vi.fn().mockRejectedValue(new Error('read-only file system'));
    const stop = startHeartbeat({ isHealthy: () => true, file: '/tmp/beat', write });
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('read-only file system'));
    stop();
  });
});
