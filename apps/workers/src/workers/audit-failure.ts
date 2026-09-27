import type { Job } from 'bullmq';
import type { IAuditJobData } from '@revamp/shared-types';
import { leadStatusesInto } from '@revamp/validation';
import { Lead } from '../models/Lead.model.js';

/**
 * True when this run is the job's last one: the error is permanent (the job is failed without
 * retries) or BullMQ has no attempts left. `attemptsMade` counts the attempts that failed before
 * the current one.
 */
export function isFinalAuditAttempt(job: Pick<Job, 'attemptsMade' | 'opts'>, permanent: boolean): boolean {
  const attempts = job.opts?.attempts ?? 1;
  return permanent || job.attemptsMade + 1 >= attempts;
}

/**
 * Moves the lead out of AUDITING after its audit failed for good, so the dashboard shows the reason
 * and offers a retry (REV-44). Never throws.
 */
export async function markLeadAuditFailed(job: Job<IAuditJobData>, auditError: string): Promise<void> {
  const { leadId } = job.data;
  try {
    // Only a lead still marked AUDITING by this run is changed; never overwrite a newer state
    await Lead.findOneAndUpdate(
      { _id: leadId, status: { $in: leadStatusesInto('AUDIT_FAILED') } },
      { $set: { status: 'AUDIT_FAILED', auditError } },
    ).exec();
    console.warn(`[AuditFailure] Lead ${leadId} marked AUDIT_FAILED: ${auditError}`);
  } catch (updateErr) {
    console.error(`[AuditFailure] Could not mark lead ${leadId} as failed:`, updateErr);
  }
}
