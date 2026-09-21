import { Queue, QueueEvents } from 'bullmq';
import mongoose from 'mongoose';
import { redisConnection } from '../apps/workers/src/queues/connection.js';
import { QUEUE_NAMES } from '../apps/workers/src/queues/queue.constants.js';
import { createAuditWorker } from '../apps/workers/src/workers/audit.worker.js';
import { Lead } from '../apps/workers/src/models/Lead.model.js';
import { Audit } from '../apps/workers/src/models/Audit.model.js';
import { env } from '../apps/workers/src/config/env.js';
import { browserService } from '../apps/workers/src/services/browser.service.js';

async function testBullMQWorker() {
  console.log(`\n======================================================`);
  console.log(`⚡ Testing End-to-End BullMQ Audit Worker Pipeline`);
  console.log(`======================================================\n`);

  await mongoose.connect(env.MONGODB_URI);
  console.log(`[1] Connected to MongoDB.`);

  // Create worker
  const auditWorker = createAuditWorker();
  console.log(`[2] BullMQ Audit Worker started and listening on queue "${QUEUE_NAMES.AUDIT}"...`);

  // Create queue producer
  const auditQueue = new Queue(QUEUE_NAMES.AUDIT, { connection: redisConnection });

  // Create Lead & Audit in Mongo
  const targetUrl = 'https://news.ycombinator.com';
  const domain = new URL(targetUrl).hostname;
  const lead = await Lead.create({
    businessName: `${domain} (BullMQ Demo)`,
    originalUrl: targetUrl,
    domain: domain,
    niche: 'other',
    contactEmail: `news@${domain}`,
    status: 'QUEUED',
  });
  const audit = await Audit.create({
    leadId: lead._id,
    status: 'QUEUED',
  });

  console.log(`[3] Enqueuing job in BullMQ for lead ${lead._id} (${targetUrl})...`);
  const job = await auditQueue.add('audit-lead', {
    leadId: lead._id.toString(),
    url: targetUrl,
  });

  const queueEvents = new QueueEvents(QUEUE_NAMES.AUDIT, { connection: redisConnection });
  await queueEvents.waitUntilReady();

  console.log(`[4] Job enqueued with ID: ${job.id}. Waiting for worker to complete...`);

  // Wait for job completion
  await job.waitUntilFinished(queueEvents, 45000);
  console.log(`[5] BullMQ job ${job.id} finished successfully!`);

  // Verify MongoDB status
  const updatedAudit = await Audit.findById(audit._id);
  const updatedLead = await Lead.findById(lead._id);

  console.log(`\n📋 MongoDB Verification:`);
  console.log(`- Lead status:   ${updatedLead?.status}`);
  console.log(`- Audit status:  ${updatedAudit?.status}`);
  console.log(`- Desktop WebP:  ${updatedAudit?.desktopScreenshotUrl}`);
  console.log(`- Mobile WebP:   ${updatedAudit?.mobileScreenshotUrl}`);

  await queueEvents.close();
  await auditWorker.close();
  await auditQueue.close();
  await browserService.close();
  await redisConnection.quit();
  await mongoose.disconnect();

  console.log(`\n✅ End-to-End BullMQ verification completed successfully!\n`);
}

testBullMQWorker().catch((err) => {
  console.error('BullMQ test failed:', err);
  process.exit(1);
});
