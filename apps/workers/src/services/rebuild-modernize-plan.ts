import type { IRebuildEditAnswer, IRebuildModernizeAnswer, IRebuildSectionEdit, ISiteSection } from '@revamp/shared-types';
import { SITE_SECTIONS_LIMITS, cardRun, rebuildItemsFitCards } from '@revamp/validation';

// The modernize layer under the operator's edit (REV-114): how the two are merged, and the card shape a
// section's paragraphs take. Pure; the planner applies the result.

export type EditSource = 'modernize' | 'edit';

/** Cards from paragraphs: 3 columns, or 2 when the longest carded paragraph is over this */
export const CARD_WIDE_CHARS = 160;
/** Cards the modernize layer makes have a surface of their own when the original items had none: a thin border */
export const CARD_SURFACE = { border: true } as const;

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
 * Cards get `CARD_SURFACE` unless the original items had a style of their own; a list keeps its items' style.
 */
export function arrangedSection(section: ISiteSection, arrangement: IRebuildSectionEdit['arrangement']): ISiteSection {
  if (!arrangement || arrangement === section.arrangement) return section;
  if (section.arrangement === 'list' && arrangement === 'card-grid') {
    return section.items.length >= 3 ? { ...section, arrangement, itemStyle: section.itemStyle ?? { ...CARD_SURFACE } } : section;
  }
  // Items read beside a photo (REV-122): the cards take the width, two columns for long items, and the photo follows
  if (section.arrangement === 'media-beside-text' && arrangement === 'card-grid') {
    if (!rebuildItemsFitCards(section)) return section;
    const longest = Math.max(...section.items.map((i) => i.text.join(' ').length));
    return { ...section, arrangement, mediaSide: undefined, columns: longest > CARD_WIDE_CHARS ? 2 : 3, itemStyle: section.itemStyle ?? { ...CARD_SURFACE } };
  }
  if (section.arrangement !== 'text') return section;
  const paragraphs = section.intro.text;
  const run = cardRun(paragraphs);
  if (!run) return section;
  const carded = paragraphs.slice(run.start, run.end);
  const after = paragraphs.slice(run.end);
  // The paragraphs after the cards take an extra block; with the extra blocks full one would be lost, so it does not fit
  if (after.length && section.extra.length >= SITE_SECTIONS_LIMITS.extra) return section;
  // The same for the items: cards past the cap would be cut, so it does not fit
  if (carded.length + section.items.length > SITE_SECTIONS_LIMITS.items) return section;
  const longest = Math.max(...carded.map((p) => p.length));
  return {
    ...section,
    arrangement,
    ...(arrangement === 'card-grid' ? { columns: longest > CARD_WIDE_CHARS ? 2 : 3, itemStyle: section.itemStyle ?? { ...CARD_SURFACE } } : {}),
    intro: { ...section.intro, text: paragraphs.slice(0, run.start) },
    items: [...carded.map((p) => ({ text: [p], links: [] })), ...section.items],
    extra: [...(after.length ? [{ type: 'text' as const, text: after }] : []), ...section.extra],
  };
}
