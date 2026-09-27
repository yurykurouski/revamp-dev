import { Queue, QueueEvents } from 'bullmq';
import { IEmailTestJobData, IEmailTestJobResult } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

/** How long the API waits for the workers to report a test send */
export const EMAIL_TEST_TIMEOUT_MS = 30_000;

export const emailTestQueue = new Queue<IEmailTestJobData, IEmailTestJobResult, string>(QUEUE_NAMES.EMAIL_TEST, {
  connection: redisConnection,
  defaultJobOptions: {
    // The operator is waiting for the answer, so a failure is reported instead of retried
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

let queueEvents: QueueEvents | null = null;
const getQueueEvents = (): QueueEvents => {
  queueEvents ??= new QueueEvents(QUEUE_NAMES.EMAIL_TEST, { connection: redisConnection });
  return queueEvents;
};

export type EmailTestOutcome =
  | { status: 'sent'; result: IEmailTestJobResult }
  | { status: 'failed'; reason: string }
  | { status: 'timeout' };

/**
 * Queues a test send and waits for the worker's real result (REV-60), so the operator is told
 * "sent" only when the provider accepted the email.
 */
export async function sendTestEmailJob(
  data: IEmailTestJobData,
  timeoutMs = EMAIL_TEST_TIMEOUT_MS,
): Promise<EmailTestOutcome> {
  const events = getQueueEvents();
  await events.waitUntilReady();
  const job = await emailTestQueue.add('test-email', data);

  try {
    const result = await job.waitUntilFinished(events, timeoutMs);
    return { status: 'sent', result };
  } catch (error) {
    const state = await job.getState();
    if (state === 'failed') {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    // Nobody picked it up in time: drop it so the email doesn't arrive long after the operator was told it failed
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') await job.remove().catch(() => undefined);
    return { status: 'timeout' };
  }
}
