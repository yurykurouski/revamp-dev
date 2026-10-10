import { Worker, Job, UnrecoverableError } from 'bullmq';
import { IDeployJobData, ILead, IAudit, IMvpPageVersion, MVP_MAX_VERSIONS } from '@revamp/shared-types';
import { leadStatusesInto } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { storageService } from '../services/storage.service.js';
import { handleGenerationFailure } from './generation-failure.js';
import { finishMvpPage } from '../services/mvp-page-finish.js';
import { dropUnlistedVersions, pageContext, publishFinishedPage } from '../services/mvp-page-publish.js';

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
  // The page's own key, not the BullMQ id, which restarts at 1 whenever Redis is reset
  const jobId = page.id;
  const retried = versions.find((v) => v.jobId === jobId);
  const n = retried?.n ?? Math.max(0, ...versions.map((v) => v.n)) + 1;
  const storagePath = await storageService.uploadPageVersion(slug, n, page.html);

  // 2. The published page: verified contacts, search tags from the audit, booking form and tracker
  const { finish } = pageContext(leadData, auditData);
  const html = finishMvpPage(page.html, { ...finish, theme: page.theme });

  // 3. Checks, upload, banner and the page's web vitals, as for every publish
  const { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl, completenessReport, standards, performance } = await publishFinishedPage({
    slug,
    html,
    lead: leadData,
    audit: auditData,
    completeness: 'assess',
  });

  // 4. One update: the page, its checks and the version; every field of the old renderers goes
  const generatedAt = new Date();
  const entry: IMvpPageVersion = {
    n,
    kind: page.kind,
    ...(page.instruction ? { instruction: page.instruction } : {}),
    jobId,
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
      // A retried job already counted and listed its version
      ...(retried ? {} : { $push: { versions: { $each: [entry], $slice: -MVP_MAX_VERSIONS } }, $inc: { generationCount: 1 } }),
      $unset: unset,
    },
    // strict: false keeps the unset of an old record's fields, which the schema no longer declares (REV-141)
    { upsert: true, new: true, strict: false },
  ).exec();

  // 5. The files of versions that fell off the list, as Mongo kept it
  const keptVersions = (mvpProject?.versions as IMvpPageVersion[] | undefined) ?? (retried ? versions : [...versions, entry].slice(-MVP_MAX_VERSIONS));
  await dropUnlistedVersions(versions, keptVersions);

  // 6. The lead goes to review only if it is still waiting for this page (REV-62)
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

/** Why a deploy job from before REV-141 cannot be published: the renderer it was queued for is gone */
export const NO_PAGE_REFUSAL = 'Deploy job without a page: the previous generator was removed (REV-141). Regenerate the MVP.';

export const createDeployWorker = (): Worker => {
  const worker = new Worker<IDeployJobData>(
    QUEUE_NAMES.DEPLOY,
    async (job: Job<IDeployJobData>) => {
      // A job queued for the previous renderer would fail the same way on every retry
      if (!job.data.page) throw new UnrecoverableError(NO_PAGE_REFUSAL);
      return deployPage(job);
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
