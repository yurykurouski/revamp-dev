import { Worker, Job } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';

export const createAuditWorker = (): Worker => {
  const worker = new Worker<IAuditJobData>(
    QUEUE_NAMES.AUDIT,
    async (job: Job<IAuditJobData>) => {
      console.log(
        `[AuditWorker] Received job ${job.id} for lead: ${job.data.leadId}, URL: ${job.data.url}`,
      );

      // Update Lead and Audit status to denote active processing
      await Promise.all([
        Audit.findOneAndUpdate(
          { leadId: job.data.leadId },
          { status: 'PROCESSING' },
          { new: true },
        ).exec(),
        Lead.findByIdAndUpdate(
          job.data.leadId,
          { status: 'AUDITING' },
          { new: true },
        ).exec(),
      ]);

      console.log(`[AuditWorker] Successfully started audit processing for lead ${job.data.leadId}`);

      // Detailed Playwright crawler, Axe-core, and Lighthouse collection will be implemented in REV-7 & REV-8
      return {
        success: true,
        leadId: job.data.leadId,
        url: job.data.url,
        processedAt: new Date().toISOString(),
      };
    },
    {
      connection: redisConnection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[AuditWorker] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[AuditWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
};
