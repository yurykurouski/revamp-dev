import { Queue } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

export const auditQueue = new Queue<IAuditJobData>(QUEUE_NAMES.AUDIT, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

export const addAuditJob = async (data: IAuditJobData) => {
  return await auditQueue.add('audit-website', data);
};
