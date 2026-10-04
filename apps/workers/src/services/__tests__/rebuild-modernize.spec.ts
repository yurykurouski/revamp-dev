import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import type { IAudit, IRebuildModernize, ISiteSection, ISiteSections } from '@revamp/shared-types';
import { REBUILD_BANNER_MIN_WIDTH, RebuildModernizeAnswerSchema, checkRebuildEdit } from '@revamp/validation';
import { readGroupedSections } from '../site-grouping.js';
import { defaultModernDesign, modernizeForAudit } from '../rebuild-modernize.js';

const load = (name: string): ISiteSections => {
  const r = JSON.parse(readFileSync(new URL(`./fixtures/grouping/${name}.json`, import.meta.url), 'utf8'));
  return readGroupedSections(
    { viewportWidth: r.viewportWidth, viewportHeight: r.viewportHeight, blocks: [], typography: r.typography, pageChars: r.pageChars, uncaptured: [], outline: r.outline },
    r.answer,
  ).sections!;
};

describe('defaultModernDesign (REV-114)', () => {
  const read = load('anident');
  const design = defaultModernDesign(read);

  it('opens the page with the first photo wide enough, as a split', () => {
    expect(design.hero).toEqual({ photo: 's-2.m0', style: 'split' });
  });

  it('shows the bullet list as cards (REV-122: read as a list of 24 items)', () => {
    expect(design.sections?.['s-9']?.arrangement).toBe('card-grid');
  });

  it('shows the bullet list read beside its photo as cards, with no column fill or side (REV-122)', () => {
    const beside = load('anident-beside');
    const why = beside.sections.find((s) => s.intro.heading?.startsWith('DLACZEGO WARTO'))!;
    expect(why).toMatchObject({ arrangement: 'media-beside-text' });
    const d = defaultModernDesign(beside);
    expect(d.sections?.[`s-${why.index}`]).toMatchObject({ arrangement: 'card-grid' });
    expect(d.sections?.[`s-${why.index}`]?.media).toBeUndefined();
    expect(d.sections?.[`s-${why.index}`]?.mediaSide).toBeUndefined();
    expect(checkRebuildEdit(d, beside)).toEqual({ ok: true });
  });

  it('alternates the photo side and fills the column, skipping the section whose photo moved to the hero', () => {
    expect(design.sections?.['s-2']?.mediaSide).toBeUndefined();
    expect(design.sections?.['s-2']?.media).toBeUndefined();
    const sided = Object.entries(design.sections ?? {}).filter(([, v]) => v.mediaSide).map(([id, v]) => [id, v.mediaSide, v.media]);
    expect(sided.slice(0, 3)).toEqual([['s-3', 'right', 'fill'], ['s-4', 'left', 'fill'], ['s-5', 'right', 'fill']]);
  });

  it('alternates backgrounds from the first content section after the hero, never on the hero', () => {
    expect(design.sections?.['s-1']?.background).toBeUndefined();
    expect(design.sections?.['s-2']?.background).toBe('page');
    expect(design.sections?.['s-3']?.background).toBe('tinted');
    expect(design.sections?.['s-4']?.background).toBe('page');
  });

  it('aligns left everywhere and sets the theme (Times body gets the humanist font)', () => {
    const main = read.sections.filter((s) => s.role === 'hero' || s.role === 'content');
    for (const s of main) expect(design.sections?.[`s-${s.index}`]?.align).toBe('left');
    expect(design.theme).toEqual({ typeScale: 'modern', density: 'comfortable', corners: 'soft', font: 'humanist' });
  });

  it('passes the schema and the page check', () => {
    expect(RebuildModernizeAnswerSchema.safeParse(design).success).toBe(true);
    expect(checkRebuildEdit(design, read)).toEqual({ ok: true });
  });

  it('falcodent: no hero photo for a slider, sharp corners, the site font, no background on photo sections', () => {
    const falco = load('falcodent');
    const d = defaultModernDesign(falco);
    expect(d.hero).toBeUndefined();
    expect(d.theme?.corners).toBe('sharp');
    expect(d.theme?.font).toBeUndefined();
    for (const s of falco.sections) {
      if (s.style.backgroundImage) expect(d.sections?.[`s-${s.index}`]?.background).toBeUndefined();
    }
    expect(RebuildModernizeAnswerSchema.safeParse(d).success).toBe(true);
    expect(checkRebuildEdit(d, falco)).toEqual({ ok: true });
  });

  it('falcodent: the photo-slider hero keeps its own alignment, the other sections align left', () => {
    const falco = load('falcodent');
    const hero = falco.sections.find((s) => s.role === 'hero')!;
    expect(hero.arrangement).toBe('slider');
    const d = defaultModernDesign(falco);
    expect(d.sections?.[`s-${hero.index}`]?.align).toBeUndefined();
    const others = falco.sections.filter((s) => s.role === 'content');
    expect(others.length).toBeGreaterThan(0);
    for (const s of others) expect(d.sections?.[`s-${s.index}`]?.align).toBe('left');
    expect(checkRebuildEdit(d, falco)).toEqual({ ok: true });
  });

  describe('hero style by photo width', () => {
    const sec = (index: number, over: Partial<ISiteSection>): ISiteSection => ({
      index, role: 'content', kind: 'other', arrangement: 'text', intro: { heading: `H${index}`, text: [], links: [] },
      items: [], extra: [], images: [], embeds: [], style: {}, ...over,
    });
    const page = (width: number): ISiteSections => ({
      sections: [
        sec(0, { role: 'hero', intro: { heading: 'Welcome', headingLevel: 1, text: [], links: [] } }),
        sec(1, { arrangement: 'media-beside-text', intro: { heading: 'About', text: ['We help.'], links: [] }, images: [{ src: 'https://x.test/a.jpg', width }, { src: 'https://x.test/b.jpg', width: 400 }] }),
      ],
      skipped: [], coverage: { pageChars: 1, capturedChars: 1, ratio: 1, uncaptured: [] },
    });

    it('a photo at least REBUILD_BANNER_MIN_WIDTH wide makes a banner hero, which keeps its alignment', () => {
      const read = page(REBUILD_BANNER_MIN_WIDTH);
      const d = defaultModernDesign(read);
      expect(d.hero).toEqual({ photo: 's-1.m0', style: 'banner' });
      expect(d.sections?.['s-0']?.align).toBeUndefined();
      expect(d.sections?.['s-1']?.align).toBe('left');
      expect(checkRebuildEdit(d, read)).toEqual({ ok: true });
    });

    it('a narrower photo makes a split hero, aligned left', () => {
      const read = page(REBUILD_BANNER_MIN_WIDTH - 1);
      const d = defaultModernDesign(read);
      expect(d.hero).toEqual({ photo: 's-1.m0', style: 'split' });
      expect(d.sections?.['s-0']?.align).toBe('left');
      expect(checkRebuildEdit(d, read)).toEqual({ ok: true });
    });
  });

  it('turns a list of three items into cards and keeps a small image out of the hero', () => {
    const sec = (index: number, over: Partial<ISiteSection>): ISiteSection => ({
      index, role: 'content', kind: 'other', arrangement: 'text', intro: { heading: `H${index}`, text: [], links: [] },
      items: [], extra: [], images: [], embeds: [], style: {}, ...over,
    });
    const page: ISiteSections = {
      sections: [
        sec(0, { role: 'hero' }),
        sec(1, { arrangement: 'list', items: [1, 2, 3].map((n) => ({ title: `i${n}`, text: [], links: [] })) }),
        sec(2, { arrangement: 'media-beside-text', images: [{ src: 'https://x.test/a.jpg', width: 200 }] }),
      ],
      skipped: [], coverage: { pageChars: 1, capturedChars: 1, ratio: 1, uncaptured: [] },
    };
    const d = defaultModernDesign(page);
    expect(d.hero).toBeUndefined();
    expect(d.sections?.['s-1']?.arrangement).toBe('card-grid');
    expect(d.sections?.['s-2']?.mediaSide).toBe('right');
    expect(checkRebuildEdit(d, page)).toEqual({ ok: true });
  });
});

describe('modernizeForAudit (REV-114)', () => {
  const read = load('anident');
  const auditId = 'a'.repeat(24);
  const audit = { _id: auditId, siteSections: read } as unknown as Partial<IAudit>;
  const stored: IRebuildModernize = { auditId, source: 'llm', design: defaultModernDesign(read) };

  it('returns the stored design for its own audit', () => {
    expect(modernizeForAudit(stored, audit)).toBe(stored);
  });

  it('leaves out a design for another audit, or one that no longer fits the page, with a log line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(modernizeForAudit({ ...stored, auditId: 'b'.repeat(24) }, audit)).toBeUndefined();
    expect(modernizeForAudit({ ...stored, design: { sections: { 's-99': { align: 'left' } } } }, audit)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(modernizeForAudit(undefined, audit)).toBeUndefined();
    expect(modernizeForAudit(null, audit)).toBeUndefined();
    warn.mockRestore();
  });
});
