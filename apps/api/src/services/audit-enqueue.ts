import type { IAuditJobData } from '@revamp/shared-types';
import { tenantIdOf, type TenantScope } from '../data/tenant-scope.js';
import { Audit } from '../models/Audit.model.js';
import { addAuditJob } from '../queues/audit.queue.js';
import { redisConnection } from '../queues/connection.js';
import { AppError } from '../middlewares/errorHandler.js';
import { withTimeout } from './with-timeout.js';

/**
 * How long the API waits for Redis to accept an audit job (REV-202). The connection retries forever
 * (`maxRetriesPerRequest: null`), so without a limit a Redis outage hangs the request instead of failing it.
 */
export const AUDIT_ENQUEUE_TIMEOUT_MS = 5000;

/** Shown on the lead (`auditError`) and the audit when the job could not be queued; Retry audit recovers it */
export const AUDIT_QUEUE_ERROR = 'The audit queue was unavailable when the audit was requested. Retry the audit.';

/**
 * Queues the audit of a lead that was just saved QUEUED. When the queue fails or does not answer, the
 * lead moves to AUDIT_FAILED with a readable reason and its audit to FAILED, so the operator can retry,
 * and a 503 AppError is thrown (REV-202). Only a lead still QUEUED is changed: if the job did land and
 * a worker already took the lead, its audit is left running.
 */
export async function enqueueAuditOrFail(
  scope: TenantScope,
  params: Omit<IAuditJobData, 'tenantId'> & { auditId: string },
  timeoutMs: number = AUDIT_ENQUEUE_TIMEOUT_MS,
): Promise<{ jobId?: string }> {
  const { leadId, auditId, url, niche } = params;
  try {
    // ioredis keeps a command sent while disconnected and runs it on reconnect, so a timed-out add could still
    // land later next to the operator's retry. Not calling it while Redis is down leaves no such job.
    if (redisConnection.status !== 'ready') throw new Error(`Redis is ${redisConnection.status}`);
    const job = await withTimeout(addAuditJob({ leadId, tenantId: tenantIdOf(scope), url, niche }), timeoutMs, 'Audit queue');
    return { jobId: job.id };
  } catch (queueError) {
    console.error(`[AuditQueue] Could not queue the audit of lead ${leadId}:`, queueError);
    try {
      await scope.leads.findOneAndUpdate(
        { _id: leadId, status: 'QUEUED' },
        { $set: { status: 'AUDIT_FAILED', auditError: AUDIT_QUEUE_ERROR } },
      ).exec();
      await Audit.updateOne(
        { _id: auditId, status: 'QUEUED' },
        { $set: { status: 'FAILED', errorMessage: AUDIT_QUEUE_ERROR } },
      ).exec();
    } catch (updateError) {
      console.error(`[AuditQueue] Could not mark lead ${leadId} as failed:`, updateError);
    }
    throw new AppError(503, 'AUDIT_QUEUE_UNAVAILABLE', 'The audit could not be queued; retry the audit from the lead', {
      leadId,
    });
  }
}
