import { Worker, Job, UnrecoverableError } from 'bullmq';
import {
  IDeployJobData,
  ILead,
  IAudit,
  IMvpDesign,
  IMvpLayoutSelection,
  IMvpStandards,
  IMvpRebuildSummary,
  IRebuildEdit,
  IMvpRenderFailure,
  IRebuildModernize,
  MVP_LAYOUT_MANUAL_ORIGINAL,
  MVP_LAYOUT_MODERNIZE_REASONS,
  MvpLayoutVariant,
  RebuildLevel,
  IMvpPageVersion,
  MVP_MAX_VERSIONS,
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
import { MvpRenderError, rebuildLayout, rebuildLevelFor, renderMvp, requestedVariant, withRebuildLevel } from '../services/mvp-render.js';
import { modernizeForAudit } from '../services/rebuild-modernize.js';
import { RebuildModernizeChoice, rebuildModernizeService } from '../services/rebuild-modernize.service.js';
import { buildLayoutSignals, deriveMvpLayout } from '../services/layout-selection.service.js';
import { mergeDesigns } from '../templates/design.js';
import { storageService } from '../services/storage.service.js';
import { browserService } from '../services/browser.service.js';
import { ImageService } from '../services/image.service.js';
import { mvpCompletenessService } from '../services/mvp-completeness.service.js';
import { checkMvpStandards, comparableStandardsScore } from '../services/mvp-standards.js';
import { measureMvpPerformance } from '../services/mvp-performance.js';
import { handleGenerationFailure } from './generation-failure.js';
import { buildMvpSourceBrief, verifiedContacts } from '../services/mvp-source-brief.js';
import { finishMvpPage } from '../services/mvp-page-finish.js';
import { buildMvpSeo } from '../services/mvp-seo.js';

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
 * view and uploads the 1200x630 "Before / After" comparison banner next to it. The banner carries measured
 * values only (REV-126): the original's from its audit, the MVP's standards score read from this HTML, each left
 * out when it was not measured. The MVP's web vitals are not on it: they are measured on the demo host, not
 * the business's own hosting.
 */
async function publishMvp(
  slug: string,
  html: string,
  lead: Pick<ILead, 'businessName'>,
  audit: AuditDoc,
  standards: IMvpStandards | undefined,
): Promise<{ fullPreviewUrl: string; storageHtmlPath: string; comparisonBannerUrl: string }> {
  const { url: fullPreviewUrl, key: storageHtmlPath } = await storageService.uploadHtml(slug, html, env.S3_BUCKET_DEMOS);
  console.log(`[DeployWorker] HTML deployed to ${fullPreviewUrl}`);

  const newMvpMobileBuffer = await browserService.captureHtmlScreenshot(html, {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
  });

  // The original site's mobile screenshot; without it the banner says so and the MVP never stands in for it
  let originalMobileBuffer: Buffer | undefined;
  if (audit.screenshotUrls?.mobileOriginal) {
    try {
      const res = await fetch(audit.screenshotUrls.mobileOriginal);
      if (res.ok) originalMobileBuffer = Buffer.from(await res.arrayBuffer());
      else console.warn(`[DeployWorker] The original's mobile screenshot was not loaded (HTTP ${res.status})`);
    } catch (error) {
      console.warn('[DeployWorker] The original\'s mobile screenshot was not loaded:', error);
    }
  }

  const bannerBuffer = await ImageService.createComparisonBanner({
    originalMobileBuffer,
    newMvpMobileBuffer,
    businessName: lead.businessName,
    oldLcpSeconds: typeof audit.webVitals?.lcp === 'number' ? audit.webVitals.lcp / 1000 : undefined,
    oldA11yViolationsCount: audit.a11ySummary?.violationsCount,
    oldStandardsScore: comparableStandardsScore(audit.standardsChecks),
    newStandardsScore: standards?.score,
  });

  const comparisonBannerUrl = await storageService.uploadComparisonBanner(slug, bannerBuffer);
  console.log(`[DeployWorker] Comparison banner uploaded to ${comparisonBannerUrl}`);

  return { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl };
}

/** Why the layout and design tools leave a model-designed MVP alone until REV-139 replaces them */
export const MODEL_DESIGNED_REFUSAL = 'This MVP was designed by the model: the layout and design tools do not apply to it';

/** Fields of the rebuild and Bento MVPs, unset when a model-designed page replaces one (REV-138) */
const OLD_MVP_FIELDS = ['generatedContent', 'colorPalette', 'layout', 'design', 'rebuild', 'rebuildEdit', 'modernize', 'renderFailure'] as const;

/**
 * Publishes the page the model designed (REV-138): stores it as the next version, finishes it with the verified
 * contacts, search tags and booking form, uploads and measures it, and writes the project in one update, so the
 * dashboard never shows one version's page with another's checks. Then the lead goes to review (HITL).
 */
async function deployPage(job: Job<IDeployJobData>) {
  const { leadId, auditId, generationSource } = job.data;
  const page = job.data.page!;
  const lead = await Lead.findById(leadId).exec();
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  // A lead rejected or moved on while the model worked keeps its status and its MVP (REV-62)
  if (!leadStatusesInto('NEEDS_APPROVAL').includes(lead.status)) {
    const reason = `Lead ${leadId} is ${lead.status}; the new page is not published.`;
    console.warn(`[DeployWorker] ${reason}`);
    return { success: false, skipped: true, leadId, reason };
  }
  const audit = await findGenerationAudit(leadId, auditId);
  if (!audit) throw new Error(`No completed audit found for lead ${leadId}`);

  const existing = await MvpProject.findOne({ leadId: lead._id }).select('previewSlug versions').exec();
  const slug = existing?.previewSlug || newSlug(lead.businessName || lead.domain || 'demo', leadId);
  const leadData = (lead.toObject ? lead.toObject() : lead) as unknown as ILead;
  const auditData = (audit.toObject ? audit.toObject() : audit) as unknown as IAudit;

  // 1. The raw page as a version. A retried job finds the version it stored and publishes the same one again
  const versions: IMvpPageVersion[] = (existing?.versions as IMvpPageVersion[] | undefined) ?? [];
  const jobId = job.id ? String(job.id) : undefined;
  const retried = jobId ? versions.find((v) => v.jobId === jobId) : undefined;
  const n = retried?.n ?? Math.max(0, ...versions.map((v) => v.n)) + 1;
  const storagePath = await storageService.uploadPageVersion(slug, n, page.html);

  // 2. The published page: verified contacts, search tags from the audit, booking form and tracker
  const brief = buildMvpSourceBrief(auditData, leadData);
  const contacts = verifiedContacts(auditData, leadData);
  const { seo } = buildMvpSeo({
    businessName: lead.businessName,
    language: brief.language,
    ...(auditData.extractedContent ? { site: auditData.extractedContent } : {}),
    contacts,
    socialLinks: auditData.extractedContacts?.socialLinks ?? [],
    ...(brief.images[0] ? { photo: brief.images[0] } : {}),
    ...(brief.brand.logoUrl ? { logoUrl: brief.brand.logoUrl } : {}),
    ...(/^https?:\/\//i.test(lead.originalUrl ?? '') ? { originalUrl: lead.originalUrl } : {}),
    ...(auditData.standardsChecks ? { original: auditData.standardsChecks } : {}),
  });
  const html = finishMvpPage(page.html, {
    businessName: lead.businessName,
    language: brief.language,
    services: brief.services,
    contacts,
    seo,
    logoUrl: brief.brand.logoUrl,
    theme: page.theme,
    // The tracker as the other renderers load it: from the API, with no per-page token
    ...(/^https?:\/\//i.test(env.PUBLIC_API_URL) ? { publicApiUrl: env.PUBLIC_API_URL } : {}),
  });

  // 3. Checks, upload, banner and the page's web vitals, as for every publish
  const completenessReport = await mvpCompletenessService.assess(html, leadData, auditData);
  const standards = publishedStandards(html);
  const { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl } = await publishMvp(slug, html, lead, audit, standards);
  const performance = await measureMvpPerformance(fullPreviewUrl);

  // 4. One update: the page, its checks and the version; every field of the old renderers goes
  const generatedAt = new Date();
  const entry: IMvpPageVersion = {
    n,
    kind: page.kind,
    ...(page.instruction ? { instruction: page.instruction } : {}),
    ...(jobId ? { jobId } : {}),
    ...(generationSource ? { provider: generationSource.provider, model: generationSource.modelUsed } : {}),
    storagePath,
    createdAt: generatedAt,
  };
  const unset: Record<string, ''> = Object.fromEntries([...OLD_MVP_FIELDS, 'controls', 'editedAt'].map((field) => [field, '']));
  if (!standards) unset['standards'] = '';
  if (!generationSource?.requestedProvider) Object.assign(unset, { requestedProvider: '', requestedModel: '' });
  const mvpProject = await MvpProject.findOneAndUpdate(
    { leadId: lead._id },
    {
      $set: {
        auditId: audit._id,
        leadId: lead._id,
        previewSlug: slug,
        fullPreviewUrl,
        storageHtmlPath,
        comparisonBannerUrl,
        isPublished: true,
        generatedAt,
        page: page.html,
        theme: page.theme,
        grounding: page.grounding,
        completenessReport,
        performance,
        ...(standards ? { standards } : {}),
        ...(generationSource
          ? {
              provider: generationSource.provider,
              modelUsed: generationSource.modelUsed,
              ...(generationSource.requestedProvider
                ? { requestedProvider: generationSource.requestedProvider, requestedModel: generationSource.requestedModel }
                : {}),
            }
          : {}),
      },
      ...(retried ? {} : { $push: { versions: { $each: [entry], $slice: -MVP_MAX_VERSIONS } } }),
      $inc: { generationCount: 1 },
      $unset: unset,
    },
    { upsert: true, new: true },
  ).exec();

  // 5. The files of versions that fell off the list; a failed delete leaves a stray file, never a failed publish
  const kept = retried ? versions : [...versions, entry].slice(-MVP_MAX_VERSIONS);
  for (const dropped of versions.filter((v) => !kept.includes(v))) {
    await storageService.deleteObject(dropped.storagePath).catch((error: unknown) => {
      console.warn(`[DeployWorker] Old version ${dropped.storagePath} was not deleted:`, error);
    });
  }

  // 6. Banner on the audit; the lead goes to review only if it is still waiting for this page (REV-62)
  await Audit.findByIdAndUpdate(audit._id, { 'screenshotUrls.comparisonBanner': comparisonBannerUrl }).exec();
  const reviewLead = await Lead.findOneAndUpdate(
    { _id: lead._id, status: { $in: leadStatusesInto('NEEDS_APPROVAL') } },
    {
      $set: { status: 'NEEDS_APPROVAL', previewUrl: fullPreviewUrl, comparisonBannerUrl, mvpGeneratedAt: generatedAt },
      $unset: { generationError: '', generationFailure: '' },
    },
  ).exec();
  if (!reviewLead) console.warn(`[DeployWorker] Lead ${leadId} left GENERATING during the deploy; its status is unchanged.`);

  console.log(`[DeployWorker] Published version ${n} of ${slug}${standards ? `, standards ${standards.score}/100` : ''}. Ready for operator review.`);
  return { success: true, mvpProjectId: String(mvpProject?._id), previewSlug: slug, fullPreviewUrl, comparisonBannerUrl, version: n };
}

/** A new MVP's slug: the business name in Latin letters and the lead id's end */
function newSlug(name: string, leadId: string): string {
  const raw = transliterate(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preview';
  return `${raw}-${leadId.toString().slice(-6)}`;
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

/**
 * The modernize design a render at this level uses (REV-114): at `modern`, the stored one when the model made it
 * for this audit and it still fits, else a fresh answer from the model, saved with the audit id before the page
 * renders. The answer is the model's design or its failure, never a default (REV-132): a stored failure, or a
 * default stored before REV-132, is asked for again on the next job (`retry: false` within a job, so one job
 * never calls the model twice). Any other level, or a page that cannot be rebuilt (the render fails with that
 * reason first), keeps what is stored, unused. `changed` is true when the model was asked.
 */
export async function resolveModernize(
  project: { _id?: unknown; modernize?: IRebuildModernize | null } | null | undefined,
  auditData: Partial<IAudit>,
  level: RebuildLevel,
  options: { retry?: boolean } = {},
): Promise<{ modernize?: IRebuildModernize; changed: boolean }> {
  const stored = project?.modernize ?? undefined;
  if (level !== 'modern' || !auditData.siteSections || !rebuildEligibility(auditData).ok) return { modernize: stored, changed: false };
  const valid = modernizeForAudit(stored, auditData);
  if (valid) return { modernize: valid, changed: false };
  if (options.retry === false && stored?.auditId === String(auditData._id ?? '')) return { modernize: stored, changed: false };

  const choice = await rebuildModernizeService.choose({ siteSections: auditData.siteSections, brandColors: brandColors(auditData) });
  await recordModernizeTokens(auditData.leadId, choice);
  const auditId = String(auditData._id ?? '');
  const modernize: IRebuildModernize =
    choice.source === 'llm' && choice.design
      ? { auditId, source: 'llm', design: choice.design }
      : { auditId, source: 'failed', error: choice.error ?? 'invalid_answer', ...(choice.message ? { message: choice.message } : {}) };
  console.log(`[DeployWorker] Modern design for audit ${auditId}: ${modernize.source}${modernize.error ? ` (${modernize.error}: ${modernize.message ?? ''})` : ''}`);
  if (project?._id) await MvpProject.findByIdAndUpdate(project._id, { $set: { modernize } }).exec();
  return { modernize, changed: true };
}

/** A render failure as the job fails with it: final, so BullMQ does not retry it, and carrying its code and reason (REV-132) */
const finalFailure = (error: MvpRenderError): UnrecoverableError & { failure: IMvpRenderFailure } =>
  Object.assign(new UnrecoverableError(error.message), { failure: { ...error.failure, at: new Date() } as IMvpRenderFailure });

/** How many times a relayout re-renders when the operator keeps changing the MVP while it publishes */
const MAX_RELAYOUT_PASSES = 3;

type SavedMvpDesign = {
  layout?: { variant?: MvpLayoutVariant; reasons?: string[] | null; design?: IMvpDesign | null; rebuildLevel?: RebuildLevel | null } | null;
  colorPalette?: MvpPaletteOverride | null;
  design?: IMvpDesign | null;
  rebuild?: unknown;
  rebuildEdit?: IRebuildEdit | null;
  modernize?: IRebuildModernize | null;
  renderFailure?: IMvpRenderFailure | null;
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
 * A re-render that could not be made (REV-132): nothing is uploaded, so the page published before stays, and the
 * MVP records why for the dashboard. A switch to the modern level the model could not make puts the saved level
 * back to the published page's, guarded on the pick this job rendered from, so a later pick is never overwritten.
 */
async function recordRenderFailure(project: SavedMvpDesign & { _id: unknown }, requested: IMvpLayoutSelection, error: MvpRenderError) {
  const published = (project.rebuild as IMvpRebuildSummary | null | undefined)?.level ?? 'faithful';
  if (error.failure.code === 'MVP_MODERNIZE_UNAVAILABLE' && project.rebuild && requested.rebuildLevel !== published) {
    await MvpProject.findOneAndUpdate(
      { _id: project._id, layout: project.layout },
      { $set: { layout: withRebuildLevel(requested, { level: published, reasons: [MVP_LAYOUT_MODERNIZE_REASONS.manual] }) } },
    ).exec();
  }
  await MvpProject.findByIdAndUpdate(project._id, { $set: { renderFailure: { ...error.failure, at: new Date() } } }).exec();
  console.warn(`[DeployWorker] MVP ${String(project._id)} not re-published: ${error.message}`);
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
  // REV-138: the layout tools re-render the rebuild or Bento copy; a page the model designed has neither
  if (project.page) throw new Error(MODEL_DESIGNED_REFUSAL);
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
  const auditKey = String(audit._id);
  // A modern design computed by this job, so a later pass never asks the model again for the same audit
  let computed: IRebuildModernize | undefined;
  for (let pass = 0; pass < MAX_RELAYOUT_PASSES; pass++) {
    const requested = savedLayout(project, design.variant);
    const level: RebuildLevel = requested.variant === 'original' ? (requested.rebuildLevel ?? 'faithful') : 'faithful';
    // The answer this job got wins over a re-read that may predate its write
    const owned = computed?.auditId === auditKey ? computed : project.modernize;
    // A design asked for by an earlier pass is not asked for again, even when the model failed
    const resolved = await resolveModernize({ _id: project._id, modernize: owned }, auditData, level, { retry: !computed });
    if (resolved.changed) computed = resolved.modernize;
    // What is stored now, so the re-read below compares against it
    design = { ...design, modernize: resolved.modernize };
    let rendered: ReturnType<typeof renderMvp>;
    try {
      rendered = renderMvp({
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
    } catch (error) {
      if (error instanceof MvpRenderError) await recordRenderFailure(project, requested, error);
      throw error;
    }
    // The published page's standards, read from its HTML before the upload so the banner carries them (REV-126)
    const standards = publishedStandards(rendered.html);
    published = await publishMvp(project.previewSlug, rendered.html, lead, audit, standards);
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
    // The published page's checks go in the same write as its summary and editedAt, so the dashboard, which stops
    // waiting on that write, never lists the previous page's measurements (REV-119). The completeness report
    // (REV-111) and the standards (REV-118) are code only; the web vitals load the uploaded page. None throws.
    const completenessReport = mvpCompletenessService.check(rendered.html, leadData, auditData);
    const performance = await measureMvpPerformance(published.fullPreviewUrl);
    const unset = {
      ...(rendered.rebuild ? {} : { rebuild: '' }),
      ...(standards ? {} : { standards: '' }),
      // The page is published, so an earlier failure no longer describes it (REV-132)
      ...(project.renderFailure ? { renderFailure: '' } : {}),
    };
    await MvpProject.findByIdAndUpdate(project._id, {
      $set: {
        completenessReport,
        ...(standards ? { standards } : {}),
        performance,
        ...(rendered.rebuild ? { rebuild: rendered.rebuild } : {}),
        ...(switched || levelChanged ? { editedAt: new Date() } : {}),
      },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    }).exec();
    console.log(
      `[DeployWorker] Completeness re-checked (deterministic): ${completenessReport.status}` +
        (standards ? `; standards ${standards.score}/100` : '') +
        `; web vitals ${performance.error ?? `LCP ${performance.webVitals.lcp} ms, CLS ${performance.webVitals.cls}`}`,
    );
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

  console.log(
    `[DeployWorker] Re-published MVP ${project._id} for lead ${leadId} in the ${layout?.variant} layout (${layout?.reasons.join(', ')}), primary ${design.palette.primary ?? 'from the audit'}`,
  );
  return { success: true, relayout: true, mvpProjectId: project._id.toString(), layout: layout?.variant, ...published };
}

export const createDeployWorker = (): Worker => {
  const worker = new Worker<IDeployJobData>(
    QUEUE_NAMES.DEPLOY,
    async (job: Job<IDeployJobData>) => {
      try {
        if (job.data.mode === 'relayout') return await republishSavedMvp(job.data.leadId);
        if (job.data.page) return await deployPage(job);
        return await deployMvp(job);
      } catch (error) {
        if (error instanceof MvpRenderError) throw finalFailure(error);
        throw error;
      }
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

/** A full deploy: renders the MVP from the audit, publishes it and moves the lead to review */
async function deployMvp(job: Job<IDeployJobData>) {
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
  const existingProject = await MvpProject.findOne({ leadId: lead._id }).select('previewSlug design layout rebuild rebuildEdit modernize renderFailure').exec();
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
  // A Bento layout the operator picked for this run comes first (REV-132)
  const picked = job.data.layout ?? requestedVariant(existingProject?.layout);
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

  // The published page's standards, by the audit's own checks (REV-118); the banner carries the score (REV-126)
  const standards = publishedStandards(html);
  // 3-7. Upload the bundle and a fresh Before / After banner
  const { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl } = await publishMvp(slug, html, lead, audit, standards);
  if (standards) console.log(`[DeployWorker] Standards of the MVP: ${standards.score}/100 (original ${auditData.scores?.standards ?? 'not measured'})`);
  // Its web vitals, loaded on the audit's phone (REV-119); a failure is stored as such
  const performance = await measureMvpPerformance(fullPreviewUrl);
  console.log(`[DeployWorker] Web vitals of the MVP: ${performance.error ?? `LCP ${performance.webVitals.lcp} ms, CLS ${performance.webVitals.cls}`}`);

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
    ...(existingProject?.renderFailure ? { renderFailure: '' } : {}),
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
      performance,
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
      $unset: { generationError: '', generationFailure: '' },
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
}
