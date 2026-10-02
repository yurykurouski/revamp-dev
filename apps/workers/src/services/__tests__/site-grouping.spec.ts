import { describe, it, expect } from 'vitest';
import { rebuildEligibility, type SiteGroupingAnswer } from '@revamp/validation';
import type { RawOutlinePiece } from '../site-sections.page.js';
import { assembleGroupedBlocks, checkGrouping, outlinePrompt, readGroupedSections } from '../site-grouping.js';
import { P, answer, box, outline, pieces, raw } from './fixtures/grouping-fixtures.js';

describe('checkGrouping (REV-113)', () => {
  it('accepts a valid answer', () => expect(checkGrouping(answer, outline)).toEqual([]));
  it('rejects an unknown id', () => expect(checkGrouping({ ...answer, footer: { pieces: [99] } }, outline)).toContain('unknown id 99'));
  it('rejects a piece used twice', () => expect(checkGrouping({ ...answer, footer: { pieces: [11, 4] } }, outline)).toContain('piece 4 used twice'));
  it('rejects a heading that is not heading-like', () =>
    expect(checkGrouping({ ...answer, sections: [{ ...answer.sections[0]!, heading: 5, pieces: [4] }, ...answer.sections.slice(1)] }, outline)).toContain(
      'section 1: heading 5 is not a heading',
    ));
  it('rejects a long text piece as a heading', () =>
    expect(checkGrouping({ ...answer, sections: [{ ...answer.sections[0]!, heading: 4, pieces: [3, 5] }, ...answer.sections.slice(1)] }, outline)).toContain(
      'section 1: heading 4 is not a heading',
    ));
  it('rejects a logo that is not an image', () => expect(checkGrouping({ ...answer, header: { logo: 2, pieces: [] } }, outline)).toContain('logo 2 is not an image'));
});

describe('assembleGroupedBlocks / readGroupedSections (REV-113)', () => {
  it('keeps each photo with its text, reads the header logo and nav and the footer', () => {
    const read = readGroupedSections(raw, answer).sections!;
    expect(read.source).toBe('llm');
    const [header, ...rest] = read.sections;
    expect(header).toMatchObject({ role: 'header', images: [{ src: 'https://anident.test/logo.jpg' }] });
    expect(header!.intro.links.map((l) => l.label)).toEqual(['Start', 'Oferta']);
    const body = rest.filter((s) => s.role !== 'footer');
    expect(body.map((s) => s.intro.heading)).toEqual(['IMPLANTY ZĘBÓW', 'LICÓWKI', 'ORTODONCJA']);
    expect(body[0]!.images.map((i) => i.src)).toEqual(['https://anident.test/implant.jpg']);
    expect(body[0]!.arrangement).toBe('media-beside-text');
    expect(body.every((s) => s.arrangement !== 'gallery')).toBe(true);
    expect(read.sections.at(-1)!.role).toBe('footer');
  });

  it('records left-out pieces as unassigned and lowers coverage by their text', () => {
    const read = readGroupedSections(raw, answer).sections!;
    expect(read.skipped).toContainEqual(expect.objectContaining({ reason: 'unassigned', sample: 'Licznik odwiedzin 12345' }));
    expect(read.coverage.capturedChars).toBeLessThan(raw.pageChars);
  });

  it('sorts sections and their text into page order whatever order the model used', () => {
    const shuffled = { ...answer, sections: [answer.sections[2]!, { ...answer.sections[0]!, pieces: [5, 4] }, answer.sections[1]!] };
    const blocks = assembleGroupedBlocks(raw, outline, shuffled).blocks;
    expect(blocks.map((b) => b.intro.heading)).toEqual(['IMPLANTY ZĘBÓW', 'LICÓWKI', 'ORTODONCJA']);
    expect(blocks[0]!.intro.text[0]).toMatch(/^Implanty/);
  });

  it('builds items from item ids, with their own photo', () => {
    const cards: RawOutlinePiece[] = [
      P(1, 'heading', { text: 'Oferta', level: 2 }),
      P(2, 'heading', { text: 'Implanty', level: 3, box: box(200, 0, 300, 30) }),
      P(3, 'text', { text: 'Opis A', box: box(240, 0, 300, 60) }),
      P(4, 'image', { tag: 'img', box: box(300, 0, 300, 200), image: { src: 'https://x.test/a.jpg', alt: '', box: box(300, 0, 300, 200), radius: 0 } }),
      P(5, 'heading', { text: 'Protetyka', level: 3, box: box(200, 320, 300, 30) }),
      P(6, 'text', { text: 'Opis B', box: box(240, 320, 300, 60) }),
    ];
    const o = { ...outline, pieces: cards };
    const a: SiteGroupingAnswer = {
      sections: [{ heading: 1, pieces: [], items: [{ title: 2, pieces: [3, 4] }, { title: 5, pieces: [6] }], kind: 'services', arrangement: 'card-grid' }],
    };
    const s = readGroupedSections({ ...raw, outline: o, pageChars: 40 }, a).sections!.sections[0]!;
    expect(s).toMatchObject({ arrangement: 'card-grid', columns: 2, kind: 'services' });
    expect(s.items.map((i) => [i.title, i.text, i.image?.src])).toEqual([
      ['Implanty', ['Opis A'], 'https://x.test/a.jpg'],
      ['Protetyka', ['Opis B'], undefined],
    ]);
  });

  it('hidden pieces keep their text but not their geometry', () => {
    const hidden = [...pieces.slice(0, 4), P(5, 'text', { text: 'Ukryta odpowiedź', hidden: true, box: box(0, 0, 0, 0) })];
    const o = { ...outline, pieces: hidden };
    const blocks = assembleGroupedBlocks(raw, o, { sections: [{ heading: 3, pieces: [4, 5], kind: 'faq', arrangement: 'text' }] }).blocks;
    expect(blocks[0]!.intro.text).toContain('Ukryta odpowiedź');
    expect(blocks[0]!.box.top).toBe(300);
  });

  it('the assembled anident-like reading passes rebuildEligibility (coverage pinned to 0.9: the fixture page text is short)', () => {
    const read = readGroupedSections({ ...raw, pageChars: 1600 }, answer).sections!;
    expect(rebuildEligibility({ siteSections: { ...read, coverage: { ...read.coverage, ratio: 0.9 } } })).toEqual({ ok: true });
  });

  it('makes one item per slide of a slider section the model left without items, the slide heading as its title', () => {
    const slide = (index: number) => ({ slide: { slider: 1, index } });
    const slides: RawOutlinePiece[] = [
      P(1, 'background', { tag: 'div', box: box(140, 0, 1440, 550), src: 'https://x.test/a.jpg', ...slide(1) }),
      P(2, 'heading', { text: 'Nakładki', styled: true, box: box(365, 50, 554, 48), ...slide(1) }),
      P(3, 'text', { text: 'Przejrzysta droga do uśmiechu', box: box(447, 50, 454, 19), ...slide(1) }),
      P(4, 'background', { tag: 'div', box: box(140, 1450, 1440, 550), src: 'https://x.test/b.jpg', ...slide(2) }),
      P(5, 'heading', { text: 'Stomatologia estetyczna', styled: true, box: box(297, 1500, 383, 48), ...slide(2) }),
      P(6, 'heading', { text: 'O nas', level: 2, box: box(900, 90, 600, 48) }),
      P(7, 'text', { text: 'Gabinet od 1995 roku.', box: box(960, 90, 600, 40) }),
    ];
    const o = { ...outline, pieces: slides };
    const a: SiteGroupingAnswer = {
      sections: [
        { heading: 2, pieces: [1, 3, 4, 5], kind: 'other', arrangement: 'slider' },
        { heading: 6, pieces: [7], kind: 'about', arrangement: 'text' },
      ],
    };
    const [hero, about] = readGroupedSections({ ...raw, outline: o, pageChars: 120 }, a).sections!.sections;
    expect(hero).toMatchObject({ role: 'hero', arrangement: 'slider' });
    expect(hero!.intro.heading).toBeUndefined();
    expect(hero!.items.map((i) => [i.title, i.text, i.backgroundImage])).toEqual([
      ['Nakładki', ['Przejrzysta droga do uśmiechu'], 'https://x.test/a.jpg'],
      ['Stomatologia estetyczna', [], 'https://x.test/b.jpg'],
    ]);
    expect(about!.intro.heading).toBe('O nas');
  });

  it('starts the slides at the one on screen, in their loop order', () => {
    const on = (index: number) => ({ slide: { slider: 1, index } });
    const slides: RawOutlinePiece[] = [
      P(1, 'background', { tag: 'div', box: box(140, -1450, 1440, 550), src: 'https://x.test/z.jpg', ...on(1) }),
      P(2, 'background', { tag: 'div', box: box(140, 0, 1440, 550), src: 'https://x.test/a.jpg', ...on(2) }),
      P(3, 'heading', { text: 'Pierwszy', styled: true, box: box(365, 50, 554, 48), ...on(2) }),
      P(4, 'background', { tag: 'div', box: box(140, 1450, 1440, 550), src: 'https://x.test/b.jpg', ...on(3) }),
      P(5, 'heading', { text: 'Drugi', styled: true, box: box(297, 1500, 383, 48), ...on(3) }),
    ];
    const hero = readGroupedSections({ ...raw, outline: { ...outline, pieces: slides }, pageChars: 20 }, {
      sections: [{ heading: 3, pieces: [1, 2, 4, 5], kind: 'other', arrangement: 'slider' }],
    }).sections!.sections[0]!;
    expect(hero.items.map((i) => i.backgroundImage)).toEqual(['https://x.test/a.jpg', 'https://x.test/b.jpg', 'https://x.test/z.jpg']);
  });

  it('regroups a slider by its slides when the model split it into items without their photos', () => {
    const on = (index: number) => ({ slide: { slider: 1, index } });
    const slides: RawOutlinePiece[] = [
      P(1, 'background', { tag: 'div', box: box(140, 0, 1440, 550), src: 'https://x.test/a.jpg', ...on(1) }),
      P(2, 'heading', { text: 'Pierwszy', styled: true, box: box(365, 50, 554, 48), ...on(1) }),
      P(3, 'background', { tag: 'div', box: box(140, 1450, 1440, 550), src: 'https://x.test/b.jpg', ...on(2) }),
      P(4, 'heading', { text: 'Drugi', styled: true, box: box(297, 1500, 383, 48), ...on(2) }),
      P(5, 'text', { text: 'Opis drugiego', box: box(350, 1500, 383, 48), ...on(2) }),
    ];
    const hero = readGroupedSections({ ...raw, outline: { ...outline, pieces: slides }, pageChars: 30 }, {
      sections: [{ heading: 2, pieces: [1, 3], items: [{ title: 4, pieces: [5] }], kind: 'other', arrangement: 'slider' }],
    }).sections!.sections[0]!;
    expect(hero.items.map((i) => [i.title, i.text, i.backgroundImage])).toEqual([
      ['Pierwszy', [], 'https://x.test/a.jpg'],
      ['Drugi', ['Opis drugiego'], 'https://x.test/b.jpg'],
    ]);
  });

  it('takes the items from the slider that carries the text, not from its thumbnail strip', () => {
    const on = (slider: number, index: number) => ({ slide: { slider, index } });
    const bg = (id: number, src: string, slider: number, index: number, left: number) =>
      P(id, 'background', { tag: 'div', box: box(140, left, 1440, 550), src, ...on(slider, index) });
    const pieces2: RawOutlinePiece[] = [
      bg(1, 'https://x.test/a.jpg', 1, 1, 0),
      P(2, 'heading', { text: 'Pierwszy', styled: true, box: box(365, 50, 554, 48), ...on(1, 1) }),
      bg(3, 'https://x.test/b.jpg', 1, 2, 1450),
      P(4, 'heading', { text: 'Drugi', styled: true, box: box(297, 1500, 383, 48), ...on(1, 2) }),
      bg(5, 'https://x.test/a-thumb.jpg', 2, 6, 0),
      bg(6, 'https://x.test/b-thumb.jpg', 2, 7, 290),
    ];
    const hero = readGroupedSections({ ...raw, outline: { ...outline, pieces: pieces2 }, pageChars: 20 }, {
      sections: [{ heading: 2, pieces: [1, 3, 4, 5, 6], kind: 'other', arrangement: 'slider' }],
    }).sections!.sections[0]!;
    expect(hero.items.map((i) => [i.title, i.backgroundImage])).toEqual([
      ['Pierwszy', 'https://x.test/a.jpg'],
      ['Drugi', 'https://x.test/b.jpg'],
    ]);
    // The thumbnails are neither items nor the section's own photo
    expect(hero.images).toEqual([]);
    expect(hero.style.backgroundImage).toBeUndefined();
  });

  it('records a left-out menu by its labels', () => {
    const withMenu = [...pieces.slice(0, 11), P(12, 'links', { links: [{ label: 'Profilaktyka', href: 'https://anident.test/p', button: false }, { label: 'Implanty', href: 'https://anident.test/i', button: false }] })];
    const read = readGroupedSections({ ...raw, outline: { ...outline, pieces: withMenu } }, answer).sections!;
    expect(read.skipped).toContainEqual(expect.objectContaining({ reason: 'unassigned', sample: 'Profilaktyka Implanty' }));
  });

  it('makes one item per photo of a gallery section the model left without items', () => {
    const photos: RawOutlinePiece[] = [
      P(1, 'heading', { text: 'Nasz gabinet', level: 2 }),
      ...[2, 3, 4].map((id) => P(id, 'image', { tag: 'img', box: box(200, (id - 2) * 320, 300, 200), image: { src: `https://x.test/${id}.jpg`, alt: '', box: box(200, (id - 2) * 320, 300, 200), radius: 0 } })),
    ];
    const s = readGroupedSections({ ...raw, outline: { ...outline, pieces: photos }, pageChars: 12 }, {
      sections: [{ heading: 1, pieces: [2, 3, 4], kind: 'gallery', arrangement: 'gallery' }],
    }).sections!.sections[0]!;
    expect(s).toMatchObject({ arrangement: 'gallery', kind: 'gallery', intro: expect.objectContaining({ heading: 'Nasz gabinet' }) });
    expect(s.items.map((i) => i.image?.src)).toEqual(['https://x.test/2.jpg', 'https://x.test/3.jpg', 'https://x.test/4.jpg']);
    expect(s.images).toEqual([]);
  });

  it('refuses an invalid answer with its reasons', () => {
    expect(readGroupedSections(raw, { ...answer, footer: { pieces: [99] } }).error).toMatch(/unknown id 99/);
    expect(readGroupedSections({ ...raw, outline: undefined }, answer).error).toBe('No page outline');
  });
});

describe('outlinePrompt (REV-113)', () => {
  it('lists every piece on one line with its facts and a text preview, and the tile ranges', () => {
    const text = outlinePrompt(outline, [{ top: 0, bottom: 1400 }]);
    expect(text).toContain('tile 1: y 0–1400');
    expect(text).toMatch(/^3 heading styled 15px b "IMPLANTY ZĘBÓW" y=300 x=480 w=460 h=40$/m);
    expect(text).toMatch(/^5 image 350x233 alt="Implanty" y=500 x=590$/m);
    expect(text).toMatch(/^2 links \["Start","Oferta"\] y=210 x=40 w=1360 h=30$/m);
    expect(text).toMatch(/^4 text 13px "Implanty treść.*… \(\d+ chars\)" y=400/m);
    const slid = outlinePrompt({ ...outline, pieces: [P(1, 'heading', { text: 'Slajd', styled: true, slide: { slider: 2, index: 3 } })] }, []);
    expect(slid).toMatch(/^1 heading styled .* slide=2\.3$/m);
  });
});
