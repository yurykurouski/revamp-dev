import { UnrecoverableError, type Job } from 'bullmq';
import type { IPlatformAuditJobData } from '@revamp/shared-types';
import { isPermanentAuditError, sanitizeAuditError } from '@revamp/validation';
import type { LlmUsage } from '../services/llm-client.js';
import { Audit } from '../models/Audit.model.js';
import { Business } from '../models/Business.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { measureSite } from '../services/site-audit.js';
import { isFinalAuditAttempt } from './audit-failure.js';

/**
 * The platform audit (REV-232): the audit of a shared business before any studio owns it. It runs the same
 * deterministic measurement as a lead audit and writes only the `Audit` (found by its id, never by a lead) and
 * studio-less token events. No lead moves and no generation job is queued. The job carries no `tenantId`: this is
 * the one job that writes only platform-owned records.
 */
export async function processPlatformAudit(job: Job<IPlatformAuditJobData>) {
  const { auditId, businessId, url, niche } = job.data;
  console.log(`[PlatformAudit] Received job ${job.id} for business ${businessId}, URL: ${url}, niche: ${niche}`);

  // The audit of this business, with no lead, still waiting or running: a stale retry never overwrites a finished
  // audit and a studio's own lead audit is never touched
  const own = { _id: auditId, businessId, leadId: { $exists: false } } as const;
  const claimed = await Audit.findOneAndUpdate({ ...own, status: { $in: ['QUEUED', 'PROCESSING'] } }, { status: 'PROCESSING' }).exec();
  if (!claimed) {
    const reason = `Platform audit ${auditId} is missing or no longer waiting; skipping it.`;
    console.warn(`[PlatformAudit] ${reason}`);
    return { success: false, skipped: true, auditId, reason };
  }

  try {
    const business = await Business.findById(businessId, { businessName: 1 }).lean();
    const recordTokens = async (stage: string, model: string | undefined, usage: LlmUsage | undefined) => {
      if (!usage) return;
      try {
        await AnalyticsEvent.create({
          eventType: 'token_usage',
          metadata: {
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            stage,
            auditId,
            businessId,
          },
        });
      } catch (eventErr) {
        console.warn(`[PlatformAudit] Failed to record token_usage event for business ${businessId}:`, eventErr);
      }
    };
    const measured = await measureSite({
      url,
      niche,
      businessName: business?.businessName || 'Business',
      storageOwnerId: `business-${businessId}`,
      logLabel: `business ${businessId}`,
      recordTokens,
    });

    await Audit.findOneAndUpdate({ ...own, status: 'PROCESSING' }, measured.update).exec();
    console.log(`[PlatformAudit] Completed audit ${auditId} of business ${businessId}:\n${measured.summary}`);
    return {
      success: true,
      auditId,
      businessId,
      url,
      totalScore: measured.scores.total,
      scores: measured.scores,
      measurementErrors: measured.measurementErrors,
      processedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    const errorMessage = sanitizeAuditError(error);
    const permanent = isPermanentAuditError(errorMessage);
    console.error(`[PlatformAudit] Error processing audit ${auditId} of business ${businessId}:`, error);

    // Same retry policy as the lead audit: the audit stays PROCESSING while retries remain, so the retry can claim it
    if (isFinalAuditAttempt(job, permanent)) {
      await Audit.findOneAndUpdate({ ...own, status: { $in: ['QUEUED', 'PROCESSING'] } }, { status: 'FAILED', errorMessage }).exec();
    }
    if (permanent) throw new UnrecoverableError(errorMessage);
    throw error;
  }
}
