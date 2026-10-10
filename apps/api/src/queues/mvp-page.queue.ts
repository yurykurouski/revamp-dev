import { Queue, QueueEvents } from 'bullmq';
import { IMvpPageJobData, IMvpPageJobResult } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

/**
 * How long the API waits for a change in the operator's words (REV-139): up to two model calls (the generator keeps to
 * the job's deadline, less the time a publish needs) plus finishing, uploading and measuring the page
 */
export const MVP_PAGE_CHANGE_WAIT_MS = 420_000;

/** How long the API waits for palette and fonts or a restore: a publish, with no model call */
export const MVP_PAGE_PUBLISH_WAIT_MS = 120_000;

export const mvpPageQueue = new Queue<IMvpPageJobData, IMvpPageJobResult, string>(QUEUE_NAMES.MVP_PAGE, {
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
  queueEvents ??= new QueueEvents(QUEUE_NAMES.MVP_PAGE, { connection: redisConnection });
  return queueEvents;
};

/** Closes the QueueEvents listener, which holds its own Redis connection, if it was ever opened */
export async function closeMvpPageEvents(): Promise<void> {
  const events = queueEvents;
  queueEvents = null;
  await events?.close();
}

export type MvpPageOutcome =
  | { status: 'done'; result: IMvpPageJobResult }
  | { status: 'failed'; reason: string }
  | { status: 'timeout' };

/**
 * Queues an operator's change to a model-designed page (REV-85, REV-139) and waits for the worker's result. The job
 * carries the moment the API stops waiting, after which the worker no longer applies it.
 */
export async function runMvpPageJob(data: Omit<IMvpPageJobData, 'deadline'>, timeoutMs: number): Promise<MvpPageOutcome> {
  const events = getQueueEvents();
  await events.waitUntilReady();
  const job = await mvpPageQueue.add(data.action, { ...data, deadline: Date.now() + timeoutMs });

  try {
    const result = await job.waitUntilFinished(events, timeoutMs);
    return { status: 'done', result };
  } catch (error) {
    const state = await job.getState();
    if (state === 'failed') {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') await job.remove().catch(() => undefined);
    return { status: 'timeout' };
  }
}
