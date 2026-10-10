import { randomUUID } from 'node:crypto';
import { UnrecoverableError, Worker, Job } from 'bullmq';
import { IAiGenerationJobData, IAudit, ILead, IMvpRenderFailure } from '@revamp/shared-types';
import { leadStatusesInto } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { buildMvpSourceBrief } from '../services/mvp-source-brief.js';
import { MvpPageGenerator, defaultPageGenerator } from '../services/mvp-page-generator.js';
import { addDeployJob } from '../queues/deploy.queue.js';
import { desktopCapture } from '../services/desktop-capture.js';
import { handleGenerationFailure } from './generation-failure.js';

/** A page the model could not make (REV-138): final, so BullMQ does not retry; the code and reason go on the lead */
export class MvpPageUnavailableError extends UnrecoverableError {
  constructor(readonly failure: IMvpRenderFailure) {
    super(failure.message ?? `The model gave no page (${failure.reason})`);
  }
}

export const createAiWorker = (): Worker => {
  const worker = new Worker<IAiGenerationJobData>(
    QUEUE_NAMES.AI_GENERATION,
    async (job: Job<IAiGenerationJobData>) => {
      const { leadId, auditId, forceRegenerate = false, previousStatus, provider, model } = job.data;
      console.log(
        `[AiWorker] Designing the MVP page for leadId: ${leadId}, auditId: ${auditId}` +
          (forceRegenerate ? ' (regenerating)' : '') +
          (provider ? ` with ${provider}${model ? `/${model}` : ''}` : ''),
      );

      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      // The job's audit, else the lead's newest completed one; never a failed or stale audit (REV-55)
      const audit = await findGenerationAudit(leadId, auditId);
      if (!audit) {
        throw new Error(`No completed audit found for lead ${leadId}`);
      }

      // 1. Transition Lead status to GENERATING (the API usually did already). A lead that was
      // rejected or moved on since the job was queued is not generated for (REV-62)
      const generating = await Lead.findOneAndUpdate(
        { _id: leadId, status: { $in: leadStatusesInto('GENERATING', { includeSelf: true }) } },
        { $set: { status: 'GENERATING' } },
      ).exec();
      if (!generating) {
        const reason = `Lead ${leadId} is ${lead.status}, which cannot move to GENERATING; skipping generation.`;
        console.warn(`[AiWorker] ${reason}`);
        return { success: false, skipped: true, leadId, reason };
      }

      // 2. The model designs the page from the brief code built (no contact values) and the current site's look.
      // The operator's provider/model applies to this job only (REV-32)
      const auditData = (audit.toObject ? audit.toObject() : audit) as unknown as IAudit;
      const leadData = (lead.toObject ? lead.toObject() : lead) as unknown as ILead;
      const brief = buildMvpSourceBrief(auditData, leadData);
      const screenshot = await desktopCapture(auditData.screenshotUrls?.desktopFull);
      const generator = provider ? new MvpPageGenerator({ provider, model }) : defaultPageGenerator();
      const result = await generator.generate({ brief, ...(screenshot ? { screenshot } : {}) });

      if (!result.ok) {
        console.warn(`[AiWorker] No page for lead ${leadId}: ${result.reason}: ${result.message}`);
        // An unreachable model may answer on the job's next attempt; a missing model or a rejected page will not
        if (result.reason === 'call_failed') throw new Error(result.message);
        throw new MvpPageUnavailableError({ code: 'MVP_PAGE_UNAVAILABLE', reason: result.reason, message: result.message.slice(0, 300), at: new Date() });
      }

      // 3. The deploy job finishes, publishes and measures the page and moves the lead to NEEDS_APPROVAL
      // (Human-In-The-Loop gate). A failed dispatch fails the job, so BullMQ retries it instead of leaving the lead stuck.
      await addDeployJob({
        leadId,
        auditId: String(audit._id),
        forceRegenerate,
        previousStatus,
        page: { id: randomUUID(), html: result.page, theme: result.theme, grounding: result.grounding, kind: 'generate' },
        generationSource: {
          // A page always comes from a configured provider: without one the generator answers not_configured
          provider: result.provider!,
          modelUsed: result.modelUsed,
          ...(provider ? { requestedProvider: provider, requestedModel: model } : {}),
        },
      });
      console.log(`[AiWorker] Page designed for ${lead.businessName} in ${result.attempts} attempt(s); deploy job dispatched.`);

      return { success: true, leadId, auditId: String(audit._id), attempts: result.attempts, modelUsed: result.modelUsed, grounding: result.grounding.length };
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[AiWorker] Job ${job.id} completed.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[AiWorker] Job ${job?.id} failed:`, err);
    void handleGenerationFailure(job, err, 'content');
  });

  return worker;
};
