import { Worker, Job } from 'bullmq';
import { IEmailTestJobData, IEmailTestJobResult, draftToHtml } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { loadStudioSender, simulateDelivery } from '../services/email.service.js';
import { jobTenant } from '../tenant.js';

/** Marks test sends in the operator's inbox */
export const TEST_SUBJECT_PREFIX = '[Test] ';

/** Links in the footer of a test send point at this token; no campaign has it */
export const TEST_TRACKING_TOKEN = 'test-send';

/**
 * Simulates sending the operator's current draft to the operator's own address (REV-60, REV-221). The message is
 * rendered like outreach, From the studio's sender, but it is not outreach and nothing is delivered or stored: no HITL
 * gate, no MX pre-check, no open pixel, and the lead and its campaign are left untouched. A studio without a sender
 * fails the job.
 */
export async function processEmailTestJob(data: IEmailTestJobData): Promise<IEmailTestJobResult> {
  // The job names its studio and the sender is read from it: a job without one is refused (REV-210)
  const tenant = jobTenant(data.tenantId);
  console.log(`[EmailTestWorker] Simulating a test of lead ${data.leadId}'s draft to ${data.to}`);
  const sender = await loadStudioSender(tenant);
  if (!sender) throw new Error('SENDER_NOT_CONFIGURED: this studio has no sender');
  const message = simulateDelivery({
    sender,
    to: data.to,
    subject: `${TEST_SUBJECT_PREFIX}${data.subject}`,
    html: draftToHtml(data.body, data.preheader),
    text: data.body,
    trackingToken: TEST_TRACKING_TOKEN,
    trackOpens: false,
  });
  return { to: message.to, from: message.from, subject: message.subject, simulated: true };
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
