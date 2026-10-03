import { Worker, Job } from 'bullmq';
import {
  IMvpEditJobData,
  IMvpEditJobResult,
  MVP_COLOR_PRESETS,
  BENTO_LAYOUT_VARIANTS,
  BentoLayoutVariant,
} from '@revamp/shared-types';
import { MvpContentOutput, canChangeMvpLayout, hasRebuildEdit, manualMvpLayout } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { MvpColorCandidate, MvpEditService, mvpEditService } from '../services/mvp-edit.service.js';
import { RebuildEditService, rebuildEditService } from '../services/rebuild-edit.service.js';
import { editForAudit } from '../services/rebuild-template.service.js';
import { modernizeForAudit } from '../services/rebuild-modernize.js';
import { republishSavedMvp } from './deploy.worker.js';
import { hasDesign, mergeDesigns } from '../templates/design.js';

/** #RGB or #RRGGBB as #RRGGBB; anything else (rgb(), names) is not offered to the model */
function toSixDigitHex(color: string | undefined): string | undefined {
  const hex = color?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  return `#${full.toUpperCase()}`;
}

/** The MVP's current color, the audit's brand colors and the dashboard presets, without repeats */
export function colorCandidates(
  current: string | undefined,
  brand: { primaryColor?: string; secondaryColor?: string; accentColor?: string } | undefined,
): MvpColorCandidate[] {
  const candidates: MvpColorCandidate[] = [];
  const add = (color: string | undefined, source: string) => {
    const hex = toSixDigitHex(color);
    if (hex && !candidates.some((candidate) => candidate.hex === hex)) candidates.push({ hex, source });
  };
  add(current, 'current');
  add(brand?.primaryColor, 'brand primary');
  add(brand?.secondaryColor, 'brand secondary');
  add(brand?.accentColor, 'brand accent');
  for (const preset of MVP_COLOR_PRESETS) add(preset.hex, `preset ${preset.name}`);
  return candidates;
}

const leadLocked = (status: string | undefined) =>
  new Error(`The MVP cannot be changed while the lead is ${status ?? 'unknown'}.`);

const expired = () =>
  new Error('The change was not applied: the dashboard stopped waiting for it. Try again.');

/**
 * Applies an operator's free-text change to a generated MVP (REV-85): the edit agent interprets it
 * under Strict Grounding, the new copy, primary color and/or layout are saved on the MVP, and the
 * published page is re-rendered before the result is returned, so the dashboard can reload it. A rebuilt
 * MVP (REV-111) is changed through its own id-only edit instead of the Bento copy and design. Same
 * rule as a layout change: never while a regeneration runs or once outreach is scheduled (HITL).
 */
export async function processMvpEditJob(
  data: IMvpEditJobData,
  service: MvpEditService = mvpEditService,
  now: () => number = Date.now,
  rebuildService: RebuildEditService = rebuildEditService,
): Promise<IMvpEditJobResult> {
  if (now() > data.deadline) throw expired();

  const project = await MvpProject.findById(data.mvpProjectId).exec();
  if (!project) throw new Error(`MVP ${data.mvpProjectId} not found.`);
  const leadId = project.leadId.toString();
  const lead = await Lead.findById(leadId).exec();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  if (!canChangeMvpLayout(lead.status)) throw leadLocked(lead.status);

  // The rebuilt original (REV-110) has its own edit (REV-111); a manual pick that fell back renders as Bento
  const rebuilt = project.layout?.variant === 'original';

  // Dropping the custom design asks no model: the template's own look is re-published (REV-92)
  if (data.action === 'reset-design' && rebuilt) {
    if (!hasRebuildEdit(project.rebuildEdit)) {
      return { applied: false, summary: 'The MVP has no custom design.', changes: [] };
    }
    await MvpProject.findByIdAndUpdate(project._id, { $set: { editedAt: new Date() }, $unset: { rebuildEdit: '' } }).exec();
    await republishSavedMvp(leadId);
    console.log(`[MvpEditWorker] Dropped the rebuild edit of MVP ${data.mvpProjectId}`);
    return { applied: true, summary: 'The custom design was removed.', changes: ['design'] };
  }
  if (data.action === 'reset-design') {
    if (!hasDesign(project.design)) {
      return { applied: false, summary: 'The MVP has no custom design.', changes: [] };
    }
    await MvpProject.findByIdAndUpdate(project._id, { $set: { editedAt: new Date() }, $unset: { design: '' } }).exec();
    await republishSavedMvp(leadId);
    console.log(`[MvpEditWorker] Dropped the custom design of MVP ${data.mvpProjectId}`);
    return { applied: true, summary: 'The custom design was removed.', changes: ['design'] };
  }

  const audit = await findGenerationAudit(leadId, project.auditId?.toString());
  if (!audit) throw new Error(`No completed audit found for lead ${leadId}.`);

  // Only the parts the change touched, so a palette or layout picked meanwhile is kept otherwise
  const apply = async (summary: string, changes: IMvpEditJobResult['changes'], update: Record<string, unknown>, unset: Record<string, ''> = {}) => {
    // The model may take a while: the operator may have given up, or the lead moved on meanwhile
    if (now() > data.deadline) throw expired();
    const latestLead = await Lead.findById(leadId).exec();
    if (!latestLead || !canChangeMvpLayout(latestLead.status)) throw leadLocked(latestLead?.status);
    await MvpProject.findByIdAndUpdate(project._id, { $set: { ...update, editedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    await republishSavedMvp(leadId);
    console.log(`[MvpEditWorker] Applied ${changes.join(', ')} to MVP ${data.mvpProjectId}: ${summary}`);
    return { applied: true, summary, changes };
  };
  const palette = (color: string | undefined) =>
    // Primary and accent together, as the palette picker saves them (REV-16)
    color ? { 'colorPalette.primary': color, 'colorPalette.accent': color } : {};

  // The rebuilt page (REV-111): the model edits the original's sections by id, never its copy
  if (rebuilt) {
    if (!audit.siteSections) throw new Error(`The audit of lead ${leadId} has no reading of the original page.`);
    const auditKey = audit._id.toString();
    // An edit for another audit run names other sections, so it is not offered as the current one
    const currentEdit = editForAudit(project.rebuildEdit, { _id: auditKey });
    // A Modernized page (REV-114) has the modern look under the edit; the model is told so it keeps it
    const modernize = project.layout?.rebuildLevel === 'modern' ? modernizeForAudit(project.modernize, { _id: auditKey, siteSections: audit.siteSections })?.design : undefined;
    const plan = await rebuildService.interpret({
      instruction: data.instruction,
      siteSections: audit.siteSections,
      current: { ...(currentEdit ? { edit: currentEdit } : {}), ...(modernize ? { modernize } : {}), primaryColor: project.colorPalette?.primary },
      colorCandidates: colorCandidates(project.colorPalette?.primary, audit.extractedBrandTokens),
    });
    if (plan.changes.length === 0) {
      console.log(`[MvpEditWorker] Nothing to change on MVP ${data.mvpProjectId}: ${plan.summary}`);
      return { applied: false, summary: plan.summary, changes: [] };
    }
    const dropEdit = plan.edit !== undefined && !hasRebuildEdit(plan.edit);
    return apply(
      plan.summary,
      plan.changes,
      {
        ...(plan.edit && !dropEdit ? { rebuildEdit: JSON.parse(JSON.stringify({ ...plan.edit, auditId: auditKey })) } : {}),
        ...palette(plan.primaryColor),
        ...(plan.layout ? { layout: manualMvpLayout(project.layout, plan.layout) } : {}),
      },
      dropEdit ? { rebuildEdit: '' } : {},
    );
  }

  const savedVariant = project.layout?.variant;
  const layout: BentoLayoutVariant =
    savedVariant && (BENTO_LAYOUT_VARIANTS as readonly string[]).includes(savedVariant) ? (savedVariant as BentoLayoutVariant) : 'bento';

  const plan = await service.interpret({
    instruction: data.instruction,
    grounding: {
      businessName: lead.businessName,
      niche: lead.niche,
      city: lead.city,
      originalUrl: lead.originalUrl,
      extractedServices: audit.extractedServices,
      contacts: {
        phone: audit.extractedContacts?.phone || lead.contactPhone,
        email: audit.extractedContacts?.email || lead.contactEmail,
        address: audit.extractedContacts?.address,
        workingHours: audit.extractedContacts?.workingHours,
      },
      siteContent: audit.extractedContent,
      critiqueQuickWins: audit.designCritique?.quickWins,
      ownerName: lead.ownerName,
    },
    current: {
      content: project.generatedContent as MvpContentOutput,
      primaryColor: project.colorPalette?.primary,
      layout,
      // The look the page has: the operator's design over the one derived from the original site (REV-104)
      design: mergeDesigns(project.layout?.design, project.design),
    },
    colorCandidates: colorCandidates(project.colorPalette?.primary, audit.extractedBrandTokens),
  });

  if (plan.changes.length === 0) {
    console.log(`[MvpEditWorker] Nothing to change on MVP ${data.mvpProjectId}: ${plan.summary}`);
    return { applied: false, summary: plan.summary, changes: [] };
  }

  // An empty design drops the custom design (REV-92)
  const dropDesign = plan.design !== undefined && !hasDesign(plan.design);
  return apply(
    plan.summary,
    plan.changes,
    {
      ...(plan.content ? { generatedContent: JSON.parse(JSON.stringify(plan.content)) } : {}),
      ...palette(plan.primaryColor),
      ...(plan.layout ? { layout: manualMvpLayout(project.layout, plan.layout) } : {}),
      ...(plan.design && !dropDesign ? { design: JSON.parse(JSON.stringify(plan.design)) } : {}),
    },
    dropDesign ? { design: '' } : {},
  );
}

export const createMvpEditWorker = (): Worker => {
  const worker = new Worker<IMvpEditJobData, IMvpEditJobResult>(
    QUEUE_NAMES.MVP_EDIT,
    (job: Job<IMvpEditJobData>) => processMvpEditJob(job.data),
    { connection: redisConnection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[MvpEditWorker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
};
