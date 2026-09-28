import { MvpContentOutput, MvpEditOutputSchema } from '@revamp/validation';
import { MVP_LAYOUT_VARIANTS, MvpEditChange, MvpLayoutVariant } from '@revamp/shared-types';
import { ClaudeCliRunner } from './claude-cli.js';
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
    layout: MvpLayoutVariant;
  };
  /** The only primary colors the edit may pick */
  colorCandidates: MvpColorCandidate[];
}

/** The change to apply, validated and grounded; only the parts that differ from the current MVP */
export interface MvpEditPlan {
  summary: string;
  content?: MvpContentOutput;
  primaryColor?: string;
  layout?: MvpLayoutVariant;
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

const LAYOUT_DESCRIPTIONS: Record<MvpLayoutVariant, string> = {
  bento: 'a grid of service cards',
  split: 'copy beside a large photo',
  editorial: 'a typographic, text-led page',
  compact: 'a short single-column page',
};

export const MVP_EDIT_SYSTEM_PROMPT = `You are the editor of a generated one-page landing page (MVP) for a local business.
The operator describes, in their own words, a change they want. Apply it to the MVP's current copy, primary color and layout, and change nothing else.

FUNDAMENTAL GROUNDING RULES:
- Every fact (services, products, locations, numbers, years, ratings, prices, staff, awards) must come from "originalSite" or the current copy. Never invent any of them, even when the operator asks for one.
- Never output phone numbers, email addresses, street addresses or links; they are rendered separately from verified data.
- You may rephrase, shorten, reorder, restyle or drop what is already there.
- primaryColor must be one of the hex values in "allowedColors". layout must be one of "allowedLayouts".
- When the request cannot be met within these rules, change nothing and say why in the summary.

Output:
- summary: one sentence (up to 300 characters) telling the operator what you changed, or why you changed nothing. Write it in the language of the operator's instruction.
- content: the complete revised copy in exactly the shape of "current.content", written in "outputLanguage", with the same length limits: hero.badge 40, hero.headline 90, hero.subheadline 180, hero CTA texts 35 each, about.heading 80, about.body 700, servicesHeading 80, 1-6 services (title 50, description 120, a Lucide icon name), at most 3 trustSignals (metric 20, label 50), offerNotice 100. Use null when the copy should stay as it is.
- primaryColor: the new primary color, or null to keep the current one.
- layout: the new layout, or null to keep the current one.

Respond with a raw JSON object only, with no preamble and no markdown, in exactly this shape:
{"summary":string,"content":object|null,"primaryColor":string|null,"layout":string|null}`;

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

    if (output.layout && output.layout !== input.current.layout) {
      plan.layout = output.layout;
      plan.changes.push('layout');
    }

    return plan;
  }

  /**
   * Every number, email address and link in the new copy must already be in the original site's
   * content or the current copy: the model may restyle facts, never add them (AGENTS.md §3.2.2).
   */
  private assertGrounded(content: MvpContentOutput, input: MvpEditInput): void {
    const corpus = [
      this.contentService.buildGroundingCorpus(input.grounding),
      ...copyTexts(input.current.content),
      input.grounding.businessName,
      input.grounding.city ?? '',
    ]
      .join(' \n ')
      .toLowerCase();

    const ungrounded = new Set<string>();
    for (const text of copyTexts(content)) {
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
        },
        allowedColors: input.colorCandidates,
        allowedLayouts: MVP_LAYOUT_VARIANTS.map((variant) => ({ id: variant, description: LAYOUT_DESCRIPTIONS[variant] })),
      },
      null,
      2,
    );
  }
}

export const mvpEditService = new MvpEditService();
