import { Worker, Job } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { storageService } from '../services/storage.service.js';
import { designCritiqueService } from '../services/design-critique.service.js';
import { ScoringService } from '../services/scoring.service.js';

export const createAuditWorker = (): Worker => {
  const worker = new Worker<IAuditJobData>(
    QUEUE_NAMES.AUDIT,
    async (job: Job<IAuditJobData>) => {
      const { leadId, url, niche } = job.data;
      console.log(`[AuditWorker] Received job ${job.id} for lead: ${leadId}, URL: ${url}, niche: ${niche}`);

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

        // 4. Compress screenshots to modern WebP format (max 1024px width for Vision LLM input)
        console.log(`[AuditWorker] Compressing screenshots to WebP for lead ${leadId}...`);
        const [desktopWebp, mobileWebp] = await Promise.all([
          ImageService.compressToWebp(desktopBuffer, { quality: 80, maxWidth: 1024 }),
          ImageService.compressToWebp(mobileBuffer, { quality: 80, maxWidth: 1024 }),
        ]);

        // 5. Upload WebP images to S3 / MinIO
        console.log(`[AuditWorker] Uploading WebP screenshots to object storage for lead ${leadId}...`);
        const [desktopScreenshotUrl, mobileScreenshotUrl] = await Promise.all([
          storageService.uploadScreenshot(leadId, 'desktop', desktopWebp),
          storageService.uploadScreenshot(leadId, 'mobile', mobileWebp),
        ]);

        // 6. Vision LLM UX/UI Critique (DesignCritiqueAgent - REV-9)
        console.log(`[AuditWorker] Running Vision UX/UI analysis for lead ${leadId}...`);
        const critiqueResult = await designCritiqueService.analyzeDesign({
          mobileScreenshotWebp: mobileWebp,
          desktopScreenshotWebp: desktopWebp,
          niche,
          a11yScore: a11yResult.a11yScore,
          lcpSeconds: vitalsResult.lcpSeconds,
          originalUrl: url,
        });

        // 7. Calculate Composite Scores (Formula: 0.35 Design + 0.25 Perf + 0.20 A11y + 0.20 Standards)
        const designScore = ScoringService.calculateDesignScore(critiqueResult.critique);
        const scores = ScoringService.calculateCompositeScore({
          designScore,
          performanceScore: vitalsResult.performanceScore,
          accessibilityScore: a11yResult.a11yScore,
          standardsScore: vitalsResult.standardsScore,
        });

        // 8. Update Audit document in MongoDB with full metrics, critique, and COMPLETED status
        await Audit.findOneAndUpdate(
          { leadId },
          {
            status: 'COMPLETED',
            completedAt: new Date(),
            desktopScreenshotUrl,
            mobileScreenshotUrl,
            screenshotUrls: {
              desktopOriginal: desktopScreenshotUrl,
              mobileOriginal: mobileScreenshotUrl,
            },
            a11yScore: a11yResult.a11yScore,
            lcp: vitalsResult.lcpSeconds,
            scores,
            lighthouseMetrics: vitalsResult.lighthouseMetrics,
            a11ySummary: a11yResult.summary,
            designCritique: critiqueResult.critique,
            aiFallbackUsed: critiqueResult.aiFallbackUsed,
          },
          { new: true },
        ).exec();

        // 9. Update Lead status to AUDITED and save totalScore
        await Lead.findByIdAndUpdate(leadId, {
          status: 'AUDITED',
          totalScore: scores.total,
        }).exec();

        console.log(
          `[AuditWorker] Successfully completed audit for lead ${leadId}:\n` +
            `   - Total Score: ${scores.total}/100\n` +
            `   - Design:      ${scores.design}/100 (Fallback used: ${critiqueResult.aiFallbackUsed})\n` +
            `   - a11yScore:   ${scores.accessibility}/100 (${a11yResult.summary.violationsCount} violations)\n` +
            `   - Performance: ${scores.performance}/100 (LCP: ${vitalsResult.lcpSeconds}s)\n` +
            `   - Standards:   ${scores.standards}/100 (SSL: ${vitalsResult.standards.hasSsl})\n` +
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
          totalScore: scores.total,
          scores,
          designCritique: critiqueResult.critique,
          aiFallbackUsed: critiqueResult.aiFallbackUsed,
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
            status: 'FAILED',
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
