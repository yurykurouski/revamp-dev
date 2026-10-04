import {
  IAudit,
  ILead,
  IMvpDesign,
  IMvpGeneratedContent,
  IMvpLayoutSelection,
  IMvpRebuildSummary,
  IMvpRenderFailure,
  IRebuildEdit,
  IRebuildModernize,
  MVP_LAYOUT_MANUAL_ORIGINAL,
  MVP_LAYOUT_MANUAL_REASON,
  MVP_LAYOUT_MODERNIZE_REASONS,
  MVP_LAYOUT_REBUILD_REASON,
  MvpLayoutVariant,
  RebuildLevel,
  BentoLayoutVariant,
} from '@revamp/shared-types';
import { MvpLayoutSelectionSchema, rebuildEligibility } from '@revamp/validation';
import { MvpPaletteOverride, bentoTemplateService } from './template.service.js';
import { RebuildUnavailable, rebuildTemplateService } from './rebuild-template.service.js';
import { modernizeForAudit } from './rebuild-modernize.js';

// Picks the renderer for an MVP (REV-110): the rebuild of the original for `original`, else Bento. The rebuild
// and its modern look come from the models only (REV-132): when either is missing the render fails with the
// reason, and nothing (Bento, the rules reading or a default look) is rendered in its place

/** Why a render could not be made (REV-132), with the API error code the dashboard reads */
export class MvpRenderError extends Error {
  constructor(readonly failure: Omit<IMvpRenderFailure, 'at'>) {
    super(`${failure.code}: ${failure.reason}${failure.message ? ` (${failure.message})` : ''}`);
    this.name = 'MvpRenderError';
  }
}

/** The code a layout rendered before REV-132 carries when the default look stood in for the model's */
const LEGACY_DEFAULT_CODE = 'modernize:default';

const facts = (reasons: string[]) => reasons.filter((r) => !/^(rule|rebuild|coverage|manual|modernize|dated):/.test(r));
/** The codes of the rebuild's level (REV-114) */
const LEVEL_CODE = /^(modernize|dated):/;
const selection = (layout: IMvpLayoutSelection) => MvpLayoutSelectionSchema.parse({ ...layout, reasons: layout.reasons.map((r) => r.slice(0, 60)).slice(0, 12) });

/** The rebuild: the audit facts and the look derived from the original (REV-104) are kept for a switch to Bento */
export const rebuildLayout = (derived: IMvpLayoutSelection): IMvpLayoutSelection =>
  selection({ variant: 'original', reasons: [MVP_LAYOUT_REBUILD_REASON, ...facts(derived.reasons)], ...(derived.design ? { design: derived.design } : {}) });

/** The variant the operator picked, when the previous layout was a manual pick; `manual:original` marks one that fell back before REV-132 */
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

export interface MvpRender {
  html: string;
  layout: IMvpLayoutSelection;
  rebuild?: IMvpRebuildSummary;
}

/** Throws MvpRenderError when the rebuild or its modern look has no model answer; never renders a stand-in */
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
  if (args.layout.variant !== 'original') {
    return {
      html: bentoTemplateService.renderFromAudit(args.lead, args.audit, args.generatedContent, args.layout.variant as BentoLayoutVariant, args.palette, args.design),
      layout: args.layout,
    };
  }
  const level: RebuildLevel = args.layout.rebuildLevel ?? 'faithful';
  const rebuildFailure = (error: RebuildUnavailable) =>
    new MvpRenderError({ code: 'MVP_REBUILD_UNAVAILABLE', reason: error.reason, level, message: error.message.slice(0, 300) });
  let modern: ReturnType<typeof modernizeForAudit>;
  if (level === 'modern') {
    // The rebuild's own reason comes first: without the model's sections there is no page to modernize
    const eligible = rebuildEligibility(args.audit);
    if (!eligible.ok) throw rebuildFailure(new RebuildUnavailable(eligible.reason, eligible.facts));
    modern = modernizeForAudit(args.modernize, args.audit);
    if (!modern) {
      const stored = args.modernize;
      if (stored?.source === 'failed' && stored.error && stored.auditId === String(args.audit._id ?? '')) {
        throw new MvpRenderError({ code: 'MVP_MODERNIZE_UNAVAILABLE', reason: stored.error, level, ...(stored.message ? { message: stored.message } : {}) });
      }
      // The caller asks the model first (`resolveModernize`), so this is a bug, not a model failure
      throw new Error(`renderMvp: no modern design was resolved for audit ${String(args.audit._id ?? 'unknown')}`);
    }
  }
  try {
    const { html, summary } = rebuildTemplateService.renderFromAudit(args.lead, args.audit, args.palette, args.rebuildEdit, modern?.design);
    const layout = args.layout.reasons.includes(LEGACY_DEFAULT_CODE)
      ? selection({ ...args.layout, reasons: args.layout.reasons.filter((r) => r !== LEGACY_DEFAULT_CODE) })
      : args.layout;
    return { html, layout, rebuild: { ...summary, level } };
  } catch (error) {
    if (error instanceof RebuildUnavailable) throw rebuildFailure(error);
    throw error;
  }
}
