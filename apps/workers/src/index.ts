import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createAuditWorker } from './workers/audit.worker.js';
import { createAiWorker } from './workers/ai.worker.js';
import { createDeployWorker } from './workers/deploy.worker.js';
import { createEmailWorker } from './workers/email.worker.js';
import { redisConnection } from './queues/connection.js';
import { browserService } from './services/browser.service.js';
import { Lead } from './models/Lead.model.js';
import { Audit } from './models/Audit.model.js';
import { addAiGenerationJob } from './queues/ai.queue.js';

export async function recoverStalledAuditedLeads(): Promise<number> {
  try {
    const stalledLeads = await Lead.find({ status: 'AUDITED' }).exec();
    if (stalledLeads.length === 0) return 0;

    console.log(`[Workers Recovery] Found ${stalledLeads.length} leads in AUDITED status. Checking for completed audits to auto-enqueue...`);
    let enqueuedCount = 0;

    for (const lead of stalledLeads) {
      const audit = await Audit.findOne({
        leadId: lead._id,
        status: 'COMPLETED',
      })
        .sort({ createdAt: -1 })
        .exec();

      if (audit) {
        await addAiGenerationJob({
          leadId: lead._id.toString(),
          auditId: audit._id.toString(),
        });
        enqueuedCount++;
        console.log(`[Workers Recovery] Auto-enqueued stalled lead: ${lead.businessName} (${lead._id}) -> AI Generation Queue`);
      }
    }

    console.log(`[Workers Recovery] Auto-enqueued ${enqueuedCount} leads for AI content synthesis.`);
    return enqueuedCount;
  } catch (error) {
    console.error('[Workers Recovery] Error recovering stalled audited leads:', error);
    return 0;
  }
}

async function startWorkers(): Promise<void> {
  try {
    console.log(`[Workers] Connecting to MongoDB at ${env.MONGODB_URI}...`);
    await mongoose.connect(env.MONGODB_URI);
    console.log('[Workers] MongoDB connected successfully.');

    console.log('[Workers] Initializing BullMQ workers...');
    const auditWorker = createAuditWorker();
    const aiWorker = createAiWorker();
    const deployWorker = createDeployWorker();
    const emailWorker = createEmailWorker();

    console.log('[Workers] All background workers are active and listening.');

    // Auto-advance any leads that completed audit before auto-chaining was active
    await recoverStalledAuditedLeads();

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`[Workers] Received ${signal}. Closing workers gracefully...`);
      await Promise.all([
        auditWorker.close(),
        aiWorker.close(),
        deployWorker.close(),
        emailWorker.close(),
      ]);
      await browserService.close();
      await redisConnection.quit();
      await mongoose.disconnect();
      console.log('[Workers] All workers closed and connections closed.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Workers] Fatal error starting workers:', error);
    process.exit(1);
  }
}

if (env.NODE_ENV !== 'test') {
  startWorkers();
}
