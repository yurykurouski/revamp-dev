import { Worker, Job } from 'bullmq';
import {
  IDeployJobData,
  ILead,
  IAudit,
  IMvpDesign,
  IMvpLayoutSelection,
  IMvpStandards,
  IMvpRebuildSummary,
  IRebuildEdit,
  IRebuildModernize,
  MVP_LAYOUT_MANUAL_ORIGINAL,
  MvpLayoutVariant,
  RebuildLevel,
} from '@revamp/shared-types';
import { canChangeMvpLayout, leadStatusesInto, manualMvpLayout, rebuildEligibility } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { MvpPaletteOverride } from '../services/template.service.js';
import { defaultRebuildPrimary } from '../services/rebuild-template.service.js';
import { rebuildLayout, rebuildLevelFor, renderMvp, requestedVariant, withRebuildLevel } from '../services/mvp-render.js';
import { modernizeForAudit } from '../services/rebuild-modernize.js';
import { RebuildModernizeChoice, rebuildModernizeService } from '../services/rebuild-modernize.service.js';
import { buildLayoutSignals, deriveMvpLayout } from '../services/layout-selection.service.js';
import { mergeDesigns } from '../templates/design.js';
import { storageService } from '../services/storage.service.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { mvpCompletenessService } from '../services/mvp-completeness.service.js';
import { checkMvpStandards } from '../services/mvp-standards.js';
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

const HEX = /^#[0-9a-f]{6}$/i;

/** The site's own colors for the modernize call: its button color, then the brand colors, as hex and once each */
function brandColors(audit: Partial<IAudit>): string[] {
  const tokens = audit.extractedBrandTokens;
  const colors = [audit.siteSections?.typography?.button?.background, tokens?.primaryColor, tokens?.secondaryColor, tokens?.accentColor];
  return [...new Set(colors.filter((c): c is string => Boolean(c && HEX.test(c))).map((c) => c.toLowerCase()))];
}

/** The modernize call's tokens (REV-114), as the audit worker records its own; never fails the job */
async function recordModernizeTokens(leadId: unknown, choice: RebuildModernizeChoice) {
  if (!choice.usage) return;
  try {
    await AnalyticsEvent.create({
      leadId,
      eventType: 'token_usage',
      metadata: {
        model: choice.model,
        promptTokens: choice.usage.promptTokens,
        completionTokens: choice.usage.completionTokens,
        totalTokens: choice.usage.totalTokens,
        stage: 'mvp_modernize',
      },
    });
  } catch (error) {
    console.warn(`[DeployWorker] Failed to record the modernize token usage for lead ${String(leadId)}:`, error);
  }
}

/** A default stored because the model could not be asked this time, not because it answered invalidly */
const temporaryDefault = (stored: IRebuildModernize) =>
  stored.source === 'default' && Boolean(stored.error && (stored.error.startsWith('call_failed') || stored.error === 'not_configured'));

/**
 * The modernize design a render at this level uses (REV-114): at `modern`, the stored one when it was made for
 * this audit and still fits, else a fresh one from the model (or its default), saved with the audit id before
 * the page renders. Any other level, or a page that cannot be rebuilt (it renders as Bento), keeps what is
 * stored, unused. A default stored after a failed or unconfigured call is asked for again when `retryTemporary`
 * (once per job); an `invalid:` default is reused. `changed` is true when a design was computed.
 */
export async function resolveModernize(
  project: { _id?: unknown; modernize?: IRebuildModernize | null } | null | undefined,
  auditData: Partial<IAudit>,
  level: RebuildLevel,
  options: { retryTemporary?: boolean } = {},
): Promise<{ modernize?: IRebuildModernize; changed: boolean }> {
  const stored = project?.modernize ?? undefined;
  if (level !== 'modern' || !auditData.siteSections || !rebuildEligibility(auditData).ok) return { modernize: stored, changed: false };
  const valid = modernizeForAudit(stored, auditData);
  if (valid && !(options.retryTemporary !== false && temporaryDefault(valid))) return { modernize: valid, changed: false };

  const choice = await rebuildModernizeService.choose({ siteSections: auditData.siteSections, brandColors: brandColors(auditData) });
  await recordModernizeTokens(auditData.leadId, choice);
  const modernize: IRebuildModernize = {
    auditId: String(auditData._id ?? ''),
    source: choice.source,
    design: choice.design,
    ...(choice.error ? { error: choice.error } : {}),
  };
  console.log(`[DeployWorker] Modern design for audit ${modernize.auditId}: ${modernize.source}${modernize.error ? ` (${modernize.error})` : ''}`);
  if (project?._id) await MvpProject.findByIdAndUpdate(project._id, { $set: { modernize } }).exec();
  return { modernize, changed: true };
}

/** How many times a relayout re-renders when the operator keeps changing the MVP while it publishes */
const MAX_RELAYOUT_PASSES = 3;

type SavedMvpDesign = {
  layout?: { variant?: MvpLayoutVariant; reasons?: string[] | null; design?: IMvpDesign | null; rebuildLevel?: RebuildLevel | null } | null;
  colorPalette?: MvpPaletteOverride | null;
  design?: IMvpDesign | null;
  rebuild?: unknown;
  rebuildEdit?: IRebuildEdit | null;
  modernize?: IRebuildModernize | null;
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
  // The rebuild's level and its modern design (REV-114)
  rebuildLevel: project.layout?.rebuildLevel ?? undefined,
  modernize: project.modernize ?? undefined,
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
  JSON.stringify(a.rebuildEdit ?? null) === JSON.stringify(b.rebuildEdit ?? null) &&
  a.rebuildLevel === b.rebuildLevel &&
  JSON.stringify(a.modernize ?? null) === JSON.stringify(b.modernize ?? null);

/**
 * The published page's standards checks (REV-118), by code with the audit's reader; advisory, so a page that cannot
 * be checked has none rather than failing the publish
 */
export function publishedStandards(html: string): IMvpStandards | undefined {
  try {
    return checkMvpStandards(html);
  } catch (error) {
    console.warn(`[DeployWorker] Standards of the published MVP not checked: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

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
  const auditKey = String(audit._id);
  // A modern design computed by this job, so a later pass never asks the model again for the same audit
  let computed: IRebuildModernize | undefined;
  for (let pass = 0; pass < MAX_RELAYOUT_PASSES; pass++) {
    const requested = savedLayout(project, design.variant);
    const level: RebuildLevel = requested.variant === 'original' ? (requested.rebuildLevel ?? 'faithful') : 'faithful';
    const owned = project.modernize?.auditId === auditKey ? project.modernize : (computed ?? project.modernize);
    // A design asked for by an earlier pass is not asked for again, even when it is a temporary default
    const resolved = await resolveModernize({ _id: project._id, modernize: owned }, auditData, level, { retryTemporary: !computed });
    if (resolved.changed) computed = resolved.modernize;
    // What is stored now, so the re-read below compares against it
    design = { ...design, modernize: resolved.modernize };
    const rendered = renderMvp({
      lead: leadData,
      audit: auditData,
      generatedContent: project.generatedContent,
      layout: requested,
      derived,
      palette: design.palette,
      design: design.design,
      rebuildEdit: design.rebuildEdit,
      modernize: resolved.modernize,
    });
    html = rendered.html;
    published = await publishMvp(project.previewSlug, rendered.html, lead, audit);
    layout = rendered.layout;

    // The rebuild summary follows the page; a fallback records its reason on the layout. A page whose
    // renderer changed (rebuild <-> Bento) cannot switch in place, so the preview reloads (REV-110)
    // (an MVP saved without a layout keeps none while it renders as Bento)
    const layoutChanged = JSON.stringify(rendered.layout) !== JSON.stringify(project.layout?.variant ? project.layout : requested);
    const switched = Boolean(project.rebuild) !== Boolean(rendered.rebuild);
    // A level change restyles the whole page, so the preview reloads too (REV-114); a summary saved before
    // the levels is faithful
    const previous = project.rebuild as IMvpRebuildSummary | null | undefined;
    const levelChanged = Boolean(previous && rendered.rebuild) && (previous?.level ?? 'faithful') !== rendered.rebuild?.level;
    if (rendered.rebuild || project.rebuild || switched) {
      await MvpProject.findByIdAndUpdate(project._id, {
        $set: {
          ...(rendered.rebuild ? { rebuild: rendered.rebuild } : {}),
          ...(switched || levelChanged ? { editedAt: new Date() } : {}),
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
      if (saved) {
        design = savedDesign({
          layout: rendered.layout,
          colorPalette: project.colorPalette,
          design: project.design,
          rebuildEdit: project.rebuildEdit,
          modernize: resolved.modernize,
        });
      }
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
    // The standards follow the published page too (REV-118)
    const standards = publishedStandards(html);
    await MvpProject.findByIdAndUpdate(project._id, {
      $set: { completenessReport, ...(standards ? { standards } : {}) },
      ...(standards ? {} : { $unset: { standards: '' } }),
    }).exec();
    console.log(
      `[DeployWorker] Completeness re-checked (deterministic): ${completenessReport.status}` + (standards ? `; standards ${standards.score}/100` : ''),
    );
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
      const existingProject = await MvpProject.findOne({ leadId: lead._id }).select('previewSlug design layout rebuild rebuildEdit modernize').exec();
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
      // The rebuild's level (REV-114): the operator's pick survives, else the audit's dated-site detector decides
      const requested = withRebuildLevel(picked ? manualMvpLayout(derived, picked) : rebuildLayout(derived), rebuildLevelFor(existingProject?.layout, auditData));
      const level: RebuildLevel = requested.rebuildLevel ?? 'faithful';
      // The operator's custom design survives a regeneration (REV-92); the palette comes from the new
      // audit run (the rebuild takes the site's own button color itself)
      // The operator's change to the rebuild (REV-111) names this audit's sections: kept for the same audit,
      // dropped when the generation reads a newer one
      const savedEdit = existingProject?.rebuildEdit ?? undefined;
      const rebuildEdit = savedEdit?.auditId === audit._id.toString() ? savedEdit : undefined;
      if (savedEdit && !rebuildEdit) {
        console.log(`[DeployWorker] Rebuild edit for audit ${savedEdit.auditId} dropped: the MVP is generated from audit ${audit._id.toString()}`);
      }
      // The modern design (REV-114) also names this audit's sections: one for an older audit is dropped, and
      // computed again only when this render is modern
      const savedModernize = existingProject?.modernize ?? undefined;
      const staleModernize = Boolean(savedModernize && savedModernize.auditId !== audit._id.toString());
      const resolved = await resolveModernize(existingProject, auditData, level);
      const modernize = staleModernize && !resolved.changed ? undefined : resolved.modernize;
      const rendered = renderMvp({
        lead: leadData,
        audit: auditData,
        generatedContent: audit.generatedContent,
        layout: requested,
        derived,
        design: mergeDesigns(requested.design, existingProject?.design),
        rebuildEdit,
        modernize,
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
      // The published page's standards, by the audit's own checks (REV-118)
      const standards = publishedStandards(html);
      if (standards) console.log(`[DeployWorker] Standards of the MVP: ${standards.score}/100 (original ${auditData.scores?.standards ?? 'not measured'})`);

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
        ...(staleModernize && !resolved.changed ? { modernize: '' } : {}),
        ...(standards ? {} : { standards: '' }),
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
          ...(resolved.changed ? { modernize: resolved.modernize } : {}),
          ...(standards ? { standards } : {}),
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
