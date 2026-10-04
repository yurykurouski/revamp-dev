/**
 * Recorded model answers (REV-113): the outline of a real page and the vision model's ids-only answer for it,
 * saved by `npx tsx scripts/read_site_sections.ts --record <dir> <url...>`. No test calls a live model.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { rebuildEligibility, type SiteGroupingAnswer } from '@revamp/validation';
import type { ISiteSections } from '@revamp/shared-types';
import type { RawSiteSections } from '../site-sections.page.js';
import { readGroupedSections } from '../site-grouping.js';

const load = (name: string): { raw: RawSiteSections; answer: SiteGroupingAnswer } => {
  const r = JSON.parse(readFileSync(new URL(`./fixtures/grouping/${name}.json`, import.meta.url), 'utf8'));
  return {
    raw: { viewportWidth: r.viewportWidth, viewportHeight: r.viewportHeight, blocks: [], typography: r.typography, pageChars: r.pageChars, uncaptured: [], outline: r.outline },
    answer: r.answer,
  };
};
const body = (s: ISiteSections) => s.sections.filter((x) => x.role === 'hero' || x.role === 'content');

describe('recorded model answers (REV-113)', () => {
  it('anident.pl: headed sections, header with logo and nav, footer, photos beside their text, passes the rebuild gate', () => {
    const { raw, answer } = load('anident');
    const read = readGroupedSections(raw, answer).sections!;
    expect(read.source).toBe('llm');
    expect(body(read).length).toBeGreaterThanOrEqual(7);
    expect(body(read).every((s) => s.intro.heading)).toBe(true);
    const header = read.sections.find((s) => s.role === 'header')!;
    expect(header.images.length).toBeGreaterThan(0);
    expect(header.intro.links.length).toBeGreaterThanOrEqual(4);
    expect(read.sections.at(-1)!.role).toBe('footer');
    expect(rebuildEligibility({ siteSections: read })).toEqual({ ok: true });
    expect(body(read).filter((s) => s.images.length > 0 && s.intro.text.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(body(read).some((s) => s.arrangement === 'gallery')).toBe(false);
  });

  // REV-122: the model names the bullet list by its one id; whichever arrangement it answers, the lines are the items
  describe.each([
    ['anident', 'list'],
    ['anident-beside', 'media-beside-text'],
  ])('anident.pl "Dlaczego warto" (%s: the model answered %s)', (name, answered) => {
    const { raw, answer } = load(name);
    const read = readGroupedSections(raw, answer).sections!;
    const why = read.sections.find((s) => s.intro.heading?.startsWith('DLACZEGO WARTO'))!;

    it('reads the list as 24 items with its intro, closing paragraph and photo, not as a wall of paragraphs', () => {
      expect(answer.sections.find((s) => s.heading === 53)!.arrangement).toBe(answered);
      expect(why.arrangement).toBe(answered);
      expect(why.items).toHaveLength(24);
      expect(why.items[0]!.text).toEqual(['najwyższa jakość usług']);
      expect(why.items.every((i) => i.text.length === 1)).toBe(true);
      expect(why.intro.text).toEqual(['Ze względu na szereg naszych atutów:']);
      expect(why.extra).toHaveLength(1);
      expect(why.images).toHaveLength(1);
    });

    it('keeps every piece of text: coverage 0.997 and nothing unassigned', () => {
      expect(read.coverage.ratio).toBeGreaterThanOrEqual(0.997);
      expect(read.skipped.filter((s) => s.reason === 'unassigned')).toEqual([]);
      expect(rebuildEligibility({ siteSections: read })).toEqual({ ok: true });
    });
  });

  it('falcodent.pl: not worse than the rules reading (11 headed sections, slider hero, gate passes)', () => {
    const { raw, answer } = load('falcodent');
    const read = readGroupedSections(raw, answer).sections!;
    expect(body(read).filter((s) => s.intro.heading).length).toBeGreaterThanOrEqual(11);
    expect(rebuildEligibility({ siteSections: read })).toEqual({ ok: true });
    // The rules reading's coverage was 0.97
    expect(read.coverage.ratio).toBeGreaterThanOrEqual(0.94);
    const hero = read.sections.find((s) => s.role === 'hero')!;
    expect(hero.arrangement).toBe('slider');
    expect(hero.items.filter((i) => i.backgroundImage).length).toBeGreaterThanOrEqual(4);
  });
});
