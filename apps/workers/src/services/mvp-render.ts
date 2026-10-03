import {
  IAudit,
  ILead,
  IMvpDesign,
  IMvpGeneratedContent,
  IMvpLayoutSelection,
  IMvpRebuildSummary,
  IRebuildEdit,
  IRebuildModernize,
  IRebuildModernizeAnswer,
  MVP_LAYOUT_MANUAL_ORIGINAL,
  MVP_LAYOUT_MANUAL_REASON,
  MVP_LAYOUT_MODERNIZE_REASONS,
  MVP_LAYOUT_REBUILD_REASON,
  MvpLayoutVariant,
  RebuildFallbackReason,
  RebuildLevel,
  BentoLayoutVariant,
} from '@revamp/shared-types';
import { MvpLayoutSelectionSchema } from '@revamp/validation';
import { MvpPaletteOverride, bentoTemplateService } from './template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from './rebuild-template.service.js';
import { defaultModernDesign, modernizeForAudit } from './rebuild-modernize.js';

// Picks the renderer for an MVP (REV-110): the rebuild of the original for `original`, else Bento, and
// Bento with the reason recorded whenever the rebuild is unavailable

const facts = (reasons: string[]) => reasons.filter((r) => !/^(rule|rebuild|coverage|manual|modernize|dated):/.test(r));
/** The codes of the rebuild's level (REV-114) */
const LEVEL_CODE = /^(modernize|dated):/;
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

/**
 * The rebuild's level (REV-114): the operator's pick when the previous layout has one, else `modern` for a site
 * the audit found dated, else `faithful`; with the reason codes for the layout
 */
export function rebuildLevelFor(
  previous: { rebuildLevel?: RebuildLevel | null; reasons?: string[] | null } | null | undefined,
  audit: Partial<IAudit>,
): { level: RebuildLevel; reasons: string[] } {
  if (previous?.reasons?.includes(MVP_LAYOUT_MODERNIZE_REASONS.manual)) {
    return { level: previous.rebuildLevel ?? 'faithful', reasons: [MVP_LAYOUT_MODERNIZE_REASONS.manual] };
  }
  if (audit.siteEra?.dated) return { level: 'modern', reasons: [MVP_LAYOUT_MODERNIZE_REASONS.dated, `dated:${audit.siteEra.score}`] };
  return { level: 'faithful', reasons: [] };
}

/** The layout's level codes replaced by `codes`, right after its rule code, so the caps never cut them */
const withLevelCodes = (layout: IMvpLayoutSelection, codes: string[]): IMvpLayoutSelection => {
  const [first, ...rest] = layout.reasons.filter((r) => !LEVEL_CODE.test(r));
  return selection({ ...layout, reasons: first === undefined ? codes : [first, ...codes, ...rest] });
};

/** An `original` layout at the given level, with its reasons; a Bento layout has no level */
export const withRebuildLevel = (layout: IMvpLayoutSelection, choice: { level: RebuildLevel; reasons: string[] }): IMvpLayoutSelection =>
  layout.variant === 'original' ? withLevelCodes({ ...layout, rebuildLevel: choice.level }, choice.reasons) : layout;

/**
 * The modernize design a render at `modern` applies: the stored one when it was made for this audit and still
 * fits, else the deterministic default (REV-114); with whether it is the default
 */
function modernDesign(stored: IRebuildModernize | null | undefined, audit: Partial<IAudit>): { design?: IRebuildModernizeAnswer; isDefault: boolean } {
  const valid = modernizeForAudit(stored, audit);
  if (valid) return { design: valid.design, isDefault: valid.source === 'default' };
  return audit.siteSections ? { design: defaultModernDesign(audit.siteSections), isDefault: true } : { isDefault: false };
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
  /** The stored modernize design (REV-114); applied only when the layout's level is `modern` */
  modernize?: IRebuildModernize | null;
}): MvpRender {
  const bento = (layout: IMvpLayoutSelection): MvpRender => ({
    html: bentoTemplateService.renderFromAudit(args.lead, args.audit, args.generatedContent, layout.variant as BentoLayoutVariant, args.palette, args.design),
    layout,
  });
  if (args.layout.variant !== 'original') return bento(args.layout);
  const level: RebuildLevel = args.layout.rebuildLevel ?? 'faithful';
  const modern = level === 'modern' ? modernDesign(args.modernize, args.audit) : { isDefault: false };
  try {
    const { html, summary } = rebuildTemplateService.renderFromAudit(args.lead, args.audit, args.palette, args.rebuildEdit, modern.design);
    // `modernize:default` describes this render's design only
    const codes = args.layout.reasons.filter((r) => LEVEL_CODE.test(r));
    const kept = codes.filter((r) => r !== MVP_LAYOUT_MODERNIZE_REASONS.fallback);
    const wanted = modern.isDefault ? [...kept, MVP_LAYOUT_MODERNIZE_REASONS.fallback] : kept;
    const layout = wanted.join() === codes.join() ? args.layout : withLevelCodes(args.layout, wanted);
    return { html, layout, rebuild: { ...summary, level } };
  } catch (error) {
    if (!(error instanceof RebuildUnavailable)) throw error;
    const manual = args.layout.reasons.includes(MVP_LAYOUT_MANUAL_REASON);
    return bento(fallbackLayout(args.derived, error.reason, error.facts, manual));
  }
}
