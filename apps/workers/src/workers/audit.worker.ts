import { Worker, Job, UnrecoverableError } from 'bullmq';
import { IAuditJobData } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { storageService } from '../services/storage.service.js';
import { designCritiqueService } from '../services/design-critique.service.js';
import { ScoringService } from '../services/scoring.service.js';
import { BrandExtractorService } from '../services/brand-extractor.service.js';
import { classifySiteComplexity, isOnePageBrochure } from '../services/site-complexity.service.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { EMAIL_GUESSED_TAG } from '../services/discovery.constants.js';
import { isPermanentAuditError, leadStatusesInto, sanitizeAuditError } from '@revamp/validation';
import { isFinalAuditAttempt, markLeadAuditFailed } from './audit-failure.js';

// A lead can be re-audited, which creates a new Audit document; always write to the latest one
const LATEST_AUDIT = { sort: { createdAt: -1 } } as const;

export const createAuditWorker = (): Worker => {
  const worker = new Worker<IAuditJobData>(
    QUEUE_NAMES.AUDIT,
    async (job: Job<IAuditJobData>) => {
      const { leadId, url, niche } = job.data;
      console.log(`[AuditWorker] Received job ${job.id} for lead: ${leadId}, URL: ${url}, niche: ${niche}`);

      // 1. Move the lead to AUDITING. Only a queued lead (or this job's own earlier attempt) is
      // audited; a lead that was rejected or moved on meanwhile is left alone (REV-62)
      const existingLead = await Lead.findOneAndUpdate(
        { _id: leadId, status: { $in: leadStatusesInto('AUDITING', { includeSelf: true }) } },
        { $set: { status: 'AUDITING' }, $unset: { auditError: '' } },
        { new: true },
      ).exec();

      if (!existingLead) {
        const reason = `Lead ${leadId} is missing or no longer waiting for an audit; skipping it.`;
        console.warn(`[AuditWorker] ${reason}`);
        await Audit.findOneAndUpdate({ leadId }, { status: 'FAILED', errorMessage: reason }, LATEST_AUDIT).exec();
        return { success: false, skipped: true, leadId, reason };
      }

      await Audit.findOneAndUpdate({ leadId }, { status: 'PROCESSING' }, { new: true, ...LATEST_AUDIT }).exec();

      console.log(`[AuditWorker] Status updated to AUDITING/PROCESSING for lead ${leadId}`);

      try {
        // 2. Ensure S3 / MinIO storage bucket exists
        await storageService.ensureBucket();

        // 3. Capture screenshots, perform Axe-core WCAG audit, collect Vitals, and extract raw Brand DNA
        console.log(`[AuditWorker] Running Playwright crawl, a11y audit, vitals, and brand extraction for ${url}...`);
        const {
          desktopBuffer,
          mobileBuffer,
          desktopFullBuffer,
          mobileFullBuffer,
          a11yResult,
          vitalsResult,
          rawBrandData,
          cookieConsent,
          complexitySignals,
        } = await browserService.captureFullAudit(url);

        // Deterministic complexity estimate: one-page brochure sites are the easiest to replace (REV-38)
        const siteComplexity = classifySiteComplexity(complexitySignals);

        // 4. Compress screenshots to modern WebP format (max 1024px longest dimension for Vision LLM input)
        console.log(`[AuditWorker] Compressing screenshots to WebP for lead ${leadId}...`);
        const [desktopWebp, mobileWebp, desktopFullWebp, mobileFullWebp] = await Promise.all([
          ImageService.compressToWebp(desktopBuffer, { quality: 80, maxWidth: 1024, maxDimension: 1024 }),
          ImageService.compressToWebp(mobileBuffer, { quality: 80, maxWidth: 1024, maxDimension: 1024 }),
          // Full-page captures keep their native width so the operator preview stays legible
          ImageService.compressFullPageToWebp(desktopFullBuffer, { maxWidth: 1440 }),
          ImageService.compressFullPageToWebp(mobileFullBuffer, { maxWidth: 750 }),
        ]);

        // 5. Upload WebP images to S3 / MinIO
        console.log(`[AuditWorker] Uploading WebP screenshots to object storage for lead ${leadId}...`);
        const [desktopScreenshotUrl, mobileScreenshotUrl, desktopFullScreenshotUrl, mobileFullScreenshotUrl] =
          await Promise.all([
            storageService.uploadScreenshot(leadId, 'desktop', desktopWebp),
            storageService.uploadScreenshot(leadId, 'mobile', mobileWebp),
            storageService.uploadScreenshot(leadId, 'desktop-full', desktopFullWebp),
            storageService.uploadScreenshot(leadId, 'mobile-full', mobileFullWebp),
          ]);

        // 6. Brand DNA Extraction (REV-10: K-Means palette, logo/monogram, factual contacts)
        console.log(`[AuditWorker] Extracting Brand DNA & clustering palette for lead ${leadId}...`);
        const businessName = existingLead?.businessName || 'Business';
        const brandResult = BrandExtractorService.processBrandData(rawBrandData, businessName);

        // 7. Vision LLM UX/UI Critique (DesignCritiqueAgent - REV-9)
        console.log(`[AuditWorker] Running Vision UX/UI analysis for lead ${leadId}...`);
        const critiqueResult = await designCritiqueService.analyzeDesign({
          mobileScreenshotWebp: mobileWebp,
          desktopScreenshotWebp: desktopWebp,
          niche,
          a11yScore: a11yResult.a11yScore,
          lcpSeconds: vitalsResult.lcpSeconds,
          originalUrl: url,
        });

        // Record token usage event if available
        if (critiqueResult.tokenUsage) {
          try {
            await AnalyticsEvent.create({
              leadId,
              eventType: 'token_usage',
              metadata: {
                model: critiqueResult.modelUsed,
                promptTokens: critiqueResult.tokenUsage.promptTokens,
                completionTokens: critiqueResult.tokenUsage.completionTokens,
                totalTokens: critiqueResult.tokenUsage.totalTokens,
                stage: 'audit_vision_critique',
              },
            });
          } catch (eventErr) {
            console.warn(`[AuditWorker] Failed to record token_usage event for lead ${leadId}:`, eventErr);
          }
        }

        // 8. Calculate Composite Scores (Formula: 0.35 Design + 0.25 Perf + 0.20 A11y + 0.20 Standards)
        const designScore = ScoringService.calculateDesignScore(critiqueResult.critique);
        const scores = ScoringService.calculateCompositeScore({
          designScore,
          performanceScore: vitalsResult.performanceScore,
          accessibilityScore: a11yResult.a11yScore,
          standardsScore: vitalsResult.standardsScore,
        });

        // Measurements that failed on their own leave their values out and are listed instead (REV-100)
        const measurementErrors = [...vitalsResult.errors, ...a11yResult.errors];
        for (const failure of measurementErrors) {
          console.warn(`[AuditWorker] ${failure.measurement} not measured for lead ${leadId}: ${failure.message}`);
        }
        const measuredFields: Record<string, unknown> = {
          a11yScore: a11yResult.a11yScore,
          lcp: vitalsResult.lcpSeconds,
          a11ySummary: a11yResult.summary,
        };
        // `scores` and `lighthouseMetrics` are replaced whole; the fields below are unset when not measured
        const unmeasured = Object.keys(measuredFields).filter((key) => measuredFields[key] === undefined);

        // 9. Update Audit document in MongoDB with full metrics, critique, brand tokens, and COMPLETED status
        const updatedAudit = await Audit.findOneAndUpdate(
          { leadId },
          {
            ...(unmeasured.length > 0 ? { $unset: Object.fromEntries(unmeasured.map((key) => [key, ''])) } : {}),
            status: 'COMPLETED',
            completedAt: new Date(),
            desktopScreenshotUrl,
            mobileScreenshotUrl,
            screenshotUrls: {
              desktopOriginal: desktopScreenshotUrl,
              mobileOriginal: mobileScreenshotUrl,
              desktopFull: desktopFullScreenshotUrl,
              mobileFull: mobileFullScreenshotUrl,
            },
            ...Object.fromEntries(Object.entries(measuredFields).filter(([, value]) => value !== undefined)),
            scores,
            lighthouseMetrics: vitalsResult.lighthouseMetrics,
            measurementErrors,
            designCritique: critiqueResult.critique,
            aiFallbackUsed: critiqueResult.aiFallbackUsed,
            extractedBrandTokens: brandResult.tokens,
            extractedServices: brandResult.services,
            extractedContacts: brandResult.contacts,
            extractedContent: brandResult.siteContent,
            cookieBannerHandled: cookieConsent,
            siteComplexity,
          },
          { new: true, ...LATEST_AUDIT },
        ).exec();

        // 10. Update Lead status to AUDITED, save totalScore, and enrich contacts if found
        const leadUpdate: Record<string, unknown> = {
          status: 'AUDITED',
          totalScore: scores.total,
          siteComplexity: siteComplexity.class,
          onePageBrochure: isOnePageBrochure(siteComplexity.class),
        };
        if (!existingLead?.contactPhone && brandResult.contacts.phone) {
          leadUpdate['contactPhone'] = brandResult.contacts.phone;
        }
        // Discovered leads start with an info@<domain> guess and manual leads may have no email at
        // all; either way the email published on the site takes its place (REV-45)
        const emailGuessed = existingLead?.tags?.includes(EMAIL_GUESSED_TAG);
        if ((emailGuessed || !existingLead?.contactEmail) && brandResult.contacts.email) {
          leadUpdate['contactEmail'] = brandResult.contacts.email;
          if (emailGuessed) leadUpdate['$pull'] = { tags: EMAIL_GUESSED_TAG };
        }
        // The full street address is persisted on the Audit (extractedContacts), not as the lead's city

        // Only a lead this run is still auditing becomes AUDITED (GENERATING → AUDITED is a failed
        // generation, not an audit); a lead rejected mid-audit stays so (REV-62)
        const auditedLead = await Lead.findOneAndUpdate({ _id: leadId, status: 'AUDITING' }, leadUpdate).exec();

        // 11. Auto-chain to AI Content Generation Queue
        if (!auditedLead) {
          console.warn(`[AuditWorker] Lead ${leadId} left AUDITING during the audit; not generating an MVP.`);
        } else {
          try {
            await addAiGenerationJob({
              leadId,
              auditId: updatedAudit?._id?.toString() || leadId,
            });
            console.log(`[AuditWorker] Dispatched AI generation job for lead ${leadId}`);
          } catch (chainErr) {
            console.error(`[AuditWorker] Failed to dispatch AI generation job for lead ${leadId}:`, chainErr);
          }
        }

        console.log(
          `[AuditWorker] Successfully completed audit for lead ${leadId}:\n` +
            `   - Total Score:    ${scores.total}/100\n` +
            `   - Design:         ${scores.design}/100 (Fallback used: ${critiqueResult.aiFallbackUsed})\n` +
            `   - Primary Color:  ${brandResult.tokens.primaryColor} (Accent: ${brandResult.tokens.accentColor})\n` +
            `   - Logo / Brand:   ${brandResult.tokens.logoUrl ? 'Extracted' : 'Monogram'}\n` +
            `   - a11yScore:      ${scores.accessibility ?? 'not measured'}/100 (${a11yResult.summary?.violationsCount ?? '?'} violations)\n` +
            `   - Performance:    ${scores.performance ?? 'not measured'}/100 (LCP: ${vitalsResult.lcpSeconds ?? '?'}s)\n` +
            `   - Standards:      ${scores.standards ?? 'not measured'}/100 (SSL: ${vitalsResult.standards?.hasSsl ?? '?'})\n` +
            `   - Complexity:     ${siteComplexity.class} (${siteComplexity.reasons.join(', ')})\n` +
            `   - Desktop URL:    ${desktopScreenshotUrl}\n` +
            `   - Mobile URL:     ${mobileScreenshotUrl}\n` +
            `   - Full-page URLs: ${desktopFullScreenshotUrl}, ${mobileFullScreenshotUrl}`,
        );

        return {
          success: true,
          leadId,
          url,
          a11yScore: a11yResult.a11yScore,
          lcp: vitalsResult.lcpSeconds,
          desktopScreenshotUrl,
          mobileScreenshotUrl,
          desktopFullScreenshotUrl,
          mobileFullScreenshotUrl,
          totalScore: scores.total,
          scores,
          measurementErrors,
          designCritique: critiqueResult.critique,
          aiFallbackUsed: critiqueResult.aiFallbackUsed,
          extractedBrandTokens: brandResult.tokens,
          contacts: brandResult.contacts,
          services: brandResult.services,
          siteComplexity,
          processedAt: new Date().toISOString(),
        };
      } catch (error: unknown) {
        const errorMessage = sanitizeAuditError(error);
        const permanent = isPermanentAuditError(errorMessage);
        console.error(`[AuditWorker] Error processing audit for lead ${leadId}:`, error);

        await Audit.findOneAndUpdate(
          { leadId },
          {
            status: 'FAILED',
            errorMessage,
          },
          LATEST_AUDIT,
        ).exec();

        // REV-44: retries keep the lead in AUDITING; the last attempt moves it to AUDIT_FAILED
        if (isFinalAuditAttempt(job, permanent)) {
          await markLeadAuditFailed(job, errorMessage);
        }

        // A domain that does not resolve or an invalid certificate will not recover on retry
        if (permanent) {
          throw new UnrecoverableError(errorMessage);
        }
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
