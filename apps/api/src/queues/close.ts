import { auditQueue } from './audit.queue.js';
import { aiGenerationQueue } from './ai.queue.js';
import { deployQueue } from './deploy.queue.js';
import { emailQueue } from './email.queue.js';
import { discoveryQueue } from './discovery.queue.js';
import { emailTestQueue, closeEmailTestEvents } from './email-test.queue.js';
import { mvpPageQueue, closeMvpPageEvents } from './mvp-page.queue.js';

/**
 * Closes every BullMQ queue the API produces to (REV-66). The queues share `redisConnection`,
 * which BullMQ leaves open, so the caller quits it afterwards.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    auditQueue.close(),
    aiGenerationQueue.close(),
    deployQueue.close(),
    emailQueue.close(),
    discoveryQueue.close(),
    emailTestQueue.close(),
    closeEmailTestEvents(),
    mvpPageQueue.close(),
    closeMvpPageEvents(),
  ]);
}
