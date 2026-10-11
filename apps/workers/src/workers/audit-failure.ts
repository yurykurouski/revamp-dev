import type { Job } from 'bullmq';
import type { IAuditJobData } from '@revamp/shared-types';
import { leadStatusesInto } from '@revamp/validation';
import { Audit } from '../models/Audit.model.js';
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

/** What BullMQ says when a job is failed after its worker kept dying mid-run */
const STALLED_JOB_ERROR = /stalled more than allowable limit/i;

/** Shown on the lead (`auditError`) and the audit when the job stalled out; the operator can retry the audit */
export const STALLED_AUDIT_MESSAGE =
  'The audit stopped before it finished: the worker running it kept stopping (it crashed or was restarted). Retry the audit.';

/**
 * BullMQ fails a job that stalled too often (its worker died mid-run) from outside the processor, so the
 * processor's own catch never runs. Closes the audit and moves the lead out of AUDITING the same way (REV-145).
 * Failures raised inside the processor are handled there and ignored here. Never throws.
 */
export async function handleAuditJobFailed(job: Job<IAuditJobData> | undefined, error: Error): Promise<void> {
  if (!job || !STALLED_JOB_ERROR.test(error.message)) return;
  try {
    // Only an audit still running is closed; a finished one is never overwritten
    await Audit.findOneAndUpdate(
      { leadId: job.data.leadId, status: { $in: ['QUEUED', 'PROCESSING'] } },
      { status: 'FAILED', errorMessage: STALLED_AUDIT_MESSAGE },
      { sort: { createdAt: -1 } },
    ).exec();
  } catch (updateErr) {
    console.error(`[AuditFailure] Could not mark the audit of lead ${job.data.leadId} as failed:`, updateErr);
  }
  await markLeadAuditFailed(job, STALLED_AUDIT_MESSAGE);
}
