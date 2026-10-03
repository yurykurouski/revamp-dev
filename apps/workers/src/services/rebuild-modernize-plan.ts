import type { IRebuildEditAnswer, IRebuildModernizeAnswer, IRebuildSectionEdit, ISiteSection } from '@revamp/shared-types';
import { cardRun } from '@revamp/validation';

// The modernize layer under the operator's edit (REV-114): how the two are merged, and the card shape a
// section's paragraphs take. Pure; the planner applies the result.

export type EditSource = 'modernize' | 'edit';

/** Cards from paragraphs: 3 columns, or 2 when the longest carded paragraph is over this */
export const CARD_WIDE_CHARS = 160;

const defined = <T extends object>(value: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
const hasAny = (value: object) => Object.keys(value).length > 0;

/**
 * The edit the planner applies: the operator's value wins per section key, per theme key and for `hero` as a
 * whole; the operator's order, hidden, dropped and CSS are used as they are. `from(path)` tells where a value
 * came from (`sections.<id>.<key>`, `theme.<key>` or `hero`), which decides its code's prefix.
 */
export function mergeRebuildEdits(
  modernize: IRebuildModernizeAnswer | undefined,
  edit: IRebuildEditAnswer | undefined,
): { edit?: IRebuildEditAnswer; from: (path: string) => EditSource } {
  if (!modernize) return { ...(edit ? { edit } : {}), from: () => 'edit' };

  const sections: Record<string, IRebuildSectionEdit> = {};
  for (const id of new Set([...Object.keys(modernize.sections ?? {}), ...Object.keys(edit?.sections ?? {})])) {
    const merged = { ...defined(modernize.sections?.[id]), ...defined(edit?.sections?.[id]) };
    if (hasAny(merged)) sections[id] = merged;
  }
  const theme = { ...defined(modernize.theme), ...defined(edit?.theme) };
  const hero = edit?.hero ?? modernize.hero;
  const merged: IRebuildEditAnswer = {
    ...(edit ?? {}),
    ...(hasAny(sections) ? { sections } : {}),
    ...(hasAny(theme) ? { theme } : {}),
    ...(hero ? { hero } : {}),
  };

  const from = (path: string): EditSource => {
    const [head, id, key] = path.split('.');
    if (head === 'hero') return edit?.hero ? 'edit' : modernize.hero ? 'modernize' : 'edit';
    const pick = (layer: IRebuildEditAnswer | IRebuildModernizeAnswer | undefined): unknown =>
      head === 'theme'
        ? (layer?.theme as Record<string, unknown> | undefined)?.[id ?? '']
        : (layer?.sections?.[id ?? ''] as Record<string, unknown> | undefined)?.[key ?? ''];
    if (pick(edit) !== undefined) return 'edit';
    return pick(modernize) !== undefined ? 'modernize' : 'edit';
  };
  return { edit: merged, from };
}

/**
 * The section shown as cards or a list (REV-114), or the section itself when it does not fit. A `text` section's
 * run of short paragraphs (`cardRun`) becomes one item each; longer paragraphs before it stay as intro text and
 * those after it follow the cards as a text block, so the page's order is kept. A `list` becomes a card grid as is.
 */
export function arrangedSection(section: ISiteSection, arrangement: IRebuildSectionEdit['arrangement']): ISiteSection {
  if (!arrangement || arrangement === section.arrangement) return section;
  if (section.arrangement === 'list' && arrangement === 'card-grid') {
    return section.items.length >= 3 ? { ...section, arrangement } : section;
  }
  if (section.arrangement !== 'text') return section;
  const paragraphs = section.intro.text;
  const run = cardRun(paragraphs);
  if (!run) return section;
  const carded = paragraphs.slice(run.start, run.end);
  const after = paragraphs.slice(run.end);
  const longest = Math.max(...carded.map((p) => p.length));
  return {
    ...section,
    arrangement,
    ...(arrangement === 'card-grid' ? { columns: longest > CARD_WIDE_CHARS ? 2 : 3 } : {}),
    intro: { ...section.intro, text: paragraphs.slice(0, run.start) },
    items: [...carded.map((p) => ({ text: [p], links: [] })), ...section.items],
    extra: [...(after.length ? [{ type: 'text' as const, text: after }] : []), ...section.extra],
  };
}
