import type { IEmailDispatchJobData } from '@revamp/shared-types';
import { revertOutreachApproval } from '../models/EmailCampaign.model.js';
import { addEmailDispatchJob } from '../queues/email.queue.js';
import { redisConnection } from '../queues/connection.js';
import { AppError } from '../middlewares/errorHandler.js';
import { withTimeout } from './with-timeout.js';

/** How long the API waits for Redis to accept the send of an approved email (REV-203) */
export const EMAIL_ENQUEUE_TIMEOUT_MS = 5000;

/**
 * Queues the send of an approval that was just committed (lead SCHEDULED, campaign approved). When the queue fails or
 * does not answer, the approval is undone (lead and campaign back to NEEDS_APPROVAL, `revertOutreachApproval`) so the
 * operator can approve again, and a 503 AppError is thrown (REV-203). Nothing is sent either way: the email worker only
 * sends to a SCHEDULED lead, so even a job that lands after the revert is dropped.
 */
export async function enqueueEmailOrRevert(
  data: IEmailDispatchJobData,
  delayMs: number,
  timeoutMs: number = EMAIL_ENQUEUE_TIMEOUT_MS,
): Promise<{ jobId?: string }> {
  try {
    // ioredis keeps a command sent while disconnected and runs it on reconnect; not calling it leaves no late job
    if (redisConnection.status !== 'ready') throw new Error(`Redis is ${redisConnection.status}`);
    const job = await withTimeout(addEmailDispatchJob(data, { delay: delayMs }), timeoutMs, 'Email queue');
    return { jobId: job.id };
  } catch (queueError) {
    console.error(`[EmailQueue] Could not queue the email of lead ${data.leadId}:`, queueError);
    try {
      await revertOutreachApproval(data.leadId);
    } catch (revertError) {
      console.error(`[EmailQueue] Could not return lead ${data.leadId} to review:`, revertError);
    }
    throw new AppError(503, 'EMAIL_QUEUE_UNAVAILABLE', 'The email could not be queued; the lead is back in review, approve it again', {
      leadId: data.leadId,
    });
  }
}
