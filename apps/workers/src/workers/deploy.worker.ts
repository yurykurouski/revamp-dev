import { Worker, Job } from 'bullmq';
import { IDeployJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';

export const createDeployWorker = (): Worker => {
  const worker = new Worker<IDeployJobData>(
    QUEUE_NAMES.DEPLOY,
    async (job: Job<IDeployJobData>) => {
      console.log(`[DeployWorker] Deploying MVP for project: ${job.data.mvpProjectId}`);
      // Static site packaging & S3/R2 upload in REV-13
      return {
        success: true,
        mvpProjectId: job.data.mvpProjectId,
      };
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[DeployWorker] Job ${job.id} completed.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DeployWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
};
