import { Worker, Job } from 'bullmq';
import { IEmailDispatchJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';

export const createEmailWorker = (): Worker => {
  const worker = new Worker<IEmailDispatchJobData>(
    QUEUE_NAMES.EMAIL_DISPATCH,
    async (job: Job<IEmailDispatchJobData>) => {
      console.log(`[EmailWorker] Processing email campaign ${job.data.campaignId}`);
      // Email dispatch logic with jitter & rate-limiting will be implemented in REV-17
      return {
        success: true,
        campaignId: job.data.campaignId,
      };
    },
    {
      connection: redisConnection,
      concurrency: 1, // Strict single-stream rate-limited dispatch
    },
  );

  worker.on('completed', (job) => {
    console.log(`[EmailWorker] Job ${job.id} completed.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
};
