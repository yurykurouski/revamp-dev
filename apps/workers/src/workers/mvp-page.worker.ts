import { Worker, Job } from 'bullmq';
import {
  IAudit,
  ILead,
  IMvpControlsUpdate,
  IMvpGroundingFlag,
  IMvpPageJobData,
  IMvpPageJobResult,
  IMvpPageVersion,
  IMvpProject,
  IMvpTheme,
  MVP_MAX_VERSIONS,
  MvpPageVersionKind,
} from '@revamp/shared-types';
import { canChangeMvpLayout } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { desktopCapture } from '../services/desktop-capture.js';
import { checkMvpPage } from '../services/mvp-page-check.js';
import { checkMvpGrounding } from '../services/mvp-grounding.js';
import { finishMvpPage } from '../services/mvp-page-finish.js';
import { MvpPageGenerator, defaultPageGenerator } from '../services/mvp-page-generator.js';
import { dropUnlistedVersions, pageContext, publishFinishedPage } from '../services/mvp-page-publish.js';
import { storageService } from '../services/storage.service.js';

// The operator's own changes to a model-designed page (REV-139): a change in their words, palette and fonts, or a
// restore of an earlier version. Each publishes the page again, or publishes nothing and says why. The API waits for
// the result; the queue runs one job at a time, so two publishes of one MVP never interleave.

/**
 * Time kept for finishing, uploading and measuring the page before the API stops waiting: the model's deadline ends
 * this much earlier, and no action starts publishing with less left
 */
export const PUBLISH_MARGIN_MS = 90_000;

export const PREVIOUS_GENERATOR_REFUSAL = 'This MVP was made by the previous generator: only a regeneration applies to it.';

const leadLocked = (status: string | undefined) => new Error(`The MVP cannot be changed while the lead is ${status ?? 'unknown'}.`);
const expired = () => new Error('The change was not applied: the dashboard stopped waiting for it. Try again.');

/** The saved controls with each group of the update applied: given replaces, `null` clears, left out keeps */
export function applyControlsUpdate(current: Partial<IMvpTheme>, update: IMvpControlsUpdate): Partial<IMvpTheme> {
  const next: Partial<IMvpTheme> = { ...current };
  if (update.colors !== undefined) {
    for (const key of ['primary', 'accent', 'bg', 'surface', 'text'] as const) delete next[key];
    if (update.colors) Object.assign(next, update.colors);
  }
  if (update.fonts !== undefined) {
    delete next.fontHeading;
    delete next.fontBody;
    if (update.fonts) Object.assign(next, { fontHeading: update.fonts.heading, fontBody: update.fonts.body });
  }
  return next;
}

const sameControls = (a: Partial<IMvpTheme>, b: Partial<IMvpTheme>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof IMvpTheme>;
  return [...keys].every((key) => a[key] === b[key]);
};

interface NextPage {
  page: string;
  theme: IMvpTheme;
  grounding: IMvpGroundingFlag[];
  controls: Partial<IMvpTheme>;
  /** The version to record; none for palette and fonts, which are not part of the raw page */
  version?: { kind: MvpPageVersionKind; instruction?: string; from?: number; provider?: string; model?: string };
}

export async function processMvpPageJob(
  data: IMvpPageJobData,
  deps: { generator?: Pick<MvpPageGenerator, 'change'>; now?: () => number } = {},
): Promise<IMvpPageJobResult> {
  const now = deps.now ?? Date.now;
  if (now() > data.deadline) throw expired();

  const doc = await MvpProject.findById(data.mvpProjectId).exec();
  if (!doc) throw new Error(`MVP ${data.mvpProjectId} not found.`);
  const project = (doc.toObject ? doc.toObject() : doc) as unknown as IMvpProject & { _id: unknown };
  if (!project.page || !project.theme) throw new Error(PREVIOUS_GENERATOR_REFUSAL);
  const leadId = String(project.leadId);
  const lead = await Lead.findById(leadId).exec();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  if (!canChangeMvpLayout(lead.status)) throw leadLocked(lead.status);
  const audit = await findGenerationAudit(leadId, project.auditId ? String(project.auditId) : undefined);
  if (!audit) throw new Error(`No completed audit found for lead ${leadId}.`);

  const leadData = (lead.toObject ? lead.toObject() : lead) as unknown as ILead;
  const auditData = (audit.toObject ? audit.toObject() : audit) as unknown as IAudit;
  const { brief, finish } = pageContext(leadData, auditData);
  const controls = (project.controls ?? {}) as Partial<IMvpTheme>;
  const versions = (project.versions ?? []) as IMvpPageVersion[];

  let next: NextPage;
  switch (data.action) {
    case 'change': {
      const instruction = (data.instruction ?? '').trim();
      const screenshot = await desktopCapture(auditData.screenshotUrls?.desktopFull);
      const generator = deps.generator ?? defaultPageGenerator();
      const result = await generator.change({
        brief,
        ...(screenshot ? { screenshot } : {}),
        currentPage: project.page,
        instruction,
        deadline: data.deadline - PUBLISH_MARGIN_MS,
      });
      if (!result.ok) {
        console.warn(`[MvpPageWorker] No change to MVP ${data.mvpProjectId}: ${result.reason}: ${result.message}`);
        return { applied: false, reason: result.reason, message: result.message, ...(result.problems ? { problems: result.problems } : {}) };
      }
      if (result.page === project.page) return { applied: false, reason: 'unchanged' };
      next = {
        page: result.page,
        theme: result.theme,
        grounding: result.grounding,
        controls,
        version: { kind: 'change', instruction, ...(result.provider ? { provider: result.provider } : {}), model: result.modelUsed },
      };
      break;
    }
    case 'controls': {
      const updated = applyControlsUpdate(controls, data.controls ?? {});
      if (sameControls(updated, controls)) return { applied: false, reason: 'unchanged' };
      next = { page: project.page, theme: project.theme, grounding: project.grounding ?? [], controls: updated };
      break;
    }
    case 'restore': {
      const n = data.version;
      const entry = versions.find((v) => v.n === n);
      if (!entry) throw new Error(`Version ${n} not found.`);
      const raw = await storageService.readPageVersion(entry.storagePath);
      if (raw === project.page) return { applied: false, reason: 'unchanged' };
      // The version was checked against the audit it was made from; the contacts and images may have changed since
      const check = checkMvpPage(raw, brief);
      if (!check.ok || !check.theme) {
        const reasons = check.problems.map((p) => `${p.code}: ${p.message}`).join('; ');
        return { applied: false, reason: 'unusable_version', message: `Version ${n} no longer fits the audit: ${reasons}`.slice(0, 600), problems: check.problems };
      }
      next = { page: raw, theme: check.theme, grounding: checkMvpGrounding(raw, brief), controls, version: { kind: 'restore', from: n } };
      break;
    }
    default:
      throw new Error(`Unknown MVP page action ${String((data as { action?: unknown }).action)}.`);
  }

  // The model may take a while, or the job waited behind another: publishing starts only with its reserve left, so the
  // page never goes live after the API has answered that it was not applied. The lead may have moved on meanwhile too
  if (now() > data.deadline - PUBLISH_MARGIN_MS) throw expired();
  const latest = await Lead.findById(leadId).exec();
  if (!latest || !canChangeMvpLayout(latest.status)) throw leadLocked(latest?.status);

  const slug = project.previewSlug;
  let entry: IMvpPageVersion | undefined;
  if (next.version) {
    const n = Math.max(0, ...versions.map((v) => v.n)) + 1;
    const storagePath = await storageService.uploadPageVersion(slug, n, next.page);
    entry = { n, ...next.version, storagePath, createdAt: new Date() };
  }

  const html = finishMvpPage(next.page, { ...finish, theme: next.theme, controls: next.controls });
  const published = await publishFinishedPage({ slug, html, lead: leadData, audit: auditData, completeness: 'check' });

  const hasControls = Object.keys(next.controls).length > 0;
  const unset: Record<string, ''> = {};
  if (!hasControls) unset['controls'] = '';
  if (!published.standards) unset['standards'] = '';
  const saved = await MvpProject.findByIdAndUpdate(
    project._id,
    {
      $set: {
        page: next.page,
        theme: next.theme,
        grounding: next.grounding,
        ...(hasControls ? { controls: next.controls } : {}),
        editedAt: new Date(),
        fullPreviewUrl: published.fullPreviewUrl,
        storageHtmlPath: published.storageHtmlPath,
        comparisonBannerUrl: published.comparisonBannerUrl,
        completenessReport: published.completenessReport,
        performance: published.performance,
        ...(published.standards ? { standards: published.standards } : {}),
      },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      ...(entry ? { $push: { versions: { $each: [entry], $slice: -MVP_MAX_VERSIONS } } } : {}),
    },
    { new: true },
  ).exec();

  if (entry) {
    const kept = (saved?.versions as IMvpPageVersion[] | undefined) ?? [...versions, entry].slice(-MVP_MAX_VERSIONS);
    await dropUnlistedVersions(versions, kept);
  }

  console.log(`[MvpPageWorker] ${data.action} published on MVP ${data.mvpProjectId}${entry ? ` as version ${entry.n}` : ''}.`);
  return { applied: true, ...(entry ? { version: entry.n } : {}) };
}

export const createMvpPageWorker = (): Worker => {
  const worker = new Worker<IMvpPageJobData, IMvpPageJobResult>(
    QUEUE_NAMES.MVP_PAGE,
    (job: Job<IMvpPageJobData>) => processMvpPageJob(job.data),
    // One at a time: two publishes of one MVP never interleave (version numbers, files, the stored page)
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[MvpPageWorker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
};
