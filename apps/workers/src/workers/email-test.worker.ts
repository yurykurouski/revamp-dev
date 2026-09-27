import { Worker, Job } from 'bullmq';
import { IEmailTestJobData, IEmailTestJobResult, draftToHtml } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { emailService } from '../services/email.service.js';

/** Marks test sends in the operator's inbox */
export const TEST_SUBJECT_PREFIX = '[Test] ';

/** Links in the footer of a test send point at this token; no campaign has it */
export const TEST_TRACKING_TOKEN = 'test-send';

/**
 * Sends the operator's current draft to the operator's own address (REV-60). The email goes through
 * the same provider as outreach, but it is not outreach: no HITL gate, no MX pre-check, no open
 * tracking, and the lead and its campaign are left untouched. A missing provider fails the job.
 */
export async function processEmailTestJob(data: IEmailTestJobData): Promise<IEmailTestJobResult> {
  console.log(`[EmailTestWorker] Sending a test of lead ${data.leadId}'s draft to ${data.to}`);
  const result = await emailService.sendEmail({
    to: data.to,
    subject: `${TEST_SUBJECT_PREFIX}${data.subject}`,
    html: draftToHtml(data.body, data.preheader),
    text: data.body,
    trackingToken: TEST_TRACKING_TOKEN,
    trackOpens: false,
  });
  return {
    messageId: result.messageId,
    provider: result.provider,
    sentAt: result.sentAt.toISOString(),
  };
}

export const createEmailTestWorker = (): Worker => {
  // Its own queue, so a test send is not held back by the outreach rate limit and never delays outreach
  const worker = new Worker<IEmailTestJobData, IEmailTestJobResult>(
    QUEUE_NAMES.EMAIL_TEST,
    (job: Job<IEmailTestJobData>) => processEmailTestJob(job.data),
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[EmailTestWorker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
};
