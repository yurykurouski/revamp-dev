import { Queue, JobsOptions } from 'bullmq';
import { IEmailDispatchJobData } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

/**
 * Generates a randomized jitter in seconds between minSeconds and maxSeconds (inclusive).
 * Default: 15 to 45 seconds to protect sender domain reputation and simulate human pacing.
 */
export function calculateJitter(minSeconds = 15, maxSeconds = 45): number {
  return Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

/**
 * Calculates dispatch delay in milliseconds for queued outreach jobs.
 * Combines 3-minute (180s) intervals per queue position with 15–45s randomized jitter.
 */
export function calculateDispatchDelay(
  queueIndex = 0,
  baseIntervalSeconds = 180,
  minJitter = 15,
  maxJitter = 45,
): number {
  const jitterSeconds = calculateJitter(minJitter, maxJitter);
  const totalSeconds = queueIndex * baseIntervalSeconds + jitterSeconds;
  return totalSeconds * 1000;
}

export const emailQueue = new Queue<IEmailDispatchJobData, unknown, string>(
  QUEUE_NAMES.EMAIL_DISPATCH,
  {
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
  },
);

export const addEmailDispatchJob = async (
  data: IEmailDispatchJobData,
  options?: JobsOptions,
) => {
  return await emailQueue.add('dispatch-email', data, options);
};
