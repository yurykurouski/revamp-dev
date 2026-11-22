import { Queue, QueueEvents } from 'bullmq';
import mongoose from 'mongoose';
import { redisConnection } from '../apps/workers/src/queues/connection.js';
import { QUEUE_NAMES } from '../apps/workers/src/queues/queue.constants.js';
import { createAuditWorker } from '../apps/workers/src/workers/audit.worker.js';
import { addLeadToBusiness, Organization } from '@revamp/db';
import { normalizeDomain } from '@revamp/validation';
import { Lead } from '../apps/workers/src/models/Lead.model.js';
import { Audit } from '../apps/workers/src/models/Audit.model.js';
import { env } from '../apps/workers/src/config/env.js';
import { browserService } from '../apps/workers/src/services/browser.service.js';

async function testBullMQWorker() {
  console.log(`\n======================================================`);
  console.log(`⚡ Testing End-to-End BullMQ Audit Worker Pipeline (REV-9)`);
  console.log(`======================================================\n`);

  await mongoose.connect(env.MONGODB_URI);
  console.log(`[1] Connected to MongoDB.`);

  // Create worker
  const auditWorker = createAuditWorker();
  console.log(`[2] BullMQ Audit Worker started and listening on queue "${QUEUE_NAMES.AUDIT}"...`);

  // Create queue producer
  const auditQueue = new Queue(QUEUE_NAMES.AUDIT, { connection: redisConnection });

  // Create Lead & Audit in Mongo
  const targetUrl = process.argv[2] || 'https://news.ycombinator.com';
  const domain = new URL(targetUrl).hostname;
  // The business, the lead and its QUEUED audit, as Add lead does (REV-208)
  // The studio the lead and its job belong to (REV-210): argv[3], else the oldest organization
  const studio = process.argv[3] ?? String((await Organization.findOne({}, { _id: 1 }).sort({ createdAt: 1 }).lean())?._id ?? '');
  if (!studio) throw new Error('No organization exists: register one or pass an organization id as the third argument');
  const added = await addLeadToBusiness({
    tenantId: studio,
    deriveFromAudit: () => ({ set: {}, clearsEmailGuess: false }),
    lead: {
      businessName: `${domain} (REV-9 Demo)`,
      originalUrl: targetUrl,
      domain: normalizeDomain(domain) ?? domain.toLowerCase(),
      niche: 'other',
      contactEmail: `contact@${domain}`,
      status: 'QUEUED',
    },
  });
  if (added.reused) {
    throw new Error(`${domain} already has a completed audit (REV-208): use another URL`);
  }
  const lead = added.lead;
  const audit = added.audit!;

  console.log(`[3] Enqueuing job in BullMQ for lead ${lead._id} (${targetUrl})...`);
  const job = await auditQueue.add('audit-lead', {
    leadId: lead._id.toString(),
    tenantId: studio,
    url: targetUrl,
    niche: 'other',
  });

  const queueEvents = new QueueEvents(QUEUE_NAMES.AUDIT, { connection: redisConnection });
  await queueEvents.waitUntilReady();

  console.log(`[4] Job enqueued with ID: ${job.id}. Waiting for worker to complete...`);

  // Wait for job completion
  await job.waitUntilFinished(queueEvents, 60000);
  console.log(`[5] BullMQ job ${job.id} finished successfully!`);

  // Verify MongoDB status
  const updatedAudit = await Audit.findById(audit._id);
  const updatedLead = await Lead.findById(lead._id);

  console.log(`\n📋 MongoDB Verification (REV-9 DoD):`);
  console.log(`- Lead status:    ${updatedLead?.status}`);
  console.log(`- Lead score:     ${updatedLead?.totalScore}/100`);
  console.log(`- Audit status:   ${updatedAudit?.status}`);
  console.log(`- Total Score:    ${updatedAudit?.scores.total}/100`);
  console.log(`  * Design:       ${updatedAudit?.scores.design}/100`);
  console.log(`  * Performance:  ${updatedAudit?.scores.performance}/100`);
  console.log(`  * Accessibility:${updatedAudit?.scores.accessibility}/100`);
  console.log(`  * Standards:    ${updatedAudit?.scores.standards}/100`);
  console.log(`- AI Fallback:    ${updatedAudit?.aiFallbackUsed}`);
  console.log(`- Visual rating:  ${updatedAudit?.designCritique.visualHierarchyRating}/100`);
  console.log(`- Mobile rating:  ${updatedAudit?.designCritique.mobileFriendlinessRating}/100`);
  console.log(`- Critical Flaws: (${updatedAudit?.designCritique.criticalFlaws.length})`);
  updatedAudit?.designCritique.criticalFlaws.forEach((flaw, i) => {
    console.log(`    ${i + 1}. [${flaw.title}] -> Impact: ${flaw.impact}`);
  });
  console.log(`- Quick Wins:     (${updatedAudit?.designCritique.quickWins.length})`);
  updatedAudit?.designCritique.quickWins.forEach((win, i) => {
    console.log(`    ${i + 1}. ${win}`);
  });
  console.log(`- Desktop WebP:   ${updatedAudit?.desktopScreenshotUrl}`);
  console.log(`- Mobile WebP:    ${updatedAudit?.mobileScreenshotUrl}`);

  console.log(`\n🎨 Extracted Brand Tokens & Factual Data (REV-10 DoD):`);
  console.log(`- Primary Color:   ${updatedAudit?.extractedBrandTokens?.primaryColor}`);
  console.log(`- Secondary Color: ${updatedAudit?.extractedBrandTokens?.secondaryColor}`);
  console.log(`- Accent Color:    ${updatedAudit?.extractedBrandTokens?.accentColor}`);
  console.log(`- Font Families:   ${updatedAudit?.extractedBrandTokens?.fontFamilies?.join(', ')}`);
  console.log(`- Favicon URL:     ${updatedAudit?.extractedBrandTokens?.faviconUrl || 'N/A'}`);
  console.log(`- Logo URL:        ${updatedAudit?.extractedBrandTokens?.logoUrl?.startsWith('data:image/svg') ? 'Generated SVG Monogram' : updatedAudit?.extractedBrandTokens?.logoUrl || 'N/A'}`);
  console.log(`- Enriched Phone:  ${updatedLead?.contactPhone || 'N/A'}`);
  console.log(`- Enriched City:   ${updatedLead?.city || 'N/A'}`);

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
