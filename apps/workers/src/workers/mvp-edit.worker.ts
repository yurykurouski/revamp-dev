import { Worker, Job } from 'bullmq';
import {
  IMvpEditJobData,
  IMvpEditJobResult,
  MVP_COLOR_PRESETS,
  MVP_LAYOUT_MANUAL_REASON,
  MVP_LAYOUT_VARIANTS,
  MvpLayoutVariant,
} from '@revamp/shared-types';
import { MvpContentOutput, MvpLayoutSelectionSchema, canChangeMvpLayout } from '@revamp/validation';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queue.constants.js';
import { Lead } from '../models/Lead.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { findGenerationAudit } from '../services/audit-lookup.js';
import { MvpColorCandidate, MvpEditService, mvpEditService } from '../services/mvp-edit.service.js';
import { republishSavedMvp } from './deploy.worker.js';
import { hasDesign } from '../templates/design.js';

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
 * published page is re-rendered before the result is returned, so the dashboard can reload it. Same
 * rule as a layout change: never while a regeneration runs or once outreach is scheduled (HITL).
 */
export async function processMvpEditJob(
  data: IMvpEditJobData,
  service: MvpEditService = mvpEditService,
  now: () => number = Date.now,
): Promise<IMvpEditJobResult> {
  if (now() > data.deadline) throw expired();

  const project = await MvpProject.findById(data.mvpProjectId).exec();
  if (!project) throw new Error(`MVP ${data.mvpProjectId} not found.`);
  const leadId = project.leadId.toString();
  const lead = await Lead.findById(leadId).exec();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  if (!canChangeMvpLayout(lead.status)) throw leadLocked(lead.status);

  // Dropping the custom design asks no model: the template's own look is re-published (REV-92)
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

  const savedVariant = project.layout?.variant;
  const layout: MvpLayoutVariant =
    savedVariant && (MVP_LAYOUT_VARIANTS as readonly string[]).includes(savedVariant) ? savedVariant : 'bento';

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
      design: project.design ?? undefined,
    },
    colorCandidates: colorCandidates(project.colorPalette?.primary, audit.extractedBrandTokens),
  });

  if (plan.changes.length === 0) {
    console.log(`[MvpEditWorker] Nothing to change on MVP ${data.mvpProjectId}: ${plan.summary}`);
    return { applied: false, summary: plan.summary, changes: [] };
  }

  // The model may take a while: the operator may have given up, or the lead moved on meanwhile
  if (now() > data.deadline) throw expired();
  const latestLead = await Lead.findById(leadId).exec();
  if (!latestLead || !canChangeMvpLayout(latestLead.status)) throw leadLocked(latestLead?.status);

  // Only the parts the change touched, so a palette or layout picked meanwhile is kept otherwise
  const update: Record<string, unknown> = { editedAt: new Date() };
  if (plan.content) update['generatedContent'] = JSON.parse(JSON.stringify(plan.content));
  if (plan.primaryColor) {
    // Primary and accent together, as the palette picker saves them (REV-16)
    update['colorPalette.primary'] = plan.primaryColor;
    update['colorPalette.accent'] = plan.primaryColor;
  }
  if (plan.layout) {
    const facts = (project.layout?.reasons ?? []).filter((reason) => !reason.startsWith('rule:'));
    update['layout'] = MvpLayoutSelectionSchema.parse({
      variant: plan.layout,
      reasons: [MVP_LAYOUT_MANUAL_REASON, ...facts].slice(0, 12),
    });
  }
  // An empty design drops the custom design (REV-92)
  const dropDesign = plan.design !== undefined && !hasDesign(plan.design);
  if (plan.design && !dropDesign) update['design'] = JSON.parse(JSON.stringify(plan.design));
  await MvpProject.findByIdAndUpdate(project._id, { $set: update, ...(dropDesign ? { $unset: { design: '' } } : {}) }).exec();

  await republishSavedMvp(leadId);
  console.log(`[MvpEditWorker] Applied ${plan.changes.join(', ')} to MVP ${data.mvpProjectId}: ${plan.summary}`);
  return { applied: true, summary: plan.summary, changes: plan.changes };
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
