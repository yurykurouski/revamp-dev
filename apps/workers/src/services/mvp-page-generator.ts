import type { IMvpGroundingFlag, IMvpPageProblem, IMvpSourceBrief, IMvpTheme, MvpPageFailure } from '@revamp/shared-types';
import { MVP_THEME_VARS } from '@revamp/shared-types';
import { MvpSourceBriefSchema } from '@revamp/validation';
import { env } from '../config/env.js';
import { ImageService } from './image.service.js';
import { LlmClient, resolveDefaultProvider, type LlmImage, type LlmProvider, type LlmUsage } from './llm-client.js';
import { findExecutable } from './llm-capabilities.js';
import { checkMvpGrounding } from './mvp-grounding.js';
import { checkMvpPage } from './mvp-page-check.js';

// The model designs the MVP page (REV-137): it reads the code-built brief and the current site's screenshot and writes
// one HTML document. The REV-136 checks decide whether it is accepted; a rejected answer is retried once, told every
// reason. Contacts are never in the prompt: the model writes placeholders and code fills them (`finishMvpPage`).

const themeVars = Object.values(MVP_THEME_VARS).join(', ');

export const MVP_PAGE_SYSTEM_PROMPT = `You redesign a small business's home page as one modern, responsive web page. You decide the layout,
the sections, their order and the visual style freely: this is a redesign, not a copy of the current page.

Inputs: a brief (JSON) with the business, its language, its services, the current site's own copy, its brand colors
and fonts, its logo and its images; and screenshots of the current home page, when there are any. Keep the brand
recognizable (logo, colors) and fix what looks dated or is hard to use.

Copy:
- Write only from the brief: copy, services, business. Reword lightly or use synonyms; you may shorten, merge and
  reorder, and write short labels (buttons, menu items, section titles) from the same content.
- never add facts: no numbers, years, prices, ratings, review counts, awards, certifications, names, places,
  guarantees or testimonials that are not in the brief.
- Write in the brief's language.

Contacts and booking:
- Never write a phone number, email address or street address. Write the placeholders the brief lists instead, in
  text (Call us: {{phone}}) or as a whole link target (<a href="{{phone}}">{{phone}}</a>, href="{{email}}",
  href="{{address}}" for a map link). Use only the placeholders the brief lists, exactly as written, lowercase, no spaces.
- Every call to action for an appointment or contact links to href="{{booking}}". Do not write a form and never use
  id="booking": the booking form is added below your page for you.

Theme:
- Declare these variables in :root and use them for every color and font on the page: ${themeVars}.
  Start from the brand colors and keep text readable (WCAG AA contrast).
- Fonts: Google Fonts through <link rel="stylesheet" href="https://fonts.googleapis.com/..."> (and a preconnect to
  https://fonts.gstatic.com) are allowed; @import and @font-face are not.

Allowed and forbidden:
- Use plain HTML content elements (header, nav, main, section, article, aside, footer, div, span, p, h1-h6, a, ul,
  ol, li, figure, figcaption, blockquote, img, picture, table, details, summary, button), one inline <style>, style
  attributes, and inline SVG icons made of shapes (svg, g, path, circle, rect, line, polyline, polygon, ellipse, text,
  defs, linearGradient, radialGradient, stop, use with href="#id").
- Images: only these images: the URLs in the brief's "images" and "brand.logoUrl", in <img> or CSS url(), written
  exactly. No other image, no stock photo, no data: URL.
- No <script>, no event attributes (onclick...), no javascript: links, no forms or inputs, no iframes, video or audio,
  no <template>, no <noscript>, no <meta http-equiv>, no comments containing markup, no other external resources.

Structure:
- Exactly one <h1>. <html lang="..."> is the brief's language (English when the brief has none).
- Use header, main and footer landmarks. Mobile first: no horizontal scroll at 360px wide; a menu that needs to
  collapse may simply wrap.

Answer with exactly one complete HTML document, from <!DOCTYPE html> to </html>: no prose, no markdown fence.`;

/** The model call the generator needs; tests pass a stub replaying recorded answers */
export type PageLlm = Pick<LlmClient, 'completeWithUsage' | 'unavailableReason' | 'modelName' | 'provider'>;

/** First call: room for a new design; the retry should fix the rejected page, not reinvent it */
const TEMPERATURES = [0.7, 0.3];
const MAX_TOKENS = 32_000;
const TIMEOUT_MS = 300_000;
const MAX_TILES = 3;
const MESSAGE_CHARS = 500;

/** The vision model for the page: VISION_LLM_PROVIDER, else the copywriting default, else the local CLI when found */
export function pageProvider(): LlmProvider | undefined {
  return env.VISION_LLM_PROVIDER ?? resolveDefaultProvider() ?? (findExecutable(env.CLAUDE_CLI_PATH) ? 'claude-cli' : undefined);
}

/** The answer without one markdown fence around all of it; anything else around the page is left for the checks */
export function stripCodeFence(text: string): string {
  const match = /^\s*```[a-z]*[ \t]*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return match ? (match[1] ?? '').trim() : text;
}

export interface MvpPageInput {
  brief: IMvpSourceBrief;
  /** The audit's full-page desktop capture (PNG); the call is text-only without it */
  screenshot?: Buffer;
}

export interface MvpPageChangeInput extends MvpPageInput {
  /** The raw page as stored (placeholders unfilled) */
  currentPage: string;
  /** The operator's change, in their words */
  instruction: string;
}

export type MvpPageResult =
  | {
      ok: true;
      page: string;
      theme: IMvpTheme;
      grounding: IMvpGroundingFlag[];
      attempts: number;
      modelUsed: string;
      provider?: LlmProvider;
      usage?: LlmUsage;
    }
  | {
      ok: false;
      reason: MvpPageFailure;
      message: string;
      problems?: IMvpPageProblem[];
      modelUsed: string;
      provider?: LlmProvider;
      usage?: LlmUsage;
    };

const addUsage = (a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined =>
  !a ? b : !b ? a : { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, totalTokens: a.totalTokens + b.totalTokens };

async function screenshotImages(png: Buffer | undefined): Promise<LlmImage[]> {
  if (!png) return [];
  try {
    const tiles = await ImageService.tilesForVision(png, { maxTiles: MAX_TILES });
    return tiles.map((tile) => ({ mediaType: 'image/webp' as const, data: tile.data }));
  } catch (error) {
    // A capture that cannot be read leaves the model the brief alone; it never fails the generation
    console.warn(`[MvpPageGenerator] Screenshot left out: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export class MvpPageGenerator {
  private readonly client: PageLlm;

  constructor(options: { provider?: LlmProvider; model?: string; client?: PageLlm } = {}) {
    this.client = options.client ?? new LlmClient({ provider: options.provider ?? pageProvider(), model: options.model });
  }

  unavailableReason(): string | undefined {
    const reason = this.client.unavailableReason();
    return reason ? `No model to design the page: ${reason}` : undefined;
  }

  generate(input: MvpPageInput): Promise<MvpPageResult> {
    return this.run(input, '');
  }

  change(input: MvpPageChangeInput): Promise<MvpPageResult> {
    const task = `\n\nCurrent page:\n${input.currentPage.trim()}\n\nOperator's change: ${input.instruction.trim()}\nReturn the whole page with the change applied; keep everything else as it is.`;
    return this.run(input, task);
  }

  private async run(input: MvpPageInput, task: string): Promise<MvpPageResult> {
    // The brief is validated here, so a caller can never put more (contact values) into the prompt
    const brief = MvpSourceBriefSchema.parse(input.brief) as IMvpSourceBrief;
    const base = { modelUsed: this.client.modelName, provider: this.client.provider };
    const unavailable = this.unavailableReason();
    if (unavailable) return { ok: false, reason: 'not_configured', message: unavailable, ...base };

    const images = await screenshotImages(input.screenshot);
    const placeholders = brief.placeholders.map((name) => `{{${name}}}`).join(', ');
    const userPrompt =
      `Brief (JSON):\n${JSON.stringify(brief)}\n\nPlaceholders you may use: ${placeholders}.\n` +
      (images.length ? `${images.length} screenshots of the current home page follow, top to bottom.` : 'No screenshot of the current page is available.') +
      task;

    let usage: LlmUsage | undefined;
    let rejected: IMvpPageProblem[] | undefined;
    let lastError = 'unknown error';
    for (const [i, temperature] of TEMPERATURES.entries()) {
      const retry = rejected
        ? `\n\nYour previous answer was rejected:\n${rejected.map((p) => `- ${p.code}: ${p.message}`).join('\n')}\nAnswer again with the whole page, fixing all of these.`
        : '';
      let text: string;
      try {
        const res = await this.client.completeWithUsage({
          systemPrompt: MVP_PAGE_SYSTEM_PROMPT,
          userPrompt: userPrompt + retry,
          images,
          temperature,
          maxTokens: MAX_TOKENS,
          timeoutMs: TIMEOUT_MS,
        });
        usage = addUsage(usage, res.usage);
        text = res.text;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }
      const page = stripCodeFence(text).trim();
      const check = checkMvpPage(page, brief);
      if (check.ok && check.theme) {
        return { ok: true, page, theme: check.theme, grounding: checkMvpGrounding(page, brief), attempts: i + 1, ...base, usage };
      }
      rejected = check.problems;
    }

    // A rejected answer makes the run invalid_page even when the other call failed: the model was reached
    if (rejected) {
      const message = `The model's page was rejected twice: ${rejected.map((p) => `${p.code}: ${p.message}`).join('; ')}`;
      return { ok: false, reason: 'invalid_page', message: message.slice(0, MESSAGE_CHARS), problems: rejected, ...base, usage };
    }
    return { ok: false, reason: 'call_failed', message: `The model could not be reached: ${lastError}`.slice(0, MESSAGE_CHARS), ...base, usage };
  }
}

export const mvpPageGenerator = new MvpPageGenerator();
