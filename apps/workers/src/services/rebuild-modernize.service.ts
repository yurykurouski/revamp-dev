import {
  IRebuildModernize,
  IRebuildModernizeAnswer,
  ISiteSection,
  ISiteSections,
  MVP_DESIGN_CORNERS,
  MVP_DESIGN_DENSITIES,
  MVP_DESIGN_FONTS,
  REBUILD_EDIT_ALIGNS,
  REBUILD_EDIT_ARRANGEMENTS,
  REBUILD_EDIT_BACKGROUNDS,
  REBUILD_HERO_STYLES,
  REBUILD_MEDIA_FITS,
  REBUILD_TYPE_SCALES,
} from '@revamp/shared-types';
import { REBUILD_BANNER_MIN_WIDTH, REBUILD_CARD_MAX_CHARS, RebuildModernizeAnswerSchema, cardRun, checkRebuildEdit } from '@revamp/validation';
import { LlmClient, LlmUsage, extractJsonObject } from './llm-client.js';
import { EDIT_LLM_TIMEOUT_MS, MvpEditServiceOptions } from './mvp-edit.service.js';
import { buildRebuildOutline } from './rebuild-edit.service.js';
import { defaultModernDesign } from './rebuild-modernize.js';

// The modernize level's model call (REV-114): the model chooses a look for a dated site's rebuild by ids and
// fixed values only; the answer is validated and checked against the page, and the code's default stands in
// when the model is unavailable or wrong. It never writes text.

const list = (values: readonly string[]) => values.join(' | ');

export const REBUILD_MODERNIZE_SYSTEM_PROMPT = `You are the art director of a one-page website (MVP) that rebuilds a local business's dated home page section by section. You choose how to modernize its look. You decide ONLY the layout and style of the sections the page already has.

FUNDAMENTAL RULES:
- Keep everything: never hide, drop or reorder a section, paragraph or item. The page shows only what the original site says.
- You never write text that appears on the page: no headings, sentences, labels, numbers, contacts or links. Your answer holds ids and the fixed values below, never a sentence.
- Use only the ids in "page". "start" is a sound default design: improve it only where the page calls for it, otherwise return it as it is.

Answer { "design": { ... } }; every field is optional:
- hero: { photo: an id from "images" of one of the next sections after the opening one (s-<i>.m<n>), style: ${list(REBUILD_HERO_STYLES)} } opens the page with that photo. Only when the opening section has no photo of its own. "banner" only for a photo at least ${REBUILD_BANNER_MIN_WIDTH} px wide; "split" puts it beside the opening text.
- sections: per section id, {
  arrangement: ${list(REBUILD_EDIT_ARRANGEMENTS)} (only a value from the section's "arrangeAs", which lists what its content fits: cards or a list for a run of 3 or more paragraphs of at most ${REBUILD_CARD_MAX_CHARS} characters, cards for 3 or more items; leave it out when "arrangeAs" is empty),
  mediaSide: left | right and media: ${list(REBUILD_MEDIA_FITS)} (only for a section with "photoBeside": true; "fill" stretches the photo to its column),
  background: ${list(REBUILD_EDIT_BACKGROUNDS)} ("original" is the one read from the site, "page" white, "tinted" a light tint of the primary color, "brand" the primary color, "dark" near-black; text color is adjusted for contrast; alternate page and tinted for rhythm, and leave a section with its own photo behind it alone),
  align: ${list(REBUILD_EDIT_ALIGNS)},
  density: ${list(MVP_DESIGN_DENSITIES)} (vertical spacing) }.
- theme: { typeScale: ${list(REBUILD_TYPE_SCALES)} ("modern" sets larger headings and body text), font: ${list(MVP_DESIGN_FONTS)} (leave it out to keep the original's fonts), density: ${list(MVP_DESIGN_DENSITIES)}, corners: ${list(MVP_DESIGN_CORNERS)} (buttons and cards) }. "brandColors" shows the site's own colors; choose a look that suits them.

Respond with a raw JSON object only, with no preamble and no markdown, in exactly this shape:
{"design":object}`;

/**
 * The arrangements a section's content fits besides its own (REV-114), by the rules `checkRebuildEdit` applies:
 * a `text` section with a run of short paragraphs takes cards or a list, a `list` of 3 or more items takes cards
 */
export function fittingArrangements(section: ISiteSection): (typeof REBUILD_EDIT_ARRANGEMENTS)[number][] {
  if (section.arrangement === 'text') return cardRun(section.intro.text) ? ['card-grid', 'list'] : [];
  return section.arrangement === 'list' && section.items.length >= 3 ? ['card-grid'] : [];
}

/** The page the model sees: the edit outline, with what each section's content fits */
export function modernizeOutline(read: ISiteSections) {
  const byId = new Map(read.sections.map((s) => [`s-${s.index}`, s]));
  return buildRebuildOutline(read).map((entry) => {
    const section = byId.get(entry.id)!;
    return {
      ...entry,
      arrangeAs: fittingArrangements(section),
      photoBeside: section.arrangement === 'media-beside-text' && section.images.length > 0,
    };
  });
}

export interface RebuildModernizeInput {
  /** The audit's reading of the original page, the source of every id */
  siteSections: ISiteSections;
  /** The site's own colors, as hex */
  brandColors: string[];
}

export type RebuildModernizeChoice = Omit<IRebuildModernize, 'auditId'> & {
  /** Tokens the calls used, when the provider reported them */
  usage?: LlmUsage;
  /** The model the tokens were used by, set with `usage` */
  model?: string;
};

export class RebuildModernizeService {
  private readonly llm: LlmClient;

  constructor(options: MvpEditServiceOptions = {}) {
    this.llm = new LlmClient(options);
  }

  /** The model's design when it passes, else the default with the reason; never throws for a model failure */
  async choose(input: RebuildModernizeInput): Promise<RebuildModernizeChoice> {
    const start = defaultModernDesign(input.siteSections);
    const fallback = (error: string, usage?: LlmUsage): RebuildModernizeChoice => ({ source: 'default', design: start, error, ...(usage ? { usage, model: this.llm.modelName } : {}) });
    const unavailable = this.llm.unavailableReason();
    if (!this.llm.provider || unavailable) return fallback('not_configured');

    const page = modernizeOutline(input.siteSections);
    let usage: LlmUsage | undefined;
    let rejected: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        console.log(`[RebuildModernizeService] Choosing the design with ${this.llm.modelName}${rejected ? ' (retry)' : ''}`);
        const completion = await this.llm.completeWithUsage({
          systemPrompt: REBUILD_MODERNIZE_SYSTEM_PROMPT,
          userPrompt: JSON.stringify({ page, brandColors: input.brandColors, start, ...(rejected ? { previousAnswerRejected: rejected } : {}) }, null, 2),
          temperature: 0.2,
          timeoutMs: EDIT_LLM_TIMEOUT_MS,
        });
        text = completion.text;
        if (completion.usage) {
          usage = usage
            ? {
                promptTokens: usage.promptTokens + completion.usage.promptTokens,
                completionTokens: usage.completionTokens + completion.usage.completionTokens,
                totalTokens: usage.totalTokens + completion.usage.totalTokens,
              }
            : completion.usage;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RebuildModernizeService] Call failed: ${message}`);
        return fallback(`call_failed: ${message}`, usage);
      }
      const checked = this.check(text, input.siteSections);
      if (checked.ok) return { source: 'llm', design: checked.design, ...(usage ? { usage, model: this.llm.modelName } : {}) };
      rejected = checked.reason;
      console.warn(`[RebuildModernizeService] Answer rejected: ${rejected}`);
    }
    return fallback(`invalid: ${rejected}`, usage);
  }

  private check(text: string, read: ISiteSections): { ok: true; design: IRebuildModernizeAnswer } | { ok: false; reason: string } {
    let parsed: unknown;
    try {
      parsed = extractJsonObject(text);
    } catch {
      return { ok: false, reason: 'the answer is not a JSON object' };
    }
    const result = RebuildModernizeAnswerSchema.safeParse((parsed as { design?: unknown } | null)?.design);
    if (!result.success) {
      const issue = result.error.issues[0];
      return { ok: false, reason: `${issue?.path.join('.') || 'design'}: ${issue?.message}` };
    }
    const design = result.data as IRebuildModernizeAnswer;
    const check = checkRebuildEdit(design, read);
    return check.ok ? { ok: true, design } : { ok: false, reason: check.reason };
  }
}

export const rebuildModernizeService = new RebuildModernizeService();
