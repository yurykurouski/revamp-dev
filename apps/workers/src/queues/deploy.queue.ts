import { Queue, JobsOptions } from 'bullmq';
import { IDeployJobData } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

export const deployQueue = new Queue<IDeployJobData, unknown, string>(
  QUEUE_NAMES.DEPLOY,
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

export const addDeployJob = async (
  data: IDeployJobData,
  options?: JobsOptions,
) => {
  return await deployQueue.add('deploy-mvp', data, options);
};
