import { Worker, Job } from 'bullmq';
import { IAiGenerationJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { mvpContentService } from '../services/mvp-content.service.js';
import { addDeployJob } from '../queues/deploy.queue.js';
import { handleGenerationFailure } from './generation-failure.js';

export const createAiWorker = (): Worker => {
  const worker = new Worker<IAiGenerationJobData>(
    QUEUE_NAMES.AI_GENERATION,
    async (job: Job<IAiGenerationJobData>) => {
      const { leadId, auditId, forceRegenerate = false, previousStatus } = job.data;
      console.log(
        `[AiWorker] Processing AI content generation for leadId: ${leadId}, auditId: ${auditId}` +
          (forceRegenerate ? ' (regenerating: previous copy is discarded)' : ''),
      );

      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      const audit = await Audit.findOne({
        $or: [{ _id: auditId }, { leadId }],
      }).exec();

      // 1. Transition Lead status to GENERATING
      await Lead.findByIdAndUpdate(leadId, { status: 'GENERATING' }).exec();

      // 2. Synthesize high-converting MVP copy with Strict Grounding. Always a fresh LLM run: the
      // copy stored on the audit is never reused, so a regeneration (REV-31) gets new copy.
      const generationResult = await mvpContentService.generateContent({
        businessName: lead.businessName,
        niche: lead.niche,
        city: lead.city,
        originalUrl: lead.originalUrl,
        extractedServices: audit?.extractedServices,
        // Verified contacts: extracted from the original site first, then operator-entered lead data
        contacts: {
          phone: audit?.extractedContacts?.phone || lead.contactPhone,
          email: audit?.extractedContacts?.email || lead.contactEmail,
          address: audit?.extractedContacts?.address,
          workingHours: audit?.extractedContacts?.workingHours,
        },
        siteContent: audit?.extractedContent,
        critiqueQuickWins: audit?.designCritique?.quickWins,
        ownerName: lead.ownerName,
      });

      // 3. Persist generated copy to Audit
      if (audit) {
        await Audit.findByIdAndUpdate(audit._id, {
          // Drop undefined keys: the Mongo driver would persist them as null
          generatedContent: JSON.parse(JSON.stringify(generationResult.content)),
          aiFallbackUsed: audit.aiFallbackUsed || generationResult.aiFallbackUsed,
        }).exec();
      }

      // 4. Chain to the Deploy Queue for HTML synthesis, screenshots, and MinIO deployment. The lead
      // stays GENERATING until the deploy worker publishes the new preview and moves it to
      // NEEDS_APPROVAL (Human-In-The-Loop gate), so the dashboard never shows a stale preview as ready.
      // A failed dispatch fails the job, so BullMQ retries it instead of leaving the lead stuck.
      await addDeployJob({
        leadId,
        auditId: audit?._id?.toString() || auditId,
        forceRegenerate,
        previousStatus,
      });
      console.log(`[AiWorker] Dispatched MVP Deploy job for lead ${leadId}`);

      console.log(
        `[AiWorker] Content generated successfully for ${lead.businessName} (Fallback: ${generationResult.aiFallbackUsed}).`,
      );

      return {
        success: true,
        leadId,
        auditId: audit?._id?.toString() || auditId,
        content: generationResult.content,
        aiFallbackUsed: generationResult.aiFallbackUsed,
      };
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
