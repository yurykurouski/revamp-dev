/**
 * SectionGroupingAgent (REV-113): a vision model groups the page outline's numbered pieces into the
 * header, sections and footer, answering with ids only. Every audit asks it; when it is not set up,
 * fails or answers badly, the rules reading (REV-109) is stored and the failure is recorded (REV-100).
 * The model may group and classify page pieces by id; it never writes copy or markup.
 */
import type { IMeasurementError } from '@revamp/shared-types';
import { rebuildEligibility, SiteGroupingAnswerSchema, type SiteGroupingAnswer } from '@revamp/validation';
import { env } from '../config/env.js';
import { LlmClient, extractJsonObject, resolveDefaultProvider, type LlmProvider, type LlmUsage } from './llm-client.js';
import { findExecutable } from './llm-capabilities.js';
import { checkGrouping, outlinePrompt, readGroupedSections } from './site-grouping.js';
import type { RawLayoutBlock } from './site-layout.service.js';
import type { RawPageOutline, RawSiteSections } from './site-sections.page.js';
import { readSiteSections, type SiteSectionsReading } from './site-sections.service.js';

export const SITE_GROUPING_SYSTEM_PROMPT = `You organise a business's home page into sections. You never write text.

Inputs: screenshots of the desktop page (1440px wide) in order, each with its page range, and an outline:
one line per numbered piece of the page (heading, text, list, links, image, background, embed) with its
font size, bold (b), position (y = px from the top of the page, x) and size, and the start of its text.
"styled" headings are short bold, large or uppercase lines that are not HTML headings. "hidden" pieces are
kept page text that is not shown until clicked (an accordion answer, a tab). "slide=S.N" marks a piece on
slide N of slider S; slides other than the current one sit outside the screenshots (x beyond the page width).

Group the pieces as a visitor sees the page:
- header: the logo image (logo) and the menu and top-bar pieces (pieces).
- sections, in page order: each starts at its heading and holds every piece that belongs to that heading
  until the next section: its text, lists, buttons and the photos shown with it. A photo floated beside or
  between paragraphs belongs to that paragraph's section, never to a separate gallery.
- heading: the section's main title. A short label right above a larger title (a small "O NAS" over
  "Poznaj nasz gabinet") is the eyebrow, and the larger title is the heading.
- a box with its own heading (a "Questions? Write to us" box beside a text, a contact form with a title)
  is its own section, not part of the text next to it.
- items, only for repeated cards or entries (services, people, reviews, questions): each item's title id and pieces.
- a slider (pieces marked slide=S.N) is one section with arrangement slider; its heading is the first slide's
  heading and its pieces are every piece of every slide (the slides become its items).
- a gallery of photos is one section with arrangement gallery; its photos go in its pieces.
- footer: the pieces at the bottom (address, hours, links, copyright).
- kind, one of: services, pricing, gallery, about, team, reviews, faq, contact, map, features, other.
- arrangement, how the section shows its content, one of: banner, media-beside-text, text, card-grid, list,
  accordion, tabs, slider, gallery, embed.

Rules:
- Use only ids from the outline. Use each id at most once in the whole answer: a piece that is a section's
  heading or an item's title is not listed again in pieces.
- Every section needs a heading id: a heading piece, or a text piece of at most 120 characters that reads
  as a title. Never an image, a list, links or a longer text: when a block has no such title, add it to
  the section before it.
- Place every piece that is part of the page, including link lists inside sections (they are the page's
  own copy). Leave a piece out only when it is not content: a second copy of the header menu (for example a
  hidden mobile menu with the same links), a hit counter, an empty spacer.
- Respond with one raw JSON object, no prose, no markdown:
{"header":{"logo":<id>,"pieces":[<id>...]},"sections":[{"heading":<id>,"eyebrow":<id, optional>,"pieces":[<id>...],
"items":[{"title":<id>,"pieces":[<id>...]}] (optional),"kind":"<kind>","arrangement":"<arrangement>"}],"footer":{"pieces":[<id>...]}}`;

const TEMPERATURES = [0.1, 0];
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 120_000;
const ERROR_CHARS = 300;

export type GroupingTile = { data: Buffer; top: number; bottom: number };
export type GroupingResult =
  | { answer: SiteGroupingAnswer; modelUsed: string; usage?: LlmUsage }
  | { error: string; modelUsed: string; usage?: LlmUsage };

/** VISION_LLM_PROVIDER, else the copywriting default, else the local Claude Code CLI when it is installed */
export function groupingProvider(): LlmProvider | undefined {
  return env.VISION_LLM_PROVIDER ?? resolveDefaultProvider() ?? (findExecutable(env.CLAUDE_CLI_PATH) ? 'claude-cli' : undefined);
}

const addUsage = (a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined =>
  !a ? b : !b ? a : { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, totalTokens: a.totalTokens + b.totalTokens };

export class SiteGroupingService {
  private readonly client: LlmClient;

  constructor(options: { client?: LlmClient } = {}) {
    this.client = options.client ?? new LlmClient({ provider: groupingProvider() });
  }

  unavailableReason(): string | undefined {
    const reason = this.client.unavailableReason();
    return reason ? `No vision model for the section grouping: ${reason}` : undefined;
  }

  async group(input: { outline: RawPageOutline; tiles: GroupingTile[]; url: string; niche?: string }): Promise<GroupingResult> {
    const userPrompt = `Page: ${input.url}\nBusiness niche: ${input.niche ?? 'not specified'}\n\n${outlinePrompt(input.outline, input.tiles)}`;
    const images = input.tiles.map((t) => ({ mediaType: 'image/webp' as const, data: t.data }));
    let usage: LlmUsage | undefined;
    let last = 'unknown error';
    let rejected: string | undefined;
    for (const temperature of TEMPERATURES) {
      try {
        const res = await this.client.completeWithUsage({
          systemPrompt: SITE_GROUPING_SYSTEM_PROMPT,
          // A second attempt is told what was wrong with the first answer
          userPrompt: rejected ? `${userPrompt}\n\nYour previous answer was rejected: ${rejected}. Answer again, following the rules.` : userPrompt,
          images,
          temperature,
          maxTokens: MAX_TOKENS,
          timeoutMs: TIMEOUT_MS,
        });
        usage = addUsage(usage, res.usage);
        const parsed = SiteGroupingAnswerSchema.safeParse(extractJsonObject(res.text));
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          last = `schema: ${issue?.path.join('.')} ${issue?.message}`;
          rejected = last;
          continue;
        }
        const problems = checkGrouping(parsed.data, input.outline);
        if (problems.length) {
          last = problems.slice(0, 5).join('; ');
          rejected = last;
          continue;
        }
        return { answer: parsed.data, modelUsed: this.client.modelName, usage };
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      error: `The vision model gave no valid grouping in ${TEMPERATURES.length} attempts (last error: ${last})`.slice(0, ERROR_CHARS),
      modelUsed: this.client.modelName,
      usage,
    };
  }
}

export const siteGroupingService = new SiteGroupingService();

export interface PageSectionsResult {
  reading: SiteSectionsReading;
  measurementError?: IMeasurementError;
  modelUsed?: string;
  usage?: LlmUsage;
  /** The model's ids-only answer when it passed the checks, stored or not; for the recorder script */
  answer?: SiteGroupingAnswer;
}

/**
 * The page's sections as the audit stores them: the model's grouping when it is valid and does not
 * lose a rebuild the rules reading would allow, else the rules reading with the failure recorded.
 */
export async function readPageSections(input: {
  raw?: RawSiteSections;
  rawError?: string;
  layoutBlocks: RawLayoutBlock[];
  tiles: GroupingTile[];
  url: string;
  niche?: string;
  grouping?: SiteGroupingService;
}): Promise<PageSectionsResult> {
  const grouping = input.grouping ?? siteGroupingService;
  const rules: SiteSectionsReading = input.raw ? readSiteSections(input.raw, input.layoutBlocks) : { error: input.rawError ?? 'No section facts' };
  const fail = (message: string, extra: Partial<PageSectionsResult> = {}): PageSectionsResult => ({
    reading: rules,
    measurementError: { measurement: 'sections', message: message.slice(0, ERROR_CHARS) },
    ...extra,
  });
  if (!input.raw?.outline) return fail('No page outline');
  const unavailable = grouping.unavailableReason();
  if (unavailable) return fail(unavailable);
  const result = await grouping.group({ outline: input.raw.outline, tiles: input.tiles, url: input.url, niche: input.niche });
  if ('error' in result) return fail(result.error, { modelUsed: result.modelUsed, usage: result.usage });
  const meta = { modelUsed: result.modelUsed, usage: result.usage, answer: result.answer };
  let llm: SiteSectionsReading;
  try {
    llm = readGroupedSections(input.raw, result.answer);
  } catch (err) {
    // The grouping never fails the audit
    llm = { error: err instanceof Error ? err.message : String(err) };
  }
  if (llm.error) return fail(`The model's grouping could not be read: ${llm.error}`, meta);
  const llmGate = rebuildEligibility({ siteSections: llm.sections });
  const rulesGate = rules.sections ? rebuildEligibility({ siteSections: rules.sections }) : undefined;
  if (!llmGate.ok && rulesGate?.ok) {
    return fail(`The model's reading fails ${llmGate.reason} (${llmGate.facts.join(', ')}) where the rules reading passes`, meta);
  }
  return { reading: llm, ...meta };
}
