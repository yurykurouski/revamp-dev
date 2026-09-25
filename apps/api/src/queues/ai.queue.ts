import { Queue } from 'bullmq';
import { IAiGenerationJobData } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

export const aiGenerationQueue = new Queue<IAiGenerationJobData>(QUEUE_NAMES.AI_GENERATION, {
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

export const addAiGenerationJob = async (data: IAiGenerationJobData) => {
  return await aiGenerationQueue.add('generate-content', data);
};
