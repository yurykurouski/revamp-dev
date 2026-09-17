import { Worker, Job } from 'bullmq';
import { IAiGenerationJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';

export const createAiWorker = (): Worker => {
  const worker = new Worker<IAiGenerationJobData>(
    QUEUE_NAMES.AI_GENERATION,
    async (job: Job<IAiGenerationJobData>) => {
      console.log(`[AiWorker] Processing job ${job.id} for leadId: ${job.data.leadId}`);
      // DesignCritiqueAgent and MvpContentAgent integration in REV-9 & REV-12
      return {
        success: true,
        leadId: job.data.leadId,
        auditId: job.data.auditId,
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
