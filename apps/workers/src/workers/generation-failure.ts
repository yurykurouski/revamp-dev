import { UnrecoverableError, type Job } from 'bullmq';
import type { IMvpRenderFailure, LeadStatus } from '@revamp/shared-types';
import { Lead } from '../models/Lead.model.js';

const MAX_ERROR_LENGTH = 300;

/**
 * Where a lead goes when MVP generation fails for good (REV-31). A lead that never had an MVP goes
 * back to AUDITED so "Generate MVP" is offered again. A regenerated lead still has its previous MVP
 * intact, so it goes back to review (NEEDS_APPROVAL), never straight to an approved state.
 */
export function statusAfterFailedGeneration(previousStatus: LeadStatus | undefined): LeadStatus {
  return !previousStatus || previousStatus === 'AUDITED' ? 'AUDITED' : 'NEEDS_APPROVAL';
}

/**
 * `failed` handler for the AI generation and deploy workers. Once BullMQ has used up the job's
 * retries, it moves the lead out of GENERATING and records the error for the dashboard, so the
 * operator can retry. Never throws.
 */
export async function handleGenerationFailure(
  job: Job<{ leadId: string; previousStatus?: LeadStatus }> | undefined,
  err: Error,
  stage: 'content' | 'deploy',
): Promise<void> {
  if (!job?.data?.leadId) return;

  const attempts = job.opts?.attempts ?? 1;
  // BullMQ retries it, unless the error is final (a render a model could not make, REV-132)
  // A subclass of UnrecoverableError is named after itself, so both the class and the name count as final
  const final = err instanceof UnrecoverableError || err?.name === 'UnrecoverableError';
  if (job.attemptsMade < attempts && !final) return;

  const status = statusAfterFailedGeneration(job.data.previousStatus);
  const generationError = `MVP ${stage} failed: ${err?.message || 'unknown error'}`.slice(0, MAX_ERROR_LENGTH);
  // The code and reason the dashboard explains in the operator's language (REV-132)
  const generationFailure = (err as { failure?: IMvpRenderFailure } | undefined)?.failure;
  try {
    // Only a lead still marked GENERATING by this run is reset; never overwrite a newer state
    await Lead.findOneAndUpdate(
      { _id: job.data.leadId, status: 'GENERATING' },
      { $set: { status, generationError, ...(generationFailure ? { generationFailure } : {}) } },
    ).exec();
    console.warn(`[GenerationFailure] Lead ${job.data.leadId} reset to ${status}: ${generationError}`);
  } catch (updateErr) {
    console.error(`[GenerationFailure] Could not reset lead ${job.data.leadId}:`, updateErr);
  }
}
