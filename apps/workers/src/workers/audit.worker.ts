import { Worker, Job } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { storageService } from '../services/storage.service.js';

export const createAuditWorker = (): Worker => {
  const worker = new Worker<IAuditJobData>(
    QUEUE_NAMES.AUDIT,
    async (job: Job<IAuditJobData>) => {
      const { leadId, url } = job.data;
      console.log(`[AuditWorker] Received job ${job.id} for lead: ${leadId}, URL: ${url}`);

      // 1. Update Lead and Audit status to denote active processing
      await Promise.all([
        Audit.findOneAndUpdate(
          { leadId },
          { status: 'PROCESSING' },
          { new: true },
        ).exec(),
        Lead.findByIdAndUpdate(
          leadId,
          { status: 'AUDITING' },
          { new: true },
        ).exec(),
      ]);

      console.log(`[AuditWorker] Status updated to AUDITING/PROCESSING for lead ${leadId}`);

      try {
        // 2. Ensure S3 / MinIO storage bucket exists
        await storageService.ensureBucket();

        // 3. Capture Desktop (1440x900) and Mobile (375x812) screenshots via Playwright
        console.log(`[AuditWorker] Capturing screenshots for ${url}...`);
        const { desktopBuffer, mobileBuffer } = await browserService.captureScreenshots(url);

        // 4. Compress screenshots to modern WebP format
        console.log(`[AuditWorker] Compressing screenshots to WebP for lead ${leadId}...`);
        const [desktopWebp, mobileWebp] = await Promise.all([
          ImageService.compressToWebp(desktopBuffer, { quality: 80 }),
          ImageService.compressToWebp(mobileBuffer, { quality: 80 }),
        ]);

        // 5. Upload WebP images to S3 / MinIO
        console.log(`[AuditWorker] Uploading WebP screenshots to object storage for lead ${leadId}...`);
        const [desktopScreenshotUrl, mobileScreenshotUrl] = await Promise.all([
          storageService.uploadScreenshot(leadId, 'desktop', desktopWebp),
          storageService.uploadScreenshot(leadId, 'mobile', mobileWebp),
        ]);

        // 6. Update Audit document in MongoDB with screenshot URLs
        await Audit.findOneAndUpdate(
          { leadId },
          {
            desktopScreenshotUrl,
            mobileScreenshotUrl,
            screenshotUrls: {
              desktopOriginal: desktopScreenshotUrl,
              mobileOriginal: mobileScreenshotUrl,
            },
          },
          { new: true },
        ).exec();

        console.log(
          `[AuditWorker] Successfully generated and stored screenshots for lead ${leadId}.\n` +
            `   - Desktop: ${desktopScreenshotUrl}\n` +
            `   - Mobile:  ${mobileScreenshotUrl}`,
        );

        return {
          success: true,
          leadId,
          url,
          desktopScreenshotUrl,
          mobileScreenshotUrl,
          processedAt: new Date().toISOString(),
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Failed to capture or upload screenshots';
        console.error(`[AuditWorker] Error processing screenshots for lead ${leadId}:`, error);

        await Audit.findOneAndUpdate(
          { leadId },
          {
            errorMessage,
          },
        ).exec();

        throw error;
      }
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
