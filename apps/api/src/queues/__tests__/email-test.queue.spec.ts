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

const { sendTestEmailJob, emailTestQueue, closeEmailTestEvents } = await import('../email-test.queue.js');
const { Queue, QueueEvents } = await import('bullmq');
// Recorded at import; mock calls are cleared between tests
const queueConstructorArgs = [...vi.mocked(Queue).mock.calls];

describe('sendTestEmailJob (REV-60)', () => {
  const data = { leadId: 'lead-1', to: 'operator@revamp.io', subject: 'Subject', body: 'Body' };

  beforeEach(() => {
    vi.clearAllMocks();
    queue.add.mockResolvedValue(job);
    events.waitUntilReady.mockResolvedValue(undefined);
    job.remove.mockResolvedValue(undefined);
  });

  it('uses its own queue and does not retry a failed test send', () => {
    expect(emailTestQueue).toBe(queue);
    expect(queueConstructorArgs).toHaveLength(1);
    const [name, opts] = queueConstructorArgs[0]!;
    expect(name).toBe(QUEUE_NAMES.EMAIL_TEST);
    expect((opts as any).defaultJobOptions.attempts).toBe(1);
  });

  it('returns the worker result once the email is sent', async () => {
    const result = { messageId: 'msg-1', provider: 'smtp', sentAt: '2026-09-27T12:00:00.000Z' };
    job.waitUntilFinished.mockResolvedValue(result);

    await expect(sendTestEmailJob(data, 1000)).resolves.toEqual({ status: 'sent', result });
    expect(queue.add).toHaveBeenCalledWith('test-email', data);
    expect(job.waitUntilFinished).toHaveBeenCalledWith(events, 1000);
  });

  it('listens for results on the test queue and reuses one listener', async () => {
    job.waitUntilFinished.mockResolvedValue({ provider: 'smtp', sentAt: '' });
    await sendTestEmailJob(data);
    await sendTestEmailJob(data);
    // Earlier tests may already have created it; either way no further one is made
    expect(vi.mocked(QueueEvents).mock.calls.length).toBeLessThanOrEqual(1);
    expect(job.waitUntilFinished.mock.calls.every(([listener]) => listener === events)).toBe(true);
  });

  it('reports the failure reason when the worker failed the job', async () => {
    job.waitUntilFinished.mockRejectedValue(new Error('Resend API error (403)'));
    job.getState.mockResolvedValue('failed');

    await expect(sendTestEmailJob(data)).resolves.toEqual({ status: 'failed', reason: 'Resend API error (403)' });
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('times out and drops a job no worker picked up', async () => {
    job.waitUntilFinished.mockRejectedValue(new Error('timed out'));
    job.getState.mockResolvedValue('waiting');

    await expect(sendTestEmailJob(data)).resolves.toEqual({ status: 'timeout' });
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('times out without removing a job a worker is already sending', async () => {
    job.waitUntilFinished.mockRejectedValue(new Error('timed out'));
    job.getState.mockResolvedValue('active');

    await expect(sendTestEmailJob(data)).resolves.toEqual({ status: 'timeout' });
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('closes the QueueEvents connection once and reopens it on the next send (REV-66)', async () => {
    events.close.mockResolvedValue(undefined);
    job.waitUntilFinished.mockResolvedValue({ messageId: 'm-1' });
    await sendTestEmailJob(data);
    events.close.mockClear();
    vi.mocked(QueueEvents).mockClear();

    await closeEmailTestEvents();
    await closeEmailTestEvents();
    expect(events.close).toHaveBeenCalledTimes(1);

    await sendTestEmailJob(data);
    expect(QueueEvents).toHaveBeenCalledTimes(1);
  });
});
