import { Queue } from 'bullmq';
import { IDeployJobData } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

export const deployQueue = new Queue<IDeployJobData>(QUEUE_NAMES.DEPLOY, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 200,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

/** How long a relayout waits for further layout picks on the same MVP before it runs */
export const RELAYOUT_DEBOUNCE_MS = 1500;

/**
 * Re-publishes an MVP in the layout the operator saved (REV-84). The deploy worker re-renders the
 * stored copy with the deterministic template; no LLM call and no lead status change.
 *
 * Debounced per MVP: a pick made while the job still waits replaces it, so a burst of clicks renders
 * once. The worker reads the saved layout when it runs, and the deduplication ends when the delay
 * does, so a pick made while a job is running gets a job of its own.
 */
export const addMvpRelayoutJob = async (data: { leadId: string; auditId: string; mvpProjectId: string }) => {
  return await deployQueue.add(
    'relayout-mvp',
    { ...data, mode: 'relayout' },
    {
      delay: RELAYOUT_DEBOUNCE_MS,
      deduplication: { id: `relayout-${data.mvpProjectId}`, ttl: RELAYOUT_DEBOUNCE_MS, extend: true, replace: true },
    },
  );
};
