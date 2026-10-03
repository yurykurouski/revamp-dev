import {
  IAudit,
  ILead,
  IMvpDesign,
  IMvpGeneratedContent,
  IMvpLayoutSelection,
  IMvpRebuildSummary,
  IRebuildEdit,
  MVP_LAYOUT_MANUAL_ORIGINAL,
  MVP_LAYOUT_MANUAL_REASON,
  MVP_LAYOUT_REBUILD_REASON,
  MvpLayoutVariant,
  RebuildFallbackReason,
  BentoLayoutVariant,
} from '@revamp/shared-types';
import { MvpLayoutSelectionSchema } from '@revamp/validation';
import { MvpPaletteOverride, bentoTemplateService } from './template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from './rebuild-template.service.js';

// Picks the renderer for an MVP (REV-110): the rebuild of the original for `original`, else Bento, and
// Bento with the reason recorded whenever the rebuild is unavailable

const facts = (reasons: string[]) => reasons.filter((r) => !/^(rule|rebuild|coverage|manual):/.test(r));
const selection = (layout: IMvpLayoutSelection) => MvpLayoutSelectionSchema.parse({ ...layout, reasons: layout.reasons.map((r) => r.slice(0, 60)).slice(0, 12) });

/** The rebuild: the audit facts and the look derived from the original (REV-104) are kept for a switch to Bento */
export const rebuildLayout = (derived: IMvpLayoutSelection): IMvpLayoutSelection =>
  selection({ variant: 'original', reasons: [MVP_LAYOUT_REBUILD_REASON, ...facts(derived.reasons)], ...(derived.design ? { design: derived.design } : {}) });

/** The derived Bento choice with the fallback reason first; a manual `original` pick stays marked for the next run */
export const fallbackLayout = (derived: IMvpLayoutSelection, reason: RebuildFallbackReason, reasonFacts: string[], manual: boolean): IMvpLayoutSelection =>
  selection({
    ...derived,
    reasons: manual
      ? [MVP_LAYOUT_MANUAL_REASON, MVP_LAYOUT_MANUAL_ORIGINAL, reason, ...reasonFacts, ...facts(derived.reasons)]
      : [reason, ...reasonFacts, ...derived.reasons],
  });

/** The variant the operator picked, when the previous layout was a manual pick */
export function requestedVariant(previous: { variant?: MvpLayoutVariant; reasons?: string[] | null } | null | undefined): MvpLayoutVariant | undefined {
  if (!previous?.reasons?.includes(MVP_LAYOUT_MANUAL_REASON)) return undefined;
  return previous.reasons.includes(MVP_LAYOUT_MANUAL_ORIGINAL) ? 'original' : previous.variant;
}

export interface MvpRender {
  html: string;
  layout: IMvpLayoutSelection;
  rebuild?: IMvpRebuildSummary;
}

export function renderMvp(args: {
  lead: Partial<ILead>;
  audit: Partial<IAudit>;
  generatedContent?: Partial<IMvpGeneratedContent>;
  layout: IMvpLayoutSelection;
  derived: IMvpLayoutSelection;
  palette?: MvpPaletteOverride;
  design?: IMvpDesign;
  /** The operator's change to the rebuild (REV-111); not used by Bento */
  rebuildEdit?: IRebuildEdit | null;
}): MvpRender {
  const bento = (layout: IMvpLayoutSelection): MvpRender => ({
    html: bentoTemplateService.renderFromAudit(args.lead, args.audit, args.generatedContent, layout.variant as BentoLayoutVariant, args.palette, args.design),
    layout,
  });
  if (args.layout.variant !== 'original') return bento(args.layout);
  try {
    const { html, summary } = rebuildTemplateService.renderFromAudit(args.lead, args.audit, args.palette, args.rebuildEdit);
    return { html, layout: args.layout, rebuild: summary };
  } catch (error) {
    if (!(error instanceof RebuildUnavailable)) throw error;
    const manual = args.layout.reasons.includes(MVP_LAYOUT_MANUAL_REASON);
    return bento(fallbackLayout(args.derived, error.reason, error.facts, manual));
  }
}
