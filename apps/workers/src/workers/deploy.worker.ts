import { Worker, Job } from 'bullmq';
import { IDeployJobData, ILead, IAudit, IMvpDesign, IMvpLayoutSelection, IRebuildEdit, MVP_LAYOUT_MANUAL_ORIGINAL, MvpLayoutVariant } from '@revamp/shared-types';
import { canChangeMvpLayout, leadStatusesInto, manualMvpLayout } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { MvpPaletteOverride } from '../services/template.service.js';
import { defaultRebuildPrimary } from '../services/rebuild-template.service.js';
import { rebuildLayout, renderMvp, requestedVariant } from '../services/mvp-render.js';
import { buildLayoutSignals, deriveMvpLayout } from '../services/layout-selection.service.js';
import { mergeDesigns } from '../templates/design.js';
import { storageService } from '../services/storage.service.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { mvpCompletenessService } from '../services/mvp-completeness.service.js';
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

type AuditDoc = NonNullable<Awaited<ReturnType<typeof findGenerationAudit>>>;

/**
 * Uploads the MVP bundle to the S3/MinIO demo sandbox under the lead's slug, then captures its mobile
 * view and uploads the 1200x630 "Before / After" comparison banner next to it.
 */
async function publishMvp(
  slug: string,
  html: string,
  lead: Pick<ILead, 'businessName'>,
  audit: AuditDoc,
): Promise<{ fullPreviewUrl: string; storageHtmlPath: string; comparisonBannerUrl: string }> {
  const { url: fullPreviewUrl, key: storageHtmlPath } = await storageService.uploadHtml(slug, html, env.S3_BUCKET_DEMOS);
  console.log(`[DeployWorker] HTML deployed to ${fullPreviewUrl}`);

  const newMvpMobileBuffer = await browserService.captureHtmlScreenshot(html, {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
  });

  // The original site's mobile screenshot, else the new MVP on both sides
  let originalMobileBuffer: Buffer = newMvpMobileBuffer;
  if (audit.screenshotUrls?.mobileOriginal) {
    try {
      const res = await fetch(audit.screenshotUrls.mobileOriginal);
      if (res.ok) originalMobileBuffer = Buffer.from(await res.arrayBuffer());
    } catch {
      // keep the fallback
    }
  }

  const bannerBuffer = await ImageService.createComparisonBanner({
    originalMobileBuffer,
    newMvpMobileBuffer,
    businessName: lead.businessName,
    oldLcpSeconds: audit.webVitals?.lcp ? audit.webVitals.lcp / 1000 : undefined,
    oldA11yViolationsCount: audit.a11ySummary?.violationsCount,
    newScore: 95,
  });

  const comparisonBannerUrl = await storageService.uploadComparisonBanner(slug, bannerBuffer);
  console.log(`[DeployWorker] Comparison banner uploaded to ${comparisonBannerUrl}`);

  return { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl };
}

/** How many times a relayout re-renders when the operator keeps changing the MVP while it publishes */
const MAX_RELAYOUT_PASSES = 3;

type SavedMvpDesign = {
  layout?: { variant?: MvpLayoutVariant; reasons?: string[] | null; design?: IMvpDesign | null } | null;
  colorPalette?: MvpPaletteOverride | null;
  design?: IMvpDesign | null;
  rebuild?: unknown;
  rebuildEdit?: IRebuildEdit | null;
};

/**
 * The layout, palette and custom design (REV-92) the operator saved on the MVP (Bento for an MVP saved
 * without a layout); the custom design applies over the one derived from the original site (REV-104).
 * A manual `original` pick that fell back to Bento still asks for the rebuild (REV-110).
 */
const savedDesign = (project: SavedMvpDesign) => ({
  variant: (project.layout?.reasons?.includes(MVP_LAYOUT_MANUAL_ORIGINAL) ? 'original' : project.layout?.variant || 'bento') as MvpLayoutVariant,
  palette: {
    primary: project.colorPalette?.primary || undefined,
    secondary: project.colorPalette?.secondary || undefined,
    accent: project.colorPalette?.accent || undefined,
  },
  design: mergeDesigns(project.layout?.design, project.design),
  // The operator's change to the rebuild (REV-111)
  rebuildEdit: project.rebuildEdit ?? undefined,
});

/** The layout a re-publish renders: the saved one, or a fresh manual `original` pick for one that had fallen back */
const savedLayout = (project: SavedMvpDesign, variant: MvpLayoutVariant): IMvpLayoutSelection => {
  if (!project.layout?.variant) return { variant: 'bento', reasons: [] };
  if (variant === 'original' && project.layout.variant !== 'original') return manualMvpLayout(project.layout, 'original');
  return project.layout as IMvpLayoutSelection;
};

const sameDesign = (a: ReturnType<typeof savedDesign>, b: ReturnType<typeof savedDesign>) =>
  a.variant === b.variant &&
  a.palette.primary === b.palette.primary &&
  a.palette.secondary === b.palette.secondary &&
  a.palette.accent === b.palette.accent &&
  JSON.stringify(a.design ?? null) === JSON.stringify(b.design ?? null) &&
  JSON.stringify(a.rebuildEdit ?? null) === JSON.stringify(b.rebuildEdit ?? null);

/**
 * Re-publishes an existing MVP in the layout (REV-84), palette (REV-90) and edits the operator saved: the
 * stored copy rendered by the deterministic template, with no LLM call and no lead status change, so the
 * page a lead is sent is the one the operator approved. The completeness report is re-checked by code on
 * the published page (REV-111), so it never describes an earlier version. Also run directly by a free-text
 * change (REV-85), which waits for the new page before it reports back.
 */
export async function republishSavedMvp(leadId: string) {
  const lead = await Lead.findById(leadId).exec();
  if (!lead) {
    throw new Error(`Lead ${leadId} not found`);
  }
  // A regeneration started since, or outreach went out: that run owns the bundle now
  if (!canChangeMvpLayout(lead.status)) {
    const reason = `Lead ${leadId} is ${lead.status}; its MVP layout and palette are no longer re-published.`;
    console.warn(`[DeployWorker] ${reason}`);
    return { success: false, skipped: true, leadId, reason };
  }

  let project = await MvpProject.findOne({ leadId: lead._id }).exec();
  if (!project) {
    throw new Error(`No MVP found for lead ${leadId}`);
  }
  const audit = await findGenerationAudit(leadId, project.auditId?.toString());
  if (!audit) {
    throw new Error(`No completed audit found for lead ${leadId}`);
  }

  const leadData = (lead.toObject ? lead.toObject() : lead) as unknown as Partial<ILead>;
  const auditData = (audit.toObject ? audit.toObject() : audit) as unknown as Partial<IAudit>;
  let published: Awaited<ReturnType<typeof publishMvp>> | undefined;
  let design = savedDesign(project);

  // The saved layout and palette are read again after each upload: a change made meanwhile gets its
  // own pass, so an older job can never leave an outdated look published
  // The lead and the audit do not change between passes; the stored copy is the one the MVP was made with
  const derived = deriveMvpLayout(auditData.siteLayout ?? undefined, buildLayoutSignals(leadData, auditData, project.generatedContent));
  let layout: IMvpLayoutSelection | undefined;
  let html: string | undefined;
  for (let pass = 0; pass < MAX_RELAYOUT_PASSES; pass++) {
    const requested = savedLayout(project, design.variant);
    const rendered = renderMvp({
      lead: leadData,
      audit: auditData,
      generatedContent: project.generatedContent,
      layout: requested,
      derived,
      palette: design.palette,
      design: design.design,
      rebuildEdit: design.rebuildEdit,
    });
    html = rendered.html;
    published = await publishMvp(project.previewSlug, rendered.html, lead, audit);
    layout = rendered.layout;

    // The rebuild summary follows the page; a fallback records its reason on the layout. A page whose
    // renderer changed (rebuild <-> Bento) cannot switch in place, so the preview reloads (REV-110)
    // (an MVP saved without a layout keeps none while it renders as Bento)
    const layoutChanged = JSON.stringify(rendered.layout) !== JSON.stringify(project.layout?.variant ? project.layout : requested);
    const switched = Boolean(project.rebuild) !== Boolean(rendered.rebuild);
    if (rendered.rebuild || project.rebuild || switched) {
      await MvpProject.findByIdAndUpdate(project._id, {
        $set: {
          ...(rendered.rebuild ? { rebuild: rendered.rebuild } : {}),
          ...(switched ? { editedAt: new Date() } : {}),
        },
        ...(rendered.rebuild ? {} : { $unset: { rebuild: '' } }),
      }).exec();
    }
    // The layout is written only while it is still the one this pass rendered from: an operator's pick
    // made during the upload wins, and shows up as a difference in the re-read below (another pass)
    if (layoutChanged) {
      const saved = await MvpProject.findOneAndUpdate(
        { _id: project._id, layout: project.layout ?? { $exists: false } },
        { $set: { layout: rendered.layout } },
      ).exec();
      // What this pass saved, so the re-read below compares against it
      if (saved) design = savedDesign({ layout: rendered.layout, colorPalette: project.colorPalette, design: project.design, rebuildEdit: project.rebuildEdit });
    }

    const latest = await MvpProject.findById(project._id).exec();
    if (!latest) break;
    const latestDesign = savedDesign(latest);
    if (sameDesign(latestDesign, design)) break;
    project = latest;
    design = latestDesign;
  }

  // The report follows the published page (REV-111): code only, no LLM call on a re-publish; never throws
  if (html) {
    const completenessReport = mvpCompletenessService.check(html, leadData, auditData);
    await MvpProject.findByIdAndUpdate(project._id, { $set: { completenessReport } }).exec();
    console.log(`[DeployWorker] Completeness re-checked (deterministic): ${completenessReport.status}`);
  }

  console.log(
    `[DeployWorker] Re-published MVP ${project._id} for lead ${leadId} in the ${layout?.variant} layout (${layout?.reasons.join(', ')}), primary ${design.palette.primary ?? 'from the audit'}`,
  );
  return { success: true, relayout: true, mvpProjectId: project._id.toString(), layout: layout?.variant, ...published };
}

export const createDeployWorker = (): Worker => {
  const worker = new Worker<IDeployJobData>(
    QUEUE_NAMES.DEPLOY,
    async (job: Job<IDeployJobData>) => {
      if (job.data.mode === 'relayout') return republishSavedMvp(job.data.leadId);

      const { leadId, auditId, forceRegenerate = false, generationSource } = job.data;
      console.log(
        `[DeployWorker] Deploying MVP static site for lead: ${leadId}, audit: ${auditId}` +
          (forceRegenerate ? ' (regeneration: replacing the existing preview)' : ''),
      );

      const lead = await Lead.findById(leadId).exec();
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      // The job's audit, else the lead's newest completed one; never a failed or stale audit (REV-55)
      const audit = await findGenerationAudit(leadId, auditId);
      if (!audit) {
        throw new Error(`No completed audit found for lead ${leadId}`);
      }

      // 1. Preview slug. An existing project keeps its slug, so a regeneration (REV-31) overwrites
      // the same objects in the demos bucket and the preview URL already shared stays valid.
      const existingProject = await MvpProject.findOne({ leadId: lead._id }).select('previewSlug design layout rebuild rebuildEdit').exec();
      const transliterated = transliterate(lead.businessName || lead.domain || 'demo');
      const rawSlug = transliterated
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'preview';
      const slug = existingProject?.previewSlug || `${rawSlug}-${leadId.toString().slice(-6)}`;

      // 2. Derive the page layout from the original site's layout (REV-104), falling back to the
      // rules on the audit data (REV-54), then render the landing page
      const leadData = (lead.toObject ? lead.toObject() : lead) as unknown as Partial<ILead>;
      const auditData = (audit.toObject ? audit.toObject() : audit) as unknown as Partial<IAudit>;
      const derived = deriveMvpLayout(auditData.siteLayout ?? undefined, buildLayoutSignals(leadData, auditData, audit.generatedContent));
      // The rebuild of the original site (REV-110), unless the operator picked a layout, which survives
      // a regeneration over the freshly derived look (REV-84); Bento with the reason when it cannot be rebuilt
      const picked = requestedVariant(existingProject?.layout);
      const requested = picked ? manualMvpLayout(derived, picked) : rebuildLayout(derived);
      // The operator's custom design survives a regeneration (REV-92); the palette comes from the new
      // audit run (the rebuild takes the site's own button color itself)
      // The operator's change to the rebuild (REV-111) names this audit's sections: kept for the same audit,
      // dropped when the generation reads a newer one
      const savedEdit = existingProject?.rebuildEdit ?? undefined;
      const rebuildEdit = savedEdit?.auditId === audit._id.toString() ? savedEdit : undefined;
      if (savedEdit && !rebuildEdit) {
        console.log(`[DeployWorker] Rebuild edit for audit ${savedEdit.auditId} dropped: the MVP is generated from audit ${audit._id.toString()}`);
      }
      const rendered = renderMvp({
        lead: leadData,
        audit: auditData,
        generatedContent: audit.generatedContent,
        layout: requested,
        derived,
        design: mergeDesigns(requested.design, existingProject?.design),
        rebuildEdit,
      });
      const { html, layout } = rendered;
      console.log(`[DeployWorker] Layout: ${layout.variant} (${layout.reasons.join(', ')})`);
      if (auditData.siteLayoutError) console.log(`[DeployWorker] Original layout not read: ${auditData.siteLayoutError}`);
      if (auditData.siteSectionsError) console.log(`[DeployWorker] Original sections not read: ${auditData.siteSectionsError}`);

      // 2b. Compare the MVP with the original site's key data (REV-36): judged by the LLM with its
      // quotes verified in code when one is configured (REV-37), else by code. Advisory only: it
      // never throws, falls back to code when the LLM fails, and a failed comparison is `unverified`.
      const completenessReport = await mvpCompletenessService.assess(html, leadData, auditData);
      console.log(
        `[DeployWorker] Completeness (${completenessReport.method ?? 'n/a'}): ${completenessReport.status}` +
          (completenessReport.score !== undefined ? `, score ${completenessReport.score}` : '') +
          (completenessReport.hasCriticalIssues ? ', critical data missing or changed' : ''),
      );

      // 3-7. Upload the bundle and a fresh Before / After banner
      const { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl } = await publishMvp(slug, html, lead, audit);

      // 8. Create or update MvpProject document in MongoDB (one per lead; regeneration updates it)
      const generatedAt = new Date();
      // Which provider and model wrote this version's copy (REV-32); a run with no operator
      // choice clears the previous run's choice
      const sourceUpdate = generationSource
        ? {
            provider: generationSource.provider,
            modelUsed: generationSource.modelUsed,
            ...(generationSource.requestedProvider
              ? { requestedProvider: generationSource.requestedProvider, requestedModel: generationSource.requestedModel }
              : {}),
          }
        : {};
      // A run with no operator choice clears the previous run's choice; a Bento page has no rebuild summary
      const unset = {
        ...(generationSource && !generationSource.requestedProvider ? { requestedProvider: '', requestedModel: '' } : {}),
        ...(rendered.rebuild ? {} : { rebuild: '' }),
        ...(savedEdit && !rebuildEdit ? { rebuildEdit: '' } : {}),
      };
      // The rebuild's CTAs default to the site's own button color (REV-110)
      const rebuildPrimary = layout.variant === 'original' ? defaultRebuildPrimary(auditData) : undefined;
      const mvpProject = await MvpProject.findOneAndUpdate(
        { leadId: lead._id },
        {
          $inc: { generationCount: 1 },
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
          ...sourceUpdate,
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
            primary: rebuildPrimary || audit.extractedBrandTokens?.primaryColor || '#5c5bed',
            secondary: audit.extractedBrandTokens?.secondaryColor || '#b8c4fe',
            accent: rebuildPrimary || audit.extractedBrandTokens?.accentColor || '#5c5bed',
          },
          isPublished: true,
          completenessReport,
          layout,
          ...(rendered.rebuild ? { rebuild: rendered.rebuild } : {}),
        },
        { upsert: true, new: true },
      ).exec();

      // 9. Update Audit and Lead models
      await Audit.findByIdAndUpdate(audit._id, {
        'screenshotUrls.comparisonBanner': comparisonBannerUrl,
      }).exec();

      // Only a lead still GENERATING goes to review; one rejected meanwhile keeps its status (REV-62)
      const reviewLead = await Lead.findOneAndUpdate(
        { _id: lead._id, status: { $in: leadStatusesInto('NEEDS_APPROVAL') } },
        {
          $set: {
            status: 'NEEDS_APPROVAL',
            previewUrl: fullPreviewUrl,
            comparisonBannerUrl,
            mvpGeneratedAt: generatedAt,
          },
          $unset: { generationError: '' },
        },
      ).exec();
      if (!reviewLead) {
        console.warn(`[DeployWorker] Lead ${leadId} left GENERATING during the deploy; its status is unchanged.`);
      }

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
    // A failed relayout leaves the previous bundle published; the lead never went to GENERATING
    if (job?.data?.mode === 'relayout') return;
    void handleGenerationFailure(job, err, 'deploy');
  });

  return worker;
};
