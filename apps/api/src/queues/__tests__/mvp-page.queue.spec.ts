import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUEUE_NAMES } from '@revamp/shared-types';

const job = {
  waitUntilFinished: vi.fn(),
  getState: vi.fn(),
  remove: vi.fn(),
};
const queue = { add: vi.fn() };
const events = { waitUntilReady: vi.fn(), close: vi.fn() };

vi.mock('../connection.js', () => ({ redisConnection: {} }));
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return queue;
  }),
  QueueEvents: vi.fn().mockImplementation(function () {
    return events;
  }),
}));

const { runMvpPageJob, mvpPageQueue, closeMvpPageEvents, MVP_PAGE_CHANGE_WAIT_MS, MVP_PAGE_PUBLISH_WAIT_MS } = await import('../mvp-page.queue.js');
const { Queue, QueueEvents } = await import('bullmq');
// Recorded at import; mock calls are cleared between tests
const queueConstructorArgs = [...vi.mocked(Queue).mock.calls];

describe('runMvpPageJob (REV-85, REV-139)', () => {
  const data = { mvpProjectId: 'mvp-1', action: 'change' as const, instruction: 'Make the headline punchier' };

  beforeEach(() => {
    vi.clearAllMocks();
    queue.add.mockResolvedValue(job);
    events.waitUntilReady.mockResolvedValue(undefined);
    job.remove.mockResolvedValue(undefined);
  });

  it('uses its own queue and does not retry a failed change', () => {
    expect(mvpPageQueue).toBe(queue);
    expect(queueConstructorArgs).toHaveLength(1);
    const [name, opts] = queueConstructorArgs[0]!;
    expect(name).toBe(QUEUE_NAMES.MVP_PAGE);
    expect((opts as any).defaultJobOptions.attempts).toBe(1);
  });

  it('returns the worker result and tells the worker when the API stops waiting', async () => {
    const result = { applied: true, version: 3 };
    job.waitUntilFinished.mockResolvedValue(result);
    const before = Date.now();

    await expect(runMvpPageJob(data, 1000)).resolves.toEqual({ status: 'done', result });

    const [name, payload] = queue.add.mock.calls[0]!;
    expect(name).toBe('change');
    expect(payload).toMatchObject(data);
    expect(payload.deadline).toBeGreaterThanOrEqual(before + 1000);
    expect(payload.deadline).toBeLessThanOrEqual(Date.now() + 1000);
    expect(job.waitUntilFinished).toHaveBeenCalledWith(events, 1000);
  });

  it('waits long enough for two model calls and a publish on a change, and for a publish otherwise', () => {
    expect(MVP_PAGE_CHANGE_WAIT_MS).toBe(420_000);
    expect(MVP_PAGE_PUBLISH_WAIT_MS).toBe(120_000);
  });

  it('reports the failure reason when the worker failed the job', async () => {
    job.waitUntilFinished.mockRejectedValue(new Error('No LLM provider is configured'));
    job.getState.mockResolvedValue('failed');

    await expect(runMvpPageJob(data, 1000)).resolves.toEqual({ status: 'failed', reason: 'No LLM provider is configured' });
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('times out and drops a job no worker picked up', async () => {
    job.waitUntilFinished.mockRejectedValue(new Error('timed out'));
    job.getState.mockResolvedValue('waiting');

    await expect(runMvpPageJob(data, 1000)).resolves.toEqual({ status: 'timeout', running: false });
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('times out without removing a job a worker is running, and says it may still publish', async () => {
    job.waitUntilFinished.mockRejectedValue(new Error('timed out'));
    job.getState.mockResolvedValue('active');

    await expect(runMvpPageJob(data, 1000)).resolves.toEqual({ status: 'timeout', running: true });
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('closes the QueueEvents connection once and reopens it on the next change', async () => {
    events.close.mockResolvedValue(undefined);
    job.waitUntilFinished.mockResolvedValue({ applied: false, reason: 'unchanged' });
    await runMvpPageJob(data, 1000);
    events.close.mockClear();
    vi.mocked(QueueEvents).mockClear();

    await closeMvpPageEvents();
    await closeMvpPageEvents();
    expect(events.close).toHaveBeenCalledTimes(1);

    await runMvpPageJob(data, 1000);
    expect(QueueEvents).toHaveBeenCalledTimes(1);
  });
});
