import { Queue } from 'bullmq';
import { IDiscoveryJobData, IDiscoveryJobResult } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

export const discoveryQueue = new Queue<IDiscoveryJobData, IDiscoveryJobResult>(QUEUE_NAMES.DISCOVERY, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
    // Keep finished jobs so the operator can poll their result
    removeOnComplete: {
      age: 7 * 24 * 3600,
      count: 200,
    },
    removeOnFail: {
      count: 200,
    },
  },
});

export const addDiscoveryJob = async (data: IDiscoveryJobData) => {
  return await discoveryQueue.add('discover-businesses', data);
};

export const getDiscoveryJob = async (jobId: string) => {
  return await discoveryQueue.getJob(jobId);
};
