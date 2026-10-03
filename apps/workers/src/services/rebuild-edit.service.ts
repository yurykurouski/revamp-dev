import {
  BENTO_LAYOUT_VARIANTS,
  BentoLayoutVariant,
  IRebuildEditAnswer,
  ISiteSections,
  MVP_DESIGN_CORNERS,
  MVP_DESIGN_DENSITIES,
  MVP_DESIGN_FONTS,
  MvpEditChange,
  REBUILD_EDIT_ALIGNS,
  REBUILD_EDIT_BACKGROUNDS,
  REBUILD_EDIT_HEADING_CASES,
} from '@revamp/shared-types';
import { OUTLINE_LIMITS, RebuildEditOutputSchema, checkRebuildEdit, hasRebuildEdit } from '@revamp/validation';
import { MVP_CUSTOM_CSS_MAX, REBUILD_CSS_HOOKS, UnsafeCssError, sanitizeMvpCss } from '../templates/css-sanitizer.js';
import { LlmClient, extractJsonObject } from './llm-client.js';
import { EDIT_LLM_TIMEOUT_MS, LAYOUT_DESCRIPTIONS, MvpColorCandidate, MvpEditServiceOptions, normalizeHex, stableJson } from './mvp-edit.service.js';

// The free-text change on a rebuilt MVP (REV-111): the model reorders, hides, drops and restyles the original
// page's sections by id; it never writes copy or markup, and every id is checked against the page

/** One section of the page as the model sees it: ids and short previews of what it holds */
export interface RebuildOutlineSection {
  id: string;
  role: 'hero' | 'content';
  kind: string;
  arrangement: string;
  heading?: string;
  /** Paragraphs (`.t<n>`), items (`.i<n>`) and extra blocks (`.x<n>`) the edit may drop */
  pieces: { id: string; preview: string }[];
}

export interface RebuildEditInput {
  /** The operator's own words */
  instruction: string;
  /** The audit's reading of the original page, the source of every id */
  siteSections: ISiteSections;
  current: { edit?: IRebuildEditAnswer; primaryColor?: string };
  /** The only primary colors the edit may pick */
  colorCandidates: MvpColorCandidate[];
}

/** The change to apply, validated against the page; only the parts that differ from the current MVP */
export interface RebuildEditPlan {
  summary: string;
  /** The whole new edit; `{}` drops the current one */
  edit?: IRebuildEditAnswer;
  primaryColor?: string;
  /** A switch to a template layout */
  layout?: BentoLayoutVariant;
  changes: MvpEditChange[];
}

const preview = (text: string | undefined) => {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > OUTLINE_LIMITS.previewChars ? `${clean.slice(0, OUTLINE_LIMITS.previewChars - 1)}…` : clean;
};

/** The page's hero and content sections with the ids the edit may name; the header and footer are not offered */
export function buildRebuildOutline(read: ISiteSections): RebuildOutlineSection[] {
  return read.sections
    .filter((s): s is typeof s & { role: 'hero' | 'content' } => s.role === 'hero' || s.role === 'content')
    .map((s) => {
      const id = `s-${s.index}`;
      return {
        id,
        role: s.role,
        kind: s.kind,
        arrangement: s.arrangement,
        ...(s.intro.heading?.trim() ? { heading: preview(s.intro.heading) } : {}),
        pieces: [
          ...s.intro.text.map((text, n) => ({ id: `${id}.t${n}`, preview: preview(text) })),
          ...s.items.map((item, n) => ({ id: `${id}.i${n}`, preview: preview(item.title ?? item.text[0] ?? item.subtitle ?? item.price ?? item.image?.alt) })),
          ...s.extra.map((entry, n) => ({ id: `${id}.x${n}`, preview: preview(entry.type === 'text' ? entry.text[0] : entry.items[0]?.title ?? entry.items[0]?.text[0]) })),
        ],
      };
    });
}

const list = (values: readonly string[]) => values.join(', ');

export const REBUILD_EDIT_SYSTEM_PROMPT = `You are the editor of a one-page website (MVP) that rebuilds a local business's original home page section by section.
The operator describes, in their own words, a change they want. You apply it ONLY by reordering, hiding and restyling the page's sections, leaving out some of their paragraphs or items, choosing the primary color or layout, and writing CSS. Change nothing else.

FUNDAMENTAL RULES:
- You never write text that appears on the page: no headings, sentences, labels, numbers, contacts or links. The page shows only what the original site says.
- When the request needs new or reworded text (a new claim, a slogan, a rewritten paragraph, a translation), change nothing for that part and say why in the summary. Shortening is done by leaving out whole paragraphs or items by id.
- Use only the ids in "page". Never hide every section. The section of the page's main heading (the first hero section with a heading) can never be hidden, and when it is the first section it stays first.
- primaryColor must be one of the hex values in "allowedColors". layout must be one of "allowedLayouts" ("original" is this rebuild; the others replace it with a template).

Edit ("edit"): a JSON object; every field is optional and anything left out keeps the original page's look.
- order: section ids in the new page order. Listed sections come first in that order; unlisted ones follow in their original order.
- hidden: section ids to leave out.
- dropped: piece ids to leave out of their section (ids ending .t<n> are paragraphs, .i<n> items, .x<n> extra blocks).
- sections: per section id, { background: ${REBUILD_EDIT_BACKGROUNDS.join(' | ')} ("original" is the one read from the site, "page" white, "tinted" a light tint of the primary color, "brand" the primary color, "dark" near-black; the text color is adjusted for contrast), align: ${REBUILD_EDIT_ALIGNS.join(' | ')}, density: ${MVP_DESIGN_DENSITIES.join(' | ')} (vertical spacing) }.
- theme: { font: ${MVP_DESIGN_FONTS.join(' | ')} (system keeps the original's fonts; serif-display and mono-display change headings only), density: ${MVP_DESIGN_DENSITIES.join(' | ')} (spacing of every section without its own), corners: ${MVP_DESIGN_CORNERS.join(' | ')} (buttons and cards), headingCase: ${REBUILD_EDIT_HEADING_CASES.join(' | ')} }.
- customCss: plain CSS, only for a look none of the fields above can express (e.g. a gradient on buttons, an accent line under headings). Prefer the fields above whenever one fits. Rules: target only these hooks and classes: ${list(REBUILD_CSS_HOOKS)} (a section by its id, e.g. [data-revamp-section="s-3"]; combined with descendant elements, pseudo-classes, ::before and ::after as needed); no attribute selectors but data-revamp-*; no url(), @import, @font-face or other at-rules except @media, @supports and @keyframes; never hide, shrink, cover or move content off the page (no display:none, visibility, opacity below 0.2, zero sizes, clip or mask), no text through content (only content: ""), position fixed or sticky only on .rb-header; use variables such as var(--rb-primary), var(--rb-on-primary), var(--rb-page-text); add !important to override the page's styles; at most ${MVP_CUSTOM_CSS_MAX} characters. CSS that breaks a rule rejects the whole change.

Output:
- summary: one sentence (up to 300 characters) telling the operator what you changed, or why you changed nothing. Write it in the language of the operator's instruction.
- edit: the complete new edit, starting from "current.edit" and keeping every earlier choice the operator did not ask to change; {} removes the edit; null keeps it as it is.
- primaryColor: the new primary color, or null to keep the current one.
- layout: the new layout, or null to keep this rebuild.

Respond with a raw JSON object only, with no preamble and no markdown, in exactly this shape:
{"summary":string,"edit":object|null,"primaryColor":string|null,"layout":string|null}`;

/**
 * The rebuild edit agent (REV-111): turns an operator's free-text change to a rebuilt MVP into an id-only
 * edit. The answer is validated with Zod, checked against the page's sections and the CSS sanitizer, and a
 * failing answer is an error, never partly applied; there is no fallback without a provider (REV-45).
 */
export class RebuildEditService {
  private readonly llm: LlmClient;

  constructor(options: MvpEditServiceOptions = {}) {
    this.llm = new LlmClient(options);
  }

  async interpret(input: RebuildEditInput): Promise<RebuildEditPlan> {
    const unavailable = this.llm.unavailableReason();
    if (!this.llm.provider || unavailable) {
      throw new Error(unavailable ?? 'No LLM provider configured');
    }

    console.log(`[RebuildEditService] Interpreting "${input.instruction}" with ${this.llm.modelName}`);
    const raw = await this.llm.complete({
      systemPrompt: REBUILD_EDIT_SYSTEM_PROMPT,
      userPrompt: this.buildUserPrompt(input),
      temperature: 0.2,
      timeoutMs: EDIT_LLM_TIMEOUT_MS,
    });

    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch {
      throw new Error('The model did not answer with a change the MVP can apply.');
    }
    // CSS cut to the length limit would break mid-rule, so over-long CSS is refused rather than clipped
    const customCss = (parsed as { edit?: { customCss?: unknown } } | null)?.edit?.customCss;
    if (typeof customCss === 'string' && customCss.length > MVP_CUSTOM_CSS_MAX) {
      throw new UnsafeCssError([`it is ${customCss.length} characters long; the limit is ${MVP_CUSTOM_CSS_MAX}`]);
    }
    const result = RebuildEditOutputSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`The model's change is not valid (${issue?.path.join('.') || 'answer'}: ${issue?.message}).`);
    }
    return this.toPlan(result.data, input);
  }

  /** Checks the answer against the page and keeps only what differs from the current MVP */
  toPlan(output: ReturnType<typeof RebuildEditOutputSchema.parse>, input: RebuildEditInput): RebuildEditPlan {
    const plan: RebuildEditPlan = { summary: output.summary, changes: [] };

    if (output.edit) {
      const edit = { ...output.edit };
      const check = checkRebuildEdit(edit, input.siteSections);
      if (!check.ok) throw new Error(`The model's change does not fit the page (${check.reason}).`);
      // Checked and normalized here, so only CSS that passes is ever saved (REV-93)
      if (edit.customCss?.trim()) edit.customCss = sanitizeMvpCss(edit.customCss);
      else delete edit.customCss;
      const next = hasRebuildEdit(edit) ? edit : {};
      const current = input.current.edit ?? {};
      if (stableJson(next) !== stableJson(hasRebuildEdit(current) ? current : {})) {
        plan.edit = next;
        // Leaving out paragraphs or items changes the copy; the rest is the page's design
        if (stableJson(next.dropped ?? []) !== stableJson(current.dropped ?? [])) plan.changes.push('content');
        if (stableJson({ ...next, dropped: undefined }) !== stableJson({ ...current, dropped: undefined })) plan.changes.push('design');
      }
    }

    if (output.primaryColor) {
      const color = normalizeHex(output.primaryColor);
      if (!input.colorCandidates.some((candidate) => normalizeHex(candidate.hex) === color)) {
        throw new Error(`The model picked ${output.primaryColor}, which is not one of the MVP's brand or preset colors.`);
      }
      if (color !== normalizeHex(input.current.primaryColor ?? '')) {
        plan.primaryColor = color;
        plan.changes.push('palette');
      }
    }

    if (output.layout && (BENTO_LAYOUT_VARIANTS as readonly string[]).includes(output.layout)) {
      plan.layout = output.layout as BentoLayoutVariant;
      plan.changes.push('layout');
    }

    return plan;
  }

  private buildUserPrompt(input: RebuildEditInput): string {
    return JSON.stringify(
      {
        instruction: input.instruction,
        page: buildRebuildOutline(input.siteSections),
        current: { edit: input.current.edit ?? {}, primaryColor: input.current.primaryColor ?? null, layout: 'original' },
        allowedColors: input.colorCandidates,
        allowedLayouts: [
          { id: 'original', description: 'this rebuild of the original page' },
          ...BENTO_LAYOUT_VARIANTS.map((variant) => ({ id: variant, description: `a template: ${LAYOUT_DESCRIPTIONS[variant]}` })),
        ],
      },
      null,
      2,
    );
  }
}

export const rebuildEditService = new RebuildEditService();
