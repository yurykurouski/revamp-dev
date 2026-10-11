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

/** A marker the model wrote loosely: spaced, emphasised, or with the JSON on its line */
const MARKER_LIKE = /^[\s*_#`]*=+\s*CHANGES\s*=+[\s*_`]*/i;

/** The page and, after the last marker line that follows `</html>` (else after `</html>` itself), the changes block */
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
  if (at >= 0 && !/<\/html>/i.test(after)) {
    return { page: stripFenceEnds(lines.slice(0, at).join('\n')), block: stripFenceEnds(after) };
  }
  // No exact marker line after the document (JSON on its line, a spaced or bold marker, none at all): whatever follows
  // the last </html> is the block, so a slip in it never leaves text after the page for the checks to reject. A marker
  // inside the document is page text, and the checks see it as the model wrote it
  const text = stripCodeFence(answer).trim();
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (end < 0) return { page: text };
  const rest = text
    .slice(end + '</html>'.length)
    .split('\n')
    .filter((line) => !/^\s*```[a-z]*\s*$/i.test(line))
    .join('\n')
    .replace(MARKER_LIKE, '')
    .trim();
  const page = stripFenceEnds(text.slice(0, end + '</html>'.length));
  return rest ? { page, block: rest } : { page };
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
  return `After </html>, write a line ${MVP_CHANGES_MARKER} and then a JSON array of at most ${MVP_DESIGN_CHANGE_LIMITS.maxEntries} objects {"change": "...", "reason": "..."}, most important first, written in ${language}. Each describes one design change compared with the business's current site (the brief and its screenshots) and why it helps visitors. No numbers of any kind, in digits or in words: no counts, sizes, scores or measurements. No phone numbers, email addresses or links, and no facts about the business. This list is the only text in ${language}: the page keeps the language rule above.`;
}
