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
