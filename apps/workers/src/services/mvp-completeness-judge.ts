/**
 * LLM judge for the MVP completeness check (REV-37).
 *
 * The model compares the original site's data with the rendered MVP and quotes the MVP text behind
 * each verdict. This module only builds the prompt, calls the model and validates the answer's
 * shape; MvpCompletenessService verifies every quote and computes the score in code.
 */
import { CompletenessJudgeOutput, CompletenessJudgeOutputSchema } from '@revamp/validation';
import type { CompletenessField } from '@revamp/shared-types';
import { LlmClient, extractJsonObject } from './llm-client.js';

/** The MVP as the judge sees it */
export interface JudgeMvpView {
  text: string;
  telLinks: string[];
  mailtoLinks: string[];
  links: string[];
  imageSources: string[];
}

/** One field the original site has, as the judge sees it */
export interface JudgeSourceField {
  field: CompletenessField;
  /** A single value, or the list of items for services and social links */
  value?: string;
  items?: string[];
}

/** Characters of MVP text sent to the model; the rest is cut */
export const JUDGE_MVP_TEXT_BUDGET = 12000;
const JUDGE_LIST_BUDGET = 40;
const JUDGE_VALUE_BUDGET = 400;

export const COMPLETENESS_JUDGE_SYSTEM_PROMPT = `You are a meticulous QA reviewer. A redesigned landing page ("MVP") was generated for a local business from its original website. Check whether the MVP still shows the business's own data from the original site.

You get JSON with:
- "source": the fields the original site has. Each has a "value" or a list of "items".
- "mvp": the MVP's visible text, its tel: and mailto: links, other links and image URLs.

For EVERY field in "source", return one verdict:
- "present": the MVP shows the same information. Wording, formatting, abbreviations, language and order may differ ("Mon–Fri 9–18" = "Monday to Friday 9:00-18:00"; "Dental implants" = "Implantology").
- "altered": the MVP shows this kind of information but with different content (another phone number, other hours, another street).
- "missing": the MVP doesn't show it.

Rules:
- "mvpQuote" must be copied EXACTLY, character for character, from the MVP text, a link or an image URL. Give it for every "present" or "altered" verdict. Never paraphrase or invent a quote. If you can't quote it, the verdict is "missing".
- phone: "present" only when the same number is shown as text AND a tel: link calls it. Quote the number as shown in the text.
- email: "present" only when the same address is shown as text AND a mailto: link uses it. Quote the address as shown in the text.
- services and socialLinks: judge each source item in "items" separately ({"value": <the source item, copied>, "found": true|false, "mvpQuote": ...}). "status" is "present" only when every item is found.
- logo: quote the matching image URL.
- images and testimonials: "present" when AT LEAST ONE source item is reused (quote one of them); "missing" when none is. Never use "altered" for them.
- Also list, in "unsourced", every phone number, email address or street address the MVP shows that is NOT in the source data. Quote it exactly. Leave the list empty when there are none.
- Never output numbers, scores or percentages.

Return ONLY this JSON object, with no other text:
{"fields":[{"field":"<field>","status":"present|missing|altered","mvpQuote":"<exact quote>","reason":"<short reason>","items":[{"value":"<item>","found":true,"mvpQuote":"<exact quote>"}]}],"unsourced":[{"field":"phone|email|address","mvpQuote":"<exact quote>"}]}`;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

export function buildJudgeUserPrompt(source: JudgeSourceField[], mvp: JudgeMvpView): string {
  return JSON.stringify(
    {
      source: source.map((f) => ({
        field: f.field,
        ...(f.value !== undefined ? { value: clip(f.value, JUDGE_VALUE_BUDGET) } : {}),
        ...(f.items ? { items: f.items.slice(0, 20).map((i) => clip(i, JUDGE_VALUE_BUDGET)) } : {}),
      })),
      mvp: {
        text: clip(mvp.text, JUDGE_MVP_TEXT_BUDGET),
        telLinks: mvp.telLinks.slice(0, JUDGE_LIST_BUDGET),
        mailtoLinks: mvp.mailtoLinks.slice(0, JUDGE_LIST_BUDGET),
        links: mvp.links.slice(0, JUDGE_LIST_BUDGET),
        imageSources: mvp.imageSources.slice(0, JUDGE_LIST_BUDGET),
      },
    },
    null,
    2,
  );
}

export interface CompletenessJudgeOptions {
  client?: LlmClient;
  timeoutMs: number;
  /** Tries in total when the answer isn't valid JSON of the right shape */
  attempts?: number;
}

export class CompletenessJudge {
  private readonly client: LlmClient;
  private readonly timeoutMs: number;
  private readonly attempts: number;

  constructor(options: CompletenessJudgeOptions) {
    this.client = options.client ?? new LlmClient();
    this.timeoutMs = options.timeoutMs;
    this.attempts = options.attempts ?? 2;
  }

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  get modelName(): string {
    return this.client.modelName;
  }

  /**
   * Asks the model for verdicts. Throws on timeout, provider errors or an answer that is still
   * invalid after the retries; the caller then falls back to the code-only comparison.
   */
  async judge(source: JudgeSourceField[], mvp: JudgeMvpView): Promise<CompletenessJudgeOutput> {
    const userPrompt = buildJudgeUserPrompt(source, mvp);
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const raw = await withTimeout(
        this.client.complete({
          systemPrompt: COMPLETENESS_JUDGE_SYSTEM_PROMPT,
          userPrompt,
          temperature: 0,
          maxTokens: 3000,
          timeoutMs: this.timeoutMs,
        }),
        this.timeoutMs,
      );
      try {
        return CompletenessJudgeOutputSchema.parse(extractJsonObject(raw));
      } catch (error) {
        // Only a malformed answer is retried; timeouts and provider errors propagate
        lastError =
          // A Zod error (duck-typed: @revamp/validation may bundle its own zod) as "path: message"
          isZodError(error)
            ? new Error(error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
            : error instanceof Error
              ? error
              : new Error(String(error));
        console.warn(`[CompletenessJudge] Attempt ${attempt}/${this.attempts}: invalid answer: ${lastError.message.slice(0, 200)}`);
      }
    }
    throw new Error(`LLM answer invalid: ${lastError?.message.slice(0, 200) ?? 'unknown'}`);
  }
}

function isZodError(error: unknown): error is { issues: Array<{ path: Array<string | number>; message: string }> } {
  return typeof error === 'object' && error !== null && Array.isArray((error as { issues?: unknown }).issues);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LLM timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
