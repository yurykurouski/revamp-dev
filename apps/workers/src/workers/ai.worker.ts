import { Worker, Job } from 'bullmq';
import { IAiGenerationJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { mvpContentService } from '../services/mvp-content.service.js';
import { addDeployJob } from '../queues/deploy.queue.js';

export const createAiWorker = (): Worker => {
  const worker = new Worker<IAiGenerationJobData>(
    QUEUE_NAMES.AI_GENERATION,
    async (job: Job<IAiGenerationJobData>) => {
      const { leadId, auditId } = job.data;
      console.log(`[AiWorker] Processing AI content generation for leadId: ${leadId}, auditId: ${auditId}`);

      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      const audit = await Audit.findOne({
        $or: [{ _id: auditId }, { leadId }],
      }).exec();

      // 1. Transition Lead status to GENERATING
      await Lead.findByIdAndUpdate(leadId, { status: 'GENERATING' }).exec();

      // 2. Synthesize high-converting MVP copy with Strict Grounding
      const generationResult = await mvpContentService.generateContent({
        businessName: lead.businessName,
        niche: lead.niche,
        city: lead.city,
        originalUrl: lead.originalUrl,
        extractedServices: audit?.extractedServices,
        contacts: {
          phone: lead.contactPhone,
          email: lead.contactEmail,
        },
        critiqueQuickWins: audit?.designCritique?.quickWins,
        ownerName: lead.ownerName,
      });

      // 3. Persist generated copy to Audit
      if (audit) {
        await Audit.findByIdAndUpdate(audit._id, {
          generatedContent: generationResult.content,
          aiFallbackUsed: audit.aiFallbackUsed || generationResult.aiFallbackUsed,
        }).exec();
      }

      // 4. Transition Lead status to NEEDS_APPROVAL (Human-In-The-Loop gate)
      await Lead.findByIdAndUpdate(leadId, { status: 'NEEDS_APPROVAL' }).exec();

      // 5. Auto-chain to Deploy Queue for HTML synthesis, screenshots, and MinIO deployment
      try {
        await addDeployJob({
          leadId,
          auditId: audit?._id?.toString() || auditId,
        });
        console.log(`[AiWorker] Dispatched MVP Deploy job for lead ${leadId}`);
      } catch (deployErr) {
        console.error(`[AiWorker] Failed to dispatch deploy job for lead ${leadId}:`, deployErr);
      }

      console.log(
        `[AiWorker] Content generated successfully for ${lead.businessName}. Status set to NEEDS_APPROVAL (Fallback: ${generationResult.aiFallbackUsed}).`,
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
  });

  return worker;
};
