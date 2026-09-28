import { Worker, Job, UnrecoverableError } from 'bullmq';
import { IDiscoveryJobData, IDiscoveryJobResult } from '@revamp/shared-types';
import { countCandidatesByStatus } from '@revamp/validation';
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
        const counts = result.counts ?? countCandidatesByStatus(result.candidates);
        console.log(
          `[DiscoveryWorker] Job ${job.id} done after ${result.requests} request(s)` +
            `${result.exhausted ? ' (provider exhausted)' : ''}: found ${result.found}, new ${counts.new}, ` +
            `already leads ${counts.existing_lead}, duplicates ${counts.duplicate}, ` +
            `no website ${counts.no_website}, invalid ${counts.invalid}`,
        );
        const assessments = result.candidates.flatMap((c) => (c.assessment ? [c.assessment] : []));
        if (assessments.length > 0) {
          const tally = (key: string) =>
            assessments.filter((a) => (a.outcome === 'assessed' ? a.verdict : 'failed') === key).length;
          console.log(
            `[DiscoveryWorker] Job ${job.id} assessed ${assessments.length} site(s): good ${tally('good')}, ` +
              `maybe ${tally('maybe')}, poor ${tally('poor')}, could not assess ${tally('failed')}`,
          );
        }
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
