import type { IAudit, ILead, IMvpRebuildSummary, IRebuildEdit, IRebuildEditAnswer, IRebuildModernizeAnswer, RebuildFallbackReason } from '@revamp/shared-types';
import { RebuildPlanSchema, rebuildEligibility } from '@revamp/validation';
import { env } from '../config/env.js';
import { renderRebuild } from '../templates/rebuild/index.js';
import { planRebuild } from './rebuild-plan.service.js';
import { BentoTemplateService, MvpPaletteOverride } from './template.service.js';

/** Why the rebuild could not be rendered; the caller falls back to the Bento template (REV-110) */
export class RebuildUnavailable extends Error {
  constructor(
    readonly reason: RebuildFallbackReason,
    readonly facts: string[] = [],
  ) {
    super(`Rebuild unavailable: ${reason}${facts.length ? ` (${facts.join(', ')})` : ''}`);
    this.name = 'RebuildUnavailable';
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const isHttpUrl = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));

/** The site's own button color, so the default CTA looks like theirs; else the brand color */
export function defaultRebuildPrimary(audit: Partial<IAudit> | undefined): string {
  const button = audit?.siteSections?.typography?.button?.background;
  if (button && HEX.test(button)) return button;
  const brand = audit?.extractedBrandTokens?.primaryColor;
  return brand && HEX.test(brand) ? brand : '#2563eb';
}

/**
 * The operator's edit (REV-111) without its audit id, when it was made for this audit; its ids name this audit's
 * sections only, so an edit for another audit run is left out
 */
export function editForAudit(edit: IRebuildEdit | null | undefined, audit: Partial<IAudit> | undefined): IRebuildEditAnswer | undefined {
  if (!edit) return undefined;
  const { auditId, ...answer } = edit;
  if (auditId !== String(audit?._id ?? '')) {
    console.warn(`[RebuildTemplate] Edit for audit ${auditId} left out: the MVP renders audit ${String(audit?._id ?? 'unknown')}`);
    return undefined;
  }
  return answer;
}

export const rebuildTemplateService = {
  /** Plan → validate → render → size check; throws RebuildUnavailable for every fallback reason */
  renderFromAudit(
    lead: Partial<ILead>,
    audit: Partial<IAudit> | undefined,
    palette?: MvpPaletteOverride,
    edit?: IRebuildEdit | null,
    /** The modernize layer (REV-114), already checked against this audit's sections; under the operator's edit */
    modernize?: IRebuildModernizeAnswer,
    now: Date = new Date(),
  ): { html: string; summary: IMvpRebuildSummary } {
    const eligible = rebuildEligibility(audit);
    if (!eligible.ok) throw new RebuildUnavailable(eligible.reason, eligible.facts);
    const contacts = audit?.extractedContacts;
    const answer = editForAudit(edit, audit);
    const primary = palette?.primary && HEX.test(palette.primary) ? palette.primary : defaultRebuildPrimary(audit);
    const parsed = RebuildPlanSchema.safeParse(
      planRebuild({
        siteSections: audit!.siteSections!,
        businessName: lead.businessName || lead.domain || 'Business',
        language: audit?.extractedContent?.language,
        contacts: {
          phone: contacts?.phone || lead.contactPhone,
          email: contacts?.email || lead.contactEmail,
          address: contacts?.address,
          workingHours: contacts?.workingHours,
        },
        socialLinks: contacts?.socialLinks ?? [],
        logoUrl: isHttpUrl(audit?.extractedBrandTokens?.logoUrl) ? audit!.extractedBrandTokens!.logoUrl : undefined,
        primary,
        year: now.getFullYear(),
        ...(modernize ? { modernize } : {}),
        ...(answer ? { edit: answer } : {}),
      }),
    );
    if (!parsed.success) throw new RebuildUnavailable('rebuild:invalid', [`invalid:${parsed.error.issues[0]?.path.join('.') ?? 'plan'}`.slice(0, 60)]);
    const html = renderRebuild(parsed.data, { publicApiUrl: isHttpUrl(env.PUBLIC_API_URL) ? env.PUBLIC_API_URL : undefined });
    if (Buffer.byteLength(html, 'utf8') > BentoTemplateService.MAX_BUNDLE_SIZE_BYTES) throw new RebuildUnavailable('rebuild:too_large');
    return { html, summary: parsed.data.summary };
  },
};
