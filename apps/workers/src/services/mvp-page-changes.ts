import type { IMvpDesignChange, OperatorLocale } from '@revamp/shared-types';
import { OPERATOR_LOCALE_NAMES } from '@revamp/shared-types';
import { MVP_DESIGN_CHANGE_LIMITS, MvpDesignChangeSchema } from '@revamp/validation';

// The page model's account of its design changes (REV-162). It writes them after the page, behind a marker line, so the
// page stays one bare HTML document for the checks. Code keeps only the entries that pass the schema; a missing or broken
// block never rejects a page, it only leaves the summary out.

export const MVP_CHANGES_MARKER = '===CHANGES===';

/** The answer without one markdown fence around all of it; anything else around the page is left for the checks */
export function stripCodeFence(text: string): string {
  const match = /^\s*```[a-z]*[ \t]*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return match ? (match[1] ?? '').trim() : text;
}

/** A part of a split answer without the fence line it opens or closes with: the fence may wrap the page, the block or both */
const stripFenceEnds = (text: string) =>
  text
    .trim()
    .replace(/^```[a-z]*[ \t]*\n/i, '')
    .replace(/\n?```$/, '')
    .trim();

/** The page and, after the last marker line that follows `</html>`, the changes block */
export function splitChangesBlock(answer: string): { page: string; block?: string } {
  const lines = answer.split('\n');
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.trim() === MVP_CHANGES_MARKER) {
      at = i;
      break;
    }
  }
  const after = at >= 0 ? lines.slice(at + 1).join('\n') : '';
  // A marker inside the document is page text; the checks see it as the model wrote it
  if (at < 0 || /<\/html>/i.test(after)) return { page: stripCodeFence(answer).trim() };
  return { page: stripFenceEnds(lines.slice(0, at).join('\n')), block: stripFenceEnds(after) };
}

/** The entries that pass `MvpDesignChangeSchema`, at most `maxEntries`; none when the block is missing, broken or all invalid */
export function readDesignChanges(block: string | undefined): { changes?: IMvpDesignChange[]; dropped: number } {
  if (block === undefined) return { dropped: 0 };
  let list: unknown;
  try {
    list = JSON.parse(stripFenceEnds(block));
  } catch {
    return { dropped: 0 };
  }
  if (!Array.isArray(list)) return { dropped: 0 };
  const changes: IMvpDesignChange[] = [];
  let dropped = 0;
  for (const item of list) {
    const parsed = MvpDesignChangeSchema.safeParse(item);
    if (parsed.success && changes.length < MVP_DESIGN_CHANGE_LIMITS.maxEntries) changes.push(parsed.data);
    else dropped++;
  }
  return changes.length ? { changes, dropped } : { dropped };
}

/** What the model is asked to write after the page, in the operator's language; the page keeps its own language rule */
export function changesInstruction(locale: OperatorLocale): string {
  const language = OPERATOR_LOCALE_NAMES[locale];
  return `After </html>, write a line ${MVP_CHANGES_MARKER} and then a JSON array of at most ${MVP_DESIGN_CHANGE_LIMITS.maxEntries} objects {"change": "...", "reason": "..."}, most important first, written in ${language}. Each describes one design change compared with the current site and why it helps visitors. No digits, no phone numbers, email addresses or links, no facts about the business; write numbers in words if you need them. This list is the only text in ${language}: the page keeps the language rule above.`;
}
