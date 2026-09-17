import { Worker, Job } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';

export const createAuditWorker = (): Worker => {
  const worker = new Worker<IAuditJobData>(
    QUEUE_NAMES.AUDIT,
    async (job: Job<IAuditJobData>) => {
      console.log(`[AuditWorker] Processing job ${job.id} for URL: ${job.data.url}`);
      // Audit pipeline: Playwright, Axe-core, Lighthouse will be integrated in REV-7 & REV-8
      return {
        success: true,
        leadId: job.data.leadId,
        url: job.data.url,
      };
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
  });

  return worker;
};
