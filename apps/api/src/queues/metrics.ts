import type { Queue } from 'bullmq';
import type { MetricsRegistry } from '@revamp/db';
import { auditQueue } from './audit.queue.js';
import { aiGenerationQueue } from './ai.queue.js';
import { deployQueue } from './deploy.queue.js';
import { emailQueue } from './email.queue.js';
import { discoveryQueue } from './discovery.queue.js';
import { emailTestQueue } from './email-test.queue.js';
import { mvpPageQueue } from './mvp-page.queue.js';

const STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** `revamp_queue_jobs{queue,state}`: how many jobs wait, run, are delayed or failed in each BullMQ queue, read at scrape time (REV-220) */
export function registerQueueMetrics(registry: MetricsRegistry, queues: readonly Queue[] = [auditQueue, aiGenerationQueue, deployQueue, emailQueue, discoveryQueue, emailTestQueue, mvpPageQueue]): void {
  registry.gauge('revamp_queue_jobs', 'Jobs per BullMQ queue and state', ['queue', 'state'], async (gauge) => {
    for (const queue of queues) {
      const counts = await queue.getJobCounts(...STATES);
      for (const state of STATES) gauge.set({ queue: queue.name, state }, counts[state] ?? 0);
    }
  });
}
