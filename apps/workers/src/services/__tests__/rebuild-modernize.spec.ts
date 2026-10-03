import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import type { IAudit, IRebuildModernize, ISiteSection, ISiteSections } from '@revamp/shared-types';
import { RebuildModernizeAnswerSchema, checkRebuildEdit } from '@revamp/validation';
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

  it('shows the long run of short paragraphs as cards', () => {
    expect(design.sections?.['s-9']?.arrangement).toBe('card-grid');
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
