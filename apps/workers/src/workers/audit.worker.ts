import { Worker, Job, UnrecoverableError } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import type { LlmUsage } from '../services/llm-client.js';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { measureSite } from '../services/site-audit.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { EMAIL_GUESSED_TAG } from '../services/discovery.constants.js';
import { isPermanentAuditError, leadFieldsFromAudit, leadStatusesInto, sanitizeAuditError } from '@revamp/validation';
import { handleAuditJobFailed, isFinalAuditAttempt, markLeadAuditFailed } from './audit-failure.js';
import { jobTenant, withTenant } from '../tenant.js';

// A lead can be re-audited, which creates a new Audit document; always write to the latest one
const LATEST_AUDIT = { sort: { createdAt: -1 } } as const;

export const createAuditWorker = (): Worker => {
  const worker = new Worker<IAuditJobData>(
    QUEUE_NAMES.AUDIT,
    async (job: Job<IAuditJobData>) => {
      const { leadId, url, niche } = job.data;
      console.log(`[AuditWorker] Received job ${job.id} for lead: ${leadId}, URL: ${url}, niche: ${niche}`);

      // 1. Move the lead to AUDITING. Only a queued lead (or this job's own earlier attempt) is
      // audited; a lead that was rejected or moved on meanwhile is left alone (REV-62)
      // The job's studio, before anything is written (REV-210)
      const tenant = jobTenant(job.data.tenantId);
      const existingLead = await Lead.findOneAndUpdate(
        withTenant(tenant, { _id: leadId, status: { $in: leadStatusesInto('AUDITING', { includeSelf: true }) } }),
        { $set: { status: 'AUDITING' }, $unset: { auditError: '' } },
        { new: true },
      ).exec();

      if (!existingLead) {
        // A lead of another studio (or none) is not this job's to fail: nothing is written (REV-210)
        if (await Lead.exists({ _id: leadId, tenantId: { $ne: tenant } })) {
          throw new UnrecoverableError(`Lead ${leadId} does not belong to the job's studio; nothing was written`);
        }
        const reason = `Lead ${leadId} is missing or no longer waiting for an audit; skipping it.`;
        console.warn(`[AuditWorker] ${reason}`);
        // Only an audit still waiting or running: a stray job (one queued late, REV-202) never overwrites a finished audit
        await Audit.findOneAndUpdate(
          { leadId, status: { $in: ['QUEUED', 'PROCESSING'] } },
          { status: 'FAILED', errorMessage: reason },
          LATEST_AUDIT,
        ).exec();
        return { success: false, skipped: true, leadId, reason };
      }

      await Audit.findOneAndUpdate({ leadId }, { status: 'PROCESSING' }, { new: true, ...LATEST_AUDIT }).exec();

      console.log(`[AuditWorker] Status updated to AUDITING/PROCESSING for lead ${leadId}`);

      try {
        // 2-9. The measurement, shared with the platform audit (REV-232): the crawl, scores and the audit update
        const businessName = existingLead?.businessName || 'Business';
        // Record each model call's token usage when the provider reports it
        const recordTokens = async (stage: string, model: string | undefined, usage: LlmUsage | undefined) => {
          if (!usage) return;
          try {
            await AnalyticsEvent.create({
              leadId,
              // The event belongs to the lead's studio, so the API's studio filter finds it (REV-209)
              ...(existingLead.tenantId ? { tenantId: existingLead.tenantId } : {}),
              eventType: 'token_usage',
              metadata: {
                model,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                stage,
              },
            });
          } catch (eventErr) {
            console.warn(`[AuditWorker] Failed to record token_usage event for lead ${leadId}:`, eventErr);
          }
        };
        const measured = await measureSite({
          url,
          niche,
          businessName,
          storageOwnerId: leadId,
          logLabel: `lead ${leadId}`,
          recordTokens,
        });
        const { scores, siteComplexity, measurementErrors } = measured;

        const updatedAudit = await Audit.findOneAndUpdate({ leadId }, measured.update, { new: true, ...LATEST_AUDIT }).exec();

        // 10. Update Lead status to AUDITED, save totalScore, and enrich contacts if found
        // The same function fills a lead that reuses this audit at add time (REV-208), so the two cannot drift. A
        // guessed email is replaced by the one the site publishes (REV-45)
        const { set: auditedFields, clearsEmailGuess } = leadFieldsFromAudit(
          { scores, siteComplexity, extractedContacts: measured.extractedContacts },
          { contactPhone: existingLead?.contactPhone, contactEmail: existingLead?.contactEmail, tags: existingLead?.tags },
        );
        const leadUpdate: Record<string, unknown> = { status: 'AUDITED', ...auditedFields };
        if (clearsEmailGuess) leadUpdate['$pull'] = { tags: EMAIL_GUESSED_TAG };
        // The full street address is persisted on the Audit (extractedContacts), not as the lead's city

        // Only a lead this run is still auditing becomes AUDITED (GENERATING → AUDITED is a failed
        // generation, not an audit); a lead rejected mid-audit stays so (REV-62)
        const auditedLead = await Lead.findOneAndUpdate(withTenant(tenant, { _id: leadId, status: 'AUDITING' }), leadUpdate).exec();

        // 11. Auto-chain to AI Content Generation Queue
        if (!auditedLead) {
          console.warn(`[AuditWorker] Lead ${leadId} left AUDITING during the audit; not generating an MVP.`);
        } else {
          try {
            await addAiGenerationJob({
              leadId,
              tenantId: job.data.tenantId,
              auditId: updatedAudit?._id?.toString() || leadId,
            });
            console.log(`[AuditWorker] Dispatched AI generation job for lead ${leadId}`);
          } catch (chainErr) {
            console.error(`[AuditWorker] Failed to dispatch AI generation job for lead ${leadId}:`, chainErr);
          }
        }

        console.log(`[AuditWorker] Successfully completed audit for lead ${leadId}:\n${measured.summary}`);

        return {
          success: true,
          leadId,
          url,
          a11yScore: measured.a11yScore,
          lcp: measured.lcpSeconds,
          desktopScreenshotUrl: measured.screenshotUrls.desktop,
          mobileScreenshotUrl: measured.screenshotUrls.mobile,
          desktopFullScreenshotUrl: measured.screenshotUrls.desktopFull,
          mobileFullScreenshotUrl: measured.screenshotUrls.mobileFull,
          totalScore: scores.total,
          scores,
          measurementErrors,
          designCritique: measured.designCritique,
          aiFallbackUsed: measured.aiFallbackUsed,
          extractedBrandTokens: measured.extractedBrandTokens,
          contacts: measured.extractedContacts,
          services: measured.extractedServices,
          siteComplexity,
          processedAt: new Date().toISOString(),
        };
      } catch (error: unknown) {
        const errorMessage = sanitizeAuditError(error);
        const permanent = isPermanentAuditError(errorMessage);
        console.error(`[AuditWorker] Error processing audit for lead ${leadId}:`, error);

        await Audit.findOneAndUpdate(
          { leadId },
          {
            status: 'FAILED',
            errorMessage,
          },
          LATEST_AUDIT,
        ).exec();

        // REV-44: retries keep the lead in AUDITING; the last attempt moves it to AUDIT_FAILED
        if (isFinalAuditAttempt(job, permanent)) {
          await markLeadAuditFailed(job, errorMessage);
        }

        // A domain that does not resolve or an invalid certificate will not recover on retry
        if (permanent) {
          throw new UnrecoverableError(errorMessage);
        }
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[AuditWorker] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[AuditWorker] Job ${job?.id} failed:`, err);
    // A job that stalled out never reached the processor's catch (REV-145)
    void handleAuditJobFailed(job, err);
  });

  return worker;
};
