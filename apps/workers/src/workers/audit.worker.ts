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

        // 3. Capture screenshots, perform Axe-core WCAG audit, and collect Core Web Vitals
        console.log(`[AuditWorker] Running Playwright crawl, a11y audit, and vitals collection for ${url}...`);
        const {
          desktopBuffer,
          mobileBuffer,
          a11yResult,
          vitalsResult,
        } = await browserService.captureFullAudit(url);

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

        // 6. Aggregate Scores (Design score will be computed in REV-9 by Vision LLM)
        const totalScore = Math.round(
          a11yResult.a11yScore * 0.4 +
            vitalsResult.performanceScore * 0.4 +
            vitalsResult.standardsScore * 0.2,
        );

        // 7. Update Audit document in MongoDB with full deterministic metrics
        await Audit.findOneAndUpdate(
          { leadId },
          {
            desktopScreenshotUrl,
            mobileScreenshotUrl,
            screenshotUrls: {
              desktopOriginal: desktopScreenshotUrl,
              mobileOriginal: mobileScreenshotUrl,
            },
            a11yScore: a11yResult.a11yScore,
            lcp: vitalsResult.lcpSeconds,
            scores: {
              total: totalScore,
              design: 0,
              accessibility: a11yResult.a11yScore,
              performance: vitalsResult.performanceScore,
              standards: vitalsResult.standardsScore,
            },
            lighthouseMetrics: vitalsResult.lighthouseMetrics,
            a11ySummary: a11yResult.summary,
          },
          { new: true },
        ).exec();

        // 8. Update Lead totalScore
        await Lead.findByIdAndUpdate(leadId, { totalScore }).exec();

        console.log(
          `[AuditWorker] Successfully completed audit for lead ${leadId}:\n` +
            `   - a11yScore:   ${a11yResult.a11yScore}/100 (${a11yResult.summary.violationsCount} violations)\n` +
            `   - LCP:         ${vitalsResult.lcpSeconds}s (Perf score: ${vitalsResult.performanceScore}/100)\n` +
            `   - Standards:   ${vitalsResult.standardsScore}/100 (SSL: ${vitalsResult.standards.hasSsl})\n` +
            `   - Desktop URL: ${desktopScreenshotUrl}\n` +
            `   - Mobile URL:  ${mobileScreenshotUrl}`,
        );

        return {
          success: true,
          leadId,
          url,
          a11yScore: a11yResult.a11yScore,
          lcp: vitalsResult.lcpSeconds,
          desktopScreenshotUrl,
          mobileScreenshotUrl,
          totalScore,
          processedAt: new Date().toISOString(),
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Failed to complete audit inspection';
        console.error(`[AuditWorker] Error processing audit for lead ${leadId}:`, error);

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
