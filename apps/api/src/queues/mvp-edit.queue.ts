import { Queue, QueueEvents } from 'bullmq';
import { IMvpEditJobData, IMvpEditJobResult } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

/**
 * How long the API waits for a free-text change to be interpreted and re-published: the model call
 * (the local Claude CLI may take up to its 120 s timeout) plus rendering and uploading the page.
 */
export const MVP_EDIT_TIMEOUT_MS = 150_000;

export const mvpEditQueue = new Queue<IMvpEditJobData, IMvpEditJobResult, string>(QUEUE_NAMES.MVP_EDIT, {
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
  queueEvents ??= new QueueEvents(QUEUE_NAMES.MVP_EDIT, { connection: redisConnection });
  return queueEvents;
};

/** Closes the QueueEvents listener, which holds its own Redis connection, if it was ever opened */
export async function closeMvpEditEvents(): Promise<void> {
  const events = queueEvents;
  queueEvents = null;
  await events?.close();
}

export type MvpEditOutcome =
  | { status: 'done'; result: IMvpEditJobResult }
  | { status: 'failed'; reason: string }
  | { status: 'timeout' };

/**
 * Queues an operator's free-text change to an MVP (REV-85) and waits for the worker's result. The job
 * carries the moment the API stops waiting, after which the worker no longer applies the change.
 */
export async function runMvpEditJob(
  data: Omit<IMvpEditJobData, 'deadline'>,
  timeoutMs = MVP_EDIT_TIMEOUT_MS,
): Promise<MvpEditOutcome> {
  const events = getQueueEvents();
  await events.waitUntilReady();
  const job = await mvpEditQueue.add('edit-mvp', { ...data, deadline: Date.now() + timeoutMs });

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
