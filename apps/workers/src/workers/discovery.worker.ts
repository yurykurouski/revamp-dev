import { Worker, Job, UnrecoverableError } from 'bullmq';
import { IDiscoveryJobData, IDiscoveryJobResult } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { runDiscovery } from '../services/discovery.service.js';

// Failures that a retry cannot fix
const PERMANENT_ERRORS = [/not configured/i, /Location not found/i, /no usable geometry/i, /Unknown discovery provider/i, /HTTP 4(00|01|03)/];

export const createDiscoveryWorker = (): Worker => {
  const worker = new Worker<IDiscoveryJobData, IDiscoveryJobResult>(
    QUEUE_NAMES.DISCOVERY,
    async (job: Job<IDiscoveryJobData>) => {
      const { provider, niche, location, keyword, limit } = job.data;
      console.log(
        `[DiscoveryWorker] Job ${job.id}: ${provider} search for ${keyword ?? niche} in "${location}" (limit ${limit})`,
      );

      try {
        const result = await runDiscovery(job.data);
        console.log(
          `[DiscoveryWorker] Job ${job.id} done: found ${result.found}, created ${result.created}, ` +
            `no website ${result.skippedNoWebsite}, duplicates ${result.skippedDuplicate}, invalid ${result.skippedInvalid}`,
        );
        return result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[DiscoveryWorker] Job ${job.id} failed:`, message);
        if (PERMANENT_ERRORS.some((pattern) => pattern.test(message))) {
          throw new UnrecoverableError(message);
        }
        throw error;
      }
    },
    {
      connection: redisConnection,
      // Nominatim and Overpass fair-use policies allow roughly one request at a time
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[DiscoveryWorker] Job ${job?.id} failed permanently or will retry:`, err.message);
  });

  return worker;
};
