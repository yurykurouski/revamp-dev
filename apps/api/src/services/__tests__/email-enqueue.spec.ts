import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_ENQUEUE_TIMEOUT_MS, enqueueEmailOrRevert } from '../email-enqueue.js';
import { revertOutreachApproval } from '../../models/EmailCampaign.model.js';
import * as emailQueueModule from '../../queues/email.queue.js';
import { AppError } from '../../middlewares/errorHandler.js';

vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../queues/email.queue.js');
const redis = vi.hoisted(() => ({ status: 'ready' }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: redis }));

const data = { leadId: 'lead-1', campaignId: 'campaign-1' };
const isQueueError = (e: unknown) =>
  e instanceof AppError &&
  e.statusCode === 503 &&
  e.code === 'EMAIL_QUEUE_UNAVAILABLE' &&
  (e.details as { leadId?: string } | undefined)?.leadId === 'lead-1';

describe('enqueueEmailOrRevert (REV-203)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'ready';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(revertOutreachApproval).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues the send with its delay and returns the job id', async () => {
    vi.mocked(emailQueueModule.addEmailDispatchJob).mockResolvedValue({ id: 'job-1' } as any);
    await expect(enqueueEmailOrRevert(data, 25_000)).resolves.toEqual({ jobId: 'job-1' });
    expect(emailQueueModule.addEmailDispatchJob).toHaveBeenCalledWith(data, { delay: 25_000 });
    expect(revertOutreachApproval).not.toHaveBeenCalled();
  });

  it('reverts and throws 503 at once, never queuing, while Redis is not ready', async () => {
    redis.status = 'reconnecting';
    await expect(enqueueEmailOrRevert(data, 0)).rejects.toSatisfy(isQueueError);
    expect(emailQueueModule.addEmailDispatchJob).not.toHaveBeenCalled();
    expect(revertOutreachApproval).toHaveBeenCalledWith('lead-1');
  });

  it('reverts and throws 503 when the queue rejects the job', async () => {
    vi.mocked(emailQueueModule.addEmailDispatchJob).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(enqueueEmailOrRevert(data, 0)).rejects.toSatisfy(isQueueError);
    expect(revertOutreachApproval).toHaveBeenCalledWith('lead-1');
  });

  it('reverts and throws 503 when the queue does not answer in time', async () => {
    vi.useFakeTimers();
    vi.mocked(emailQueueModule.addEmailDispatchJob).mockReturnValue(new Promise(() => {}));
    const pending = expect(enqueueEmailOrRevert(data, 0)).rejects.toSatisfy(isQueueError);
    await vi.advanceTimersByTimeAsync(EMAIL_ENQUEUE_TIMEOUT_MS + 1);
    await pending;
    expect(revertOutreachApproval).toHaveBeenCalledWith('lead-1');
  });

  it('still throws 503 when the revert itself fails', async () => {
    redis.status = 'end';
    vi.mocked(revertOutreachApproval).mockRejectedValue(new Error('mongo down'));
    await expect(enqueueEmailOrRevert(data, 0)).rejects.toSatisfy(isQueueError);
  });
});
