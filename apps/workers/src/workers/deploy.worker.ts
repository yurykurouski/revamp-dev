import { Worker, Job } from 'bullmq';
import { IDeployJobData, ILead, IAudit } from '@revamp/shared-types';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { bentoTemplateService } from '../services/template.service.js';
import { storageService } from '../services/storage.service.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { handleGenerationFailure } from './generation-failure.js';

function transliterate(str: string): string {
  const ruToEn: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  return str
    .toLowerCase()
    .split('')
    .map((char) => ruToEn[char] ?? char)
    .join('');
}

export const createDeployWorker = (): Worker => {
  const worker = new Worker<IDeployJobData>(
    QUEUE_NAMES.DEPLOY,
    async (job: Job<IDeployJobData>) => {
      const { leadId, auditId, forceRegenerate = false } = job.data;
      console.log(
        `[DeployWorker] Deploying MVP static site for lead: ${leadId}, audit: ${auditId}` +
          (forceRegenerate ? ' (regeneration: replacing the existing preview)' : ''),
      );

      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      const audit = await Audit.findOne({
        $or: [{ _id: auditId }, { leadId }],
      }).exec();
      if (!audit) {
        throw new Error(`Audit ${auditId || leadId} not found`);
      }

      // 1. Preview slug. An existing project keeps its slug, so a regeneration (REV-31) overwrites
      // the same objects in the demos bucket and the preview URL already shared stays valid.
      const existingProject = await MvpProject.findOne({ leadId: lead._id }).select('previewSlug').exec();
      const transliterated = transliterate(lead.businessName || lead.domain || 'demo');
      const rawSlug = transliterated
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'preview';
      const slug = existingProject?.previewSlug || `${rawSlug}-${leadId.toString().slice(-6)}`;

      // 2. Render Bento Landing Page HTML
      const html = bentoTemplateService.renderFromAudit(
        (lead.toObject ? lead.toObject() : lead) as unknown as Partial<ILead>,
        (audit.toObject ? audit.toObject() : audit) as unknown as Partial<IAudit>,
        audit.generatedContent,
      );

      // 3. Upload static HTML bundle to S3/MinIO demo sandbox
      const { url: fullPreviewUrl, key: storageHtmlPath } = await storageService.uploadHtml(
        slug,
        html,
        env.S3_BUCKET_DEMOS,
      );

      console.log(`[DeployWorker] HTML deployed to ${fullPreviewUrl}`);

      // 4. Capture mobile screenshot of newly generated MVP via Playwright
      const newMvpMobileBuffer = await browserService.captureHtmlScreenshot(html, {
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
      });

      // 5. Fetch or retrieve original mobile screenshot
      let originalMobileBuffer: Buffer;
      if (audit.screenshotUrls?.mobileOriginal) {
        try {
          const res = await fetch(audit.screenshotUrls.mobileOriginal);
          if (res.ok) {
            originalMobileBuffer = Buffer.from(await res.arrayBuffer());
          } else {
            originalMobileBuffer = newMvpMobileBuffer;
          }
        } catch {
          originalMobileBuffer = newMvpMobileBuffer;
        }
      } else {
        originalMobileBuffer = newMvpMobileBuffer;
      }

      // 6. Generate 1200x630 "Before / After" comparison banner
      const bannerBuffer = await ImageService.createComparisonBanner({
        originalMobileBuffer,
        newMvpMobileBuffer,
        businessName: lead.businessName,
        oldLcpSeconds: audit.lighthouseMetrics?.lcp ? audit.lighthouseMetrics.lcp / 1000 : undefined,
        oldA11yViolationsCount: audit.a11ySummary?.violationsCount,
        newScore: 95,
      });

      // 7. Upload comparison banner to S3/MinIO
      const comparisonBannerUrl = await storageService.uploadComparisonBanner(slug, bannerBuffer);
      console.log(`[DeployWorker] Comparison banner uploaded to ${comparisonBannerUrl}`);

      // 8. Create or update MvpProject document in MongoDB (one per lead; regeneration updates it)
      const generatedAt = new Date();
      const mvpProject = await MvpProject.findOneAndUpdate(
        { leadId: lead._id },
        {
          $inc: { generationCount: 1 },
          generatedAt,
          auditId: audit._id,
          leadId: lead._id,
          previewSlug: slug,
          fullPreviewUrl,
          storageHtmlPath,
          comparisonBannerUrl,
          generatedContent: audit.generatedContent || {
            hero: {
              badge: '',
              headline: lead.businessName,
              subheadline: audit.extractedContent?.metaDescription || lead.businessName,
              primaryCtaText: 'Send a request',
              secondaryCtaText: 'Contact us',
            },
            services: [],
            trustSignals: [],
            offerNotice: '',
          },
          colorPalette: {
            primary: audit.extractedBrandTokens?.primaryColor || '#5c5bed',
            secondary: audit.extractedBrandTokens?.secondaryColor || '#b8c4fe',
            accent: audit.extractedBrandTokens?.accentColor || '#5c5bed',
          },
          isPublished: true,
        },
        { upsert: true, new: true },
      ).exec();

      // 9. Update Audit and Lead models
      await Audit.findByIdAndUpdate(audit._id, {
        'screenshotUrls.comparisonBanner': comparisonBannerUrl,
      }).exec();

      await Lead.findByIdAndUpdate(lead._id, {
        $set: {
          status: 'NEEDS_APPROVAL',
          previewUrl: fullPreviewUrl,
          comparisonBannerUrl,
          mvpGeneratedAt: generatedAt,
        },
        $unset: { generationError: '' },
      }).exec();

      console.log(
        `[DeployWorker] Successfully deployed project ${mvpProject._id}. Ready for operator review.`,
      );

      return {
        success: true,
        mvpProjectId: mvpProject._id.toString(),
        previewSlug: slug,
        fullPreviewUrl,
        comparisonBannerUrl,
      };
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[DeployWorker] Job ${job.id} completed.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DeployWorker] Job ${job?.id} failed:`, err);
    void handleGenerationFailure(job, err, 'deploy');
  });

  return worker;
};
