import { MvpContentOutput, MvpEditOutputSchema } from '@revamp/validation';
import {
  IMvpDesign,
  MVP_DESIGN_BLOCK_IDS,
  MVP_DESIGN_BLOCK_STYLES,
  MVP_DESIGN_BLOCK_TYPES,
  MVP_DESIGN_CORNERS,
  MVP_DESIGN_DENSITIES,
  MVP_DESIGN_ELEMENTS,
  MVP_DESIGN_FONTS,
  MVP_DESIGN_HEADER_LAYOUTS,
  MVP_DESIGN_HERO_IMAGE_SIDES,
  MVP_DESIGN_HERO_PARTS,
  MVP_DESIGN_HERO_STYLES,
  MVP_DESIGN_HIDEABLE,
  MVP_DESIGN_SECTIONS,
  MVP_DESIGN_TOKENS,
  BENTO_LAYOUT_VARIANTS,
  MvpEditChange,
  BentoLayoutVariant,
} from '@revamp/shared-types';
import { ClaudeCliRunner } from './claude-cli.js';
import { getSupportedIconNames } from '../templates/icons.js';
import { MVP_CSS_HOOKS, MVP_CUSTOM_CSS_MAX, UnsafeCssError, sanitizeMvpCss } from '../templates/css-sanitizer.js';
import { LlmClient, LlmProvider, extractJsonObject } from './llm-client.js';
import { GenerateMvpContentInput, MvpContentService, clipToSchemaLimits, mvpContentService } from './mvp-content.service.js';

/** A primary color the edit may pick, and where it comes from */
export interface MvpColorCandidate {
  hex: string;
  /** e.g. "brand primary", "preset Amber", "current" */
  source: string;
}

export interface MvpEditInput {
  /** The operator's own words */
  instruction: string;
  /** The original site's facts, as the MVP was generated from them */
  grounding: GenerateMvpContentInput;
  current: {
    content: MvpContentOutput;
    primaryColor?: string;
    layout: BentoLayoutVariant;
    /** The MVP's custom design (REV-92), if it has one */
    design?: IMvpDesign;
  };
  /** The only primary colors the edit may pick */
  colorCandidates: MvpColorCandidate[];
}

/** The change to apply, validated and grounded; only the parts that differ from the current MVP */
export interface MvpEditPlan {
  summary: string;
  content?: MvpContentOutput;
  primaryColor?: string;
  layout?: BentoLayoutVariant;
  /** The whole new custom design; `{}` drops the current one (REV-92) */
  design?: IMvpDesign;
  changes: MvpEditChange[];
}

export interface MvpEditServiceOptions {
  provider?: LlmProvider;
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  customFetcher?: typeof fetch;
  claudeCliRunner?: ClaudeCliRunner;
  /** Grounding rules shared with MVP generation */
  contentService?: MvpContentService;
}

/** How long an HTTP provider may take to answer; the CLI has its own timeout */
const EDIT_LLM_TIMEOUT_MS = 90_000;

const LAYOUT_DESCRIPTIONS: Record<BentoLayoutVariant, string> = {
  bento: 'a grid of service cards',
  split: 'copy beside a large photo',
  editorial: 'a typographic, text-led page',
  compact: 'a short single-column page',
};

const list = (values: readonly string[]) => values.join(', ');

/** Icons the page uses for its own controls, not offered for a feature */
const BLOCK_UI_ICONS = new Set(['arrow-right', 'external-link', 'chevron-down', 'send', 'check', 'alert-circle', 'info']);

/** The design vocabulary (REV-92), written from the same constants the schema and template use */
const DESIGN_VOCABULARY = `Design spec ("design"): a JSON object; every field is optional and anything left out keeps the template's own look.
- sectionOrder: page order of content sections and custom blocks, from: ${list([...MVP_DESIGN_SECTIONS, ...MVP_DESIGN_BLOCK_IDS])}. Unlisted ones follow in the layout's order. The hero is always first and the booking form always last.
- hidden: what to leave out, from: ${list(MVP_DESIGN_HIDEABLE)} ("trust" is the hero's trust bar). The hero, the booking form and the contacts can never be hidden.
- hero: { align: left | center, order: the hero parts in display order, from ${list(MVP_DESIGN_HERO_PARTS)}, imageSide: ${MVP_DESIGN_HERO_IMAGE_SIDES.join(' | ')} (split layout photo; behind puts it behind the copy as a darkened backdrop) }.
- header: { layout: ${MVP_DESIGN_HEADER_LAYOUTS.join(' | ')} (centered puts the logo in the middle), links: true | false (links to the page's sections in the header) }.
- theme: { font: ${MVP_DESIGN_FONTS.join(' | ')} (serif-display and mono-display change headings only), density: ${MVP_DESIGN_DENSITIES.join(' | ')}, corners: ${MVP_DESIGN_CORNERS.join(' | ')}, heroStyle: ${MVP_DESIGN_HERO_STYLES.join(' | ')} }.
- elements: styles for named elements, keyed by ${list(MVP_DESIGN_ELEMENTS)}. Each style may set: ${Object.entries(MVP_DESIGN_TOKENS)
  .map(([token, values]) => `${token} (${values.join(' | ')})`)
  .join('; ')}. size applies to text elements; colors are palette roles, never hex values.
- blocks: up to 3 custom sections { id: ${MVP_DESIGN_BLOCK_IDS.join(' | ')}, type: ${MVP_DESIGN_BLOCK_TYPES.join(' | ')}, style: ${MVP_DESIGN_BLOCK_STYLES.join(' | ')}, title (up to 80 characters), body (up to 280), items (features only: 1-4 of { title up to 50, text up to 140, icon: one of ${list(getSupportedIconNames().filter((icon) => !BLOCK_UI_ICONS.has(icon)))} }), buttonText (cta only, up to 35; the button opens the booking form) }. Place a block with sectionOrder. Block text is copy: the same grounding rules apply.
- customCss: plain CSS, only for a look none of the fields above can express (e.g. gradient text, a hover tilt, an accent line under titles). Prefer the fields above whenever one fits. Rules: target only these hooks and classes: ${MVP_CSS_HOOKS.join(', ')} (combined with descendant elements, pseudo-classes, ::before and ::after as needed); no url(), @import, @font-face or other at-rules except @media, @supports and @keyframes; never hide, shrink, cover or move content off the page (no display:none, visibility, opacity below 0.2, zero sizes, clip or mask), no text through content (only content: ""), position fixed or sticky only on .site-header; use palette variables such as var(--brand-primary), var(--brand-accent), var(--color-text-main); add !important to override the design's styles; at most ${MVP_CUSTOM_CSS_MAX} characters. CSS that breaks a rule rejects the whole change.`;

export const MVP_EDIT_SYSTEM_PROMPT = `You are the editor of a generated one-page landing page (MVP) for a local business.
The operator describes, in their own words, a change they want. Apply it to the MVP's current copy, primary color, layout and design, and change nothing else.

FUNDAMENTAL GROUNDING RULES:
- Every fact (services, products, locations, numbers, years, ratings, prices, staff, awards) must come from "originalSite" or the current copy. Never invent any of them, even when the operator asks for one.
- Never output phone numbers, email addresses, street addresses or links; they are rendered separately from verified data.
- You may rephrase, shorten, reorder, restyle or drop what is already there.
- primaryColor must be one of the hex values in "allowedColors". layout must be one of "allowedLayouts". The design may only use the names and values listed below.
- When the request cannot be met within these rules, change nothing and say why in the summary.

${DESIGN_VOCABULARY}

Output:
- summary: one sentence (up to 300 characters) telling the operator what you changed, or why you changed nothing. Write it in the language of the operator's instruction.
- content: the complete revised copy in exactly the shape of "current.content", written in "outputLanguage", with the same length limits: hero.badge 40, hero.headline 90, hero.subheadline 180, hero CTA texts 35 each, about.heading 80, about.body 700, servicesHeading 80, 1-6 services (title 50, description 120, a Lucide icon name), at most 3 trustSignals (metric 20, label 50), offerNotice 100. Use null when the copy should stay as it is.
- primaryColor: the new primary color, or null to keep the current one.
- layout: the new layout, or null to keep the current one. Moving sections or restyling elements is a design change, not a layout change.
- design: the complete new design, starting from "current.design" and keeping every earlier choice the operator did not ask to change; {} removes the custom design; null keeps it as it is. Block text goes in "outputLanguage".

Respond with a raw JSON object only, with no preamble and no markdown, in exactly this shape:
{"summary":string,"content":object|null,"primaryColor":string|null,"layout":string|null,"design":object|null}`;

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;
const LINK_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Every text the operator's visitors would read in the copy (icon names excluded) */
function copyTexts(content: MvpContentOutput): string[] {
  return [
    ...Object.values(content.hero),
    content.about?.heading,
    content.about?.body,
    content.servicesHeading,
    ...content.services.flatMap((service) => [service.title, service.description]),
    ...content.trustSignals.flatMap((signal) => [signal.metric, signal.label]),
    content.offerNotice,
  ].filter((text): text is string => typeof text === 'string' && text.length > 0);
}

/** Key-order independent JSON, so copy read back from Mongo compares equal to the same copy */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b)))
      : field,
  );
}

const normalizeHex = (hex: string): string => hex.trim().toUpperCase();

/**
 * The MVP edit agent (REV-85): turns an operator's free-text change into new copy, a primary color
 * and/or a layout, under the same Strict Grounding as MVP generation. The model's answer is validated
 * with Zod and every fact in it is checked against the original site; a failing answer is an error,
 * never partly applied, and there is no fallback when no provider can be called (REV-45).
 */
export class MvpEditService {
  private readonly llm: LlmClient;
  private readonly contentService: MvpContentService;

  constructor(options: MvpEditServiceOptions = {}) {
    this.llm = new LlmClient(options);
    this.contentService = options.contentService ?? mvpContentService;
  }

  async interpret(input: MvpEditInput): Promise<MvpEditPlan> {
    const unavailable = this.llm.unavailableReason();
    if (!this.llm.provider || unavailable) {
      throw new Error(unavailable ?? 'No LLM provider configured');
    }

    console.log(`[MvpEditService] Interpreting "${input.instruction}" with ${this.llm.modelName}`);
    const raw = await this.llm.complete({
      systemPrompt: MVP_EDIT_SYSTEM_PROMPT,
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
    const customCss = (parsed as { design?: { customCss?: unknown } } | null)?.design?.customCss;
    if (typeof customCss === 'string' && customCss.length > MVP_CUSTOM_CSS_MAX) {
      throw new UnsafeCssError([`it is ${customCss.length} characters long; the limit is ${MVP_CUSTOM_CSS_MAX}`]);
    }
    const result = MvpEditOutputSchema.safeParse(clipToSchemaLimits(parsed, MvpEditOutputSchema));
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`The model's change is not valid (${issue?.path.join('.') || 'answer'}: ${issue?.message}).`);
    }

    return this.toPlan(result.data, input);
  }

  /** Checks the answer against the grounding rules and keeps only what differs from the current MVP */
  toPlan(output: ReturnType<typeof MvpEditOutputSchema.parse>, input: MvpEditInput): MvpEditPlan {
    const plan: MvpEditPlan = { summary: output.summary, changes: [] };

    if (output.content) {
      this.assertGrounded(output.content, input);
      const content = this.contentService.enforceStrictGrounding(output.content, input.grounding);
      if (stableJson(content) !== stableJson(input.current.content)) {
        plan.content = content;
        plan.changes.push('content');
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

    // Only Bento's own layouts are offered; the rebuilt original (REV-110) is never applied by a free-text change
    if (
      output.layout &&
      (BENTO_LAYOUT_VARIANTS as readonly string[]).includes(output.layout) &&
      output.layout !== input.current.layout
    ) {
      plan.layout = output.layout as BentoLayoutVariant;
      plan.changes.push('layout');
    }

    if (output.design) {
      this.assertBlocksGrounded(output.design, input);
      // Checked and normalized here, so only CSS that passes is ever saved (REV-93)
      if (output.design.customCss?.trim()) output.design.customCss = sanitizeMvpCss(output.design.customCss);
      else delete output.design.customCss;
      if (stableJson(output.design) !== stableJson(input.current.design ?? {})) {
        plan.design = output.design;
        plan.changes.push('design');
      }
    }

    return plan;
  }

  /**
   * Every number, email address and link in the new copy must already be in the original site's
   * content or the current copy: the model may restyle facts, never add them (AGENTS.md §3.2.2).
   */
  private assertGrounded(content: MvpContentOutput, input: MvpEditInput): void {
    this.assertTextsGrounded(copyTexts(content), input);
  }

  /** A custom block's text is copy too (REV-92): the same facts check applies */
  private assertBlocksGrounded(design: IMvpDesign, input: MvpEditInput): void {
    const texts = (design.blocks ?? []).flatMap((block) => [
      block.title,
      block.body,
      block.buttonText,
      ...(block.items ?? []).flatMap((item) => [item.title, item.text]),
    ]);
    this.assertTextsGrounded(
      texts.filter((text): text is string => Boolean(text)),
      input,
    );
  }

  private assertTextsGrounded(texts: string[], input: MvpEditInput): void {
    const corpus = [
      this.contentService.buildGroundingCorpus(input.grounding),
      ...copyTexts(input.current.content),
      ...(input.current.design?.blocks ?? []).flatMap((block) => [block.title, block.body ?? '', block.buttonText ?? '']),
      input.grounding.businessName,
      input.grounding.city ?? '',
    ]
      .join(' \n ')
      .toLowerCase();

    const ungrounded = new Set<string>();
    for (const text of texts) {
      for (const number of text.match(NUMBER_PATTERN) ?? []) {
        const variants = [number, number.replace(',', '.'), number.replace('.', ',')];
        if (!variants.some((variant) => corpus.includes(variant))) ungrounded.add(number);
      }
      for (const fact of [...(text.match(EMAIL_PATTERN) ?? []), ...(text.match(LINK_PATTERN) ?? [])]) {
        if (!corpus.includes(fact.toLowerCase())) ungrounded.add(fact);
      }
    }

    if (ungrounded.size > 0) {
      throw new Error(
        `The model's change adds facts that are not on the original site (${[...ungrounded].slice(0, 5).join(', ')}), so it was not applied.`,
      );
    }
  }

  private buildUserPrompt(input: MvpEditInput): string {
    return JSON.stringify(
      {
        instruction: input.instruction,
        ...this.contentService.buildGroundingContext(input.grounding),
        current: {
          content: input.current.content,
          primaryColor: input.current.primaryColor ?? null,
          layout: input.current.layout,
          design: input.current.design ?? {},
        },
        allowedColors: input.colorCandidates,
        allowedLayouts: BENTO_LAYOUT_VARIANTS.map((variant) => ({ id: variant, description: LAYOUT_DESCRIPTIONS[variant] })),
      },
      null,
      2,
    );
  }
}

export const mvpEditService = new MvpEditService();
