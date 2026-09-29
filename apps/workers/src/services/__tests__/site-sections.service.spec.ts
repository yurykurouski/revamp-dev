import { describe, it, expect } from 'vitest';
import { SITE_SECTIONS_LIMITS as L } from '@revamp/validation';
import type { RawLayoutBlock } from '../site-layout.service.js';
import type { RawBox, RawItemGroup, RawSiteBlock, RawSiteItem, RawSiteSections } from '../site-sections.page.js';
import {
  arrangementOf,
  cleanText,
  columnsOf,
  groupArrangement,
  imageShape,
  kindFromItems,
  linkKind,
  NOISE_LINE,
  readSiteSections,
  toHex,
  toTypography,
} from '../site-sections.service.js';

export const box = (top: number, left = 0, width = 1440, height = 400): RawBox => ({ top, left, width, height });

export const item = (overrides: Partial<RawSiteItem> = {}): RawSiteItem => ({
  title: 'Implanty',
  text: ['Opis usługi implantów w naszym gabinecie.'],
  links: [],
  icon: false,
  box: box(1100, 200, 320, 300),
  ...overrides,
});

export const rawBlock = (overrides: Partial<RawSiteBlock> = {}): RawSiteBlock => ({
  role: 'content',
  block: 1,
  box: box(900, 0, 1440, 600),
  introBox: box(960, 200, 1040, 120),
  contentBox: box(960, 200, 1040, 480),
  intro: { heading: 'Nasze usługi', headingLevel: 2, text: ['Leczymy kompleksowo.'], links: [] },
  extra: [],
  images: [],
  embeds: [],
  style: { background: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)', textAlign: 'start', paddingTop: 60, paddingBottom: 60 },
  ...overrides,
});

const grid = (count: number, perRow: number): RawSiteItem[] =>
  Array.from({ length: count }, (_, i) => item({ box: box(1100 + Math.floor(i / perRow) * 320, 200 + (i % perRow) * 340, 320, 300) }));

describe('cleanText and toHex (REV-109)', () => {
  it('collapses whitespace and strips soft hyphens', () => {
    expect(cleanText('  Sto­matologia \n  estetyczna ')).toBe('Stomatologia estetyczna');
    expect(cleanText(undefined)).toBe('');
  });

  it('converts computed colors to hex and treats see-through ones as unset', () => {
    expect(toHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(toHex('rgba(10, 170, 119, 0.9)')).toBe('#0aaa77');
    expect(toHex('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(toHex('rgba(0, 0, 0, 0.3)')).toBeUndefined();
    expect(toHex('rgb(0 0 0 / 50%)')).toBe('#000000');
    expect(toHex('#ABCDEF')).toBe('#abcdef');
    expect(toHex('')).toBeUndefined();
    expect(toHex('transparent')).toBeUndefined();
  });
});

describe('linkKind (REV-109)', () => {
  it('names phone, email and map links by their href, then buttons', () => {
    expect(linkKind({ label: 'Zadzwoń', href: 'tel:+48123', button: true })).toBe('phone');
    expect(linkKind({ label: 'Napisz', href: 'mailto:a@b.pl', button: false })).toBe('email');
    expect(linkKind({ label: 'Dojazd', href: 'https://maps.app.goo.gl/abc', button: false })).toBe('map');
    expect(linkKind({ label: 'Dojazd', href: 'https://www.google.com/maps/place/x', button: false })).toBe('map');
    expect(linkKind({ label: 'Umów wizytę', href: 'https://a.pl/kontakt', button: true })).toBe('cta');
    expect(linkKind({ label: 'Więcej', href: 'https://a.pl/o-nas', button: false })).toBe('link');
  });
});

describe('imageShape (REV-109)', () => {
  it('reads round, wide, tall and square from the box and radius', () => {
    expect(imageShape(160, 160, 80)).toBe('round');
    expect(imageShape(160, 160, 79.5)).toBe('round');
    expect(imageShape(160, 160, 12)).toBe('square');
    expect(imageShape(400, 200, 0)).toBe('wide');
    expect(imageShape(200, 300, 0)).toBe('tall');
    expect(imageShape(0, 0, 0)).toBeUndefined();
  });
});

describe('arrangement (REV-109)', () => {
  it('follows markup first: accordion, tabs, slider', () => {
    for (const markup of ['accordion', 'tabs', 'slider'] as const) {
      expect(arrangementOf(rawBlock({ group: { markup, items: grid(3, 3) } })).arrangement).toBe(markup);
    }
  });

  it('calls a section taken up by an embed an embed', () => {
    const map = { kind: 'map' as const, box: box(900, 600, 840, 600) };
    expect(arrangementOf(rawBlock({ embeds: [map] })).arrangement).toBe('embed');
    expect(arrangementOf(rawBlock({ embeds: [{ ...map, box: box(900, 600, 400, 300) }] })).arrangement).toBe('text');
  });

  it('calls image-only items a gallery', () => {
    const photos = grid(4, 4).map((i) => ({ ...i, title: undefined, text: [], image: { src: 'https://a.pl/1.jpg', alt: '', box: i.box, radius: 0 } }));
    expect(arrangementOf(rawBlock({ group: { items: photos } })).arrangement).toBe('gallery');
  });

  it('calls items in a row a card grid with its columns, and stacked items a list', () => {
    expect(arrangementOf(rawBlock({ group: { items: grid(6, 3) } }))).toEqual({ arrangement: 'card-grid', columns: 3 });
    expect(arrangementOf(rawBlock({ group: { items: grid(4, 1) } }))).toEqual({ arrangement: 'list' });
    expect(columnsOf(grid(5, 2))).toBe(2);
    expect(columnsOf([])).toBe(0);
    // One long row is stored as at most 12 columns, the schema's limit
    expect(arrangementOf(rawBlock({ group: { items: grid(15, 15) } }))).toEqual({ arrangement: 'card-grid', columns: 12 });
  });

  it('reads a large image beside the text, with its side and split', () => {
    const photo = { src: 'https://a.pl/room.jpg', alt: '', box: box(950, 864, 576, 400), radius: 0 };
    const result = arrangementOf(rawBlock({ images: [photo], introBox: box(1000, 40, 784, 300) }));
    expect(result.arrangement).toBe('media-beside-text');
    expect(result.mediaSide).toBe('right');
    expect(result.split).toBeCloseTo(0.42, 2);
    const left = arrangementOf(rawBlock({ images: [{ ...photo, box: box(950, 0, 576, 400) }], introBox: box(1000, 656, 784, 300) }));
    expect(left.mediaSide).toBe('left');
  });

  it('does not call a small or stacked image beside the text', () => {
    const small = { src: 'https://a.pl/i.png', alt: '', box: box(950, 1100, 200, 200), radius: 0 };
    expect(arrangementOf(rawBlock({ images: [small], introBox: box(1000, 40, 784, 300) })).arrangement).toBe('text');
    const below = { src: 'https://a.pl/i.png', alt: '', box: box(1400, 200, 1040, 400), radius: 0 };
    expect(arrangementOf(rawBlock({ images: [below], introBox: box(960, 200, 1040, 300) })).arrangement).toBe('text');
  });

  it('calls a background photo, or a full photo under the copy, a banner', () => {
    expect(arrangementOf(rawBlock({ backgroundImage: 'https://a.pl/bg.jpg' })).arrangement).toBe('banner');
    const cover = { src: 'https://a.pl/bg.jpg', alt: '', box: box(900, 0, 1440, 600), radius: 0 };
    expect(arrangementOf(rawBlock({ images: [cover], introBox: box(1000, 200, 800, 200) })).arrangement).toBe('banner');
  });

  it('falls back to text', () => {
    expect(arrangementOf(rawBlock())).toEqual({ arrangement: 'text' });
  });

  it('names an extra group by the same rules', () => {
    const group: RawItemGroup = { items: grid(2, 1) };
    expect(groupArrangement(group)).toBe('list');
  });
});

describe('kindFromItems (REV-109)', () => {
  const portrait = (i: number) => ({ src: `https://a.pl/p${i}.jpg`, alt: '', box: box(1100, 200 + i * 340, 160, 160), radius: 80 });

  it('reads a team from portraits with names and short roles', () => {
    const people = Array.from({ length: 6 }, (_, i) => item({ title: `dr Osoba ${i}`, subtitle: 'Lekarz stomatolog', text: ['Krótkie bio.'], image: portrait(i) }));
    expect(kindFromItems(rawBlock({ intro: { heading: 'O nas', text: [], links: [] }, group: { items: people } }))).toBe('team');
    // Two people are not a team section
    expect(kindFromItems(rawBlock({ group: { items: people.slice(0, 2) } }))).toBeUndefined();
    // No roles: not a team
    expect(kindFromItems(rawBlock({ group: { items: people.map((p) => ({ ...p, subtitle: undefined })) } }))).toBeUndefined();
  });

  it('reads an FAQ from question titles', () => {
    const faq = ['Czy boli?', 'Ile trwa wizyta?', 'Jak się przygotować?'].map((title) => item({ title, text: ['Odpowiedź.'] }));
    expect(kindFromItems(rawBlock({ group: { markup: 'accordion', items: faq } }))).toBe('faq');
    expect(kindFromItems(rawBlock({ group: { items: faq.map((f) => ({ ...f, title: 'Implanty' })) } }))).toBeUndefined();
  });

  it('reads features from short headed points under a why-us heading', () => {
    const points = ['Doświadczenie', 'Nowoczesny sprzęt', 'Raty 0%'].map((title) => item({ title, text: ['Krótko.'], icon: true }));
    expect(kindFromItems(rawBlock({ intro: { heading: 'Co nas wyróżnia', text: [], links: [] }, group: { items: points } }))).toBe('features');
    expect(kindFromItems(rawBlock({ intro: { heading: 'Nasze usługi', text: [], links: [] }, group: { items: points } }))).toBeUndefined();
  });
});

describe('NOISE_LINE (REV-109)', () => {
  it('matches consent and legal boilerplate only', () => {
    for (const line of [
      'Ta strona używa plików cookies.',
      'Administratorem Twoich danych osobowych jest Falco-Dent sp. z o.o.',
      '© 2024 Falco-Dent. Wszelkie prawa zastrzeżone.',
      'All rights reserved.',
      'Klauzula informacyjna RODO',
    ]) {
      expect(NOISE_LINE.test(line)).toBe(true);
    }
    for (const line of ['ul. Ogrodowa 5, Kraków', 'Leczenie kanałowe pod mikroskopem', 'Pon–Pt 9:00–18:00']) {
      expect(NOISE_LINE.test(line)).toBe(false);
    }
  });
});

const layoutBlock = (overrides: Partial<RawLayoutBlock> = {}): RawLayoutBlock => ({
  top: 900, height: 600, hint: '', heading: '', imageCount: 0, formCount: 0, mapEmbed: false,
  quoteCount: 0, priceCount: 0, textLength: 400, paddingY: 120, ...overrides,
});

const HERO = rawBlock({ block: 0, box: box(90, 0, 1440, 700), intro: { heading: 'Gabinet Falco', headingLevel: 1, text: ['Witamy.'], links: [] } });

const raw = (overrides: Partial<RawSiteSections> = {}): RawSiteSections => ({
  viewportWidth: 1440,
  viewportHeight: 900,
  blocks: [HERO, rawBlock({ block: 1 })],
  typography: {},
  pageChars: 60,
  uncaptured: [],
  ...overrides,
});

const LAYOUT = [layoutBlock({ top: 90, heading: 'Gabinet Falco' }), layoutBlock({ heading: 'Nasze usługi' })];

describe('readSiteSections (REV-109)', () => {
  it('reads the blocks in page order, the first one on the first screen as the hero', () => {
    const { sections, error } = readSiteSections(raw(), LAYOUT);
    expect(error).toBeUndefined();
    expect(sections!.sections.map((s) => [s.index, s.role, s.kind, s.arrangement])).toEqual([
      [0, 'hero', 'other', 'text'],
      [1, 'content', 'services', 'text'],
    ]);
    expect(sections!.sections[1]!.intro).toEqual({ heading: 'Nasze usługi', headingLevel: 2, text: ['Leczymy kompleksowo.'], links: [] });
  });

  it('keeps a first block below the first screen as content', () => {
    const low = { ...HERO, box: box(1000, 0, 1440, 700) };
    expect(readSiteSections(raw({ blocks: [low, rawBlock()] }), LAYOUT).sections!.sections[0]!.role).toBe('content');
  });

  it('numbers header, blocks and footer in page order and names the footer by its contacts', () => {
    const header = rawBlock({ role: 'header', block: undefined, box: box(0, 0, 1440, 90), intro: { text: [], links: [{ label: 'Start', href: 'https://a.pl/', button: false }] } });
    const footer = rawBlock({ role: 'footer', block: undefined, box: box(1600, 0, 1440, 300), intro: { text: [], links: [{ label: '+48 12 345', href: 'tel:+4812345', button: false }] }, extra: [{ type: 'text', text: ['ul. Długa 5'] }] });
    const { sections } = readSiteSections(raw({ header, footer }), LAYOUT);
    expect(sections!.sections.map((s) => [s.index, s.role, s.kind])).toEqual([
      [0, 'header', 'other'], [1, 'hero', 'other'], [2, 'content', 'services'], [3, 'footer', 'contact'],
    ]);
    expect(sections!.sections[3]!.intro.links[0]!.kind).toBe('phone');
  });

  it('lets the items win over the heading', () => {
    const portrait = (i: number) => ({ src: `https://a.pl/p${i}.jpg`, alt: '', box: box(1100, i * 300, 160, 160), radius: 80 });
    const people = Array.from({ length: 3 }, (_, i) => item({ title: `dr Osoba ${i}`, subtitle: 'Ortodonta', text: ['Bio.'], image: portrait(i), box: box(1100, i * 300, 280, 400) }));
    const about = rawBlock({ intro: { heading: 'O nas', text: [], links: [] }, group: { items: people }, itemStyle: { background: 'rgba(0, 0, 0, 0)', radius: 0, borderWidth: 0, boxShadow: 'none', textAlign: 'center' } });
    const section = readSiteSections(raw({ blocks: [HERO, about] }), [LAYOUT[0]!, layoutBlock({ heading: 'O nas' })]).sections!.sections[1]!;
    expect(section.kind).toBe('team');
    expect(section.arrangement).toBe('card-grid');
    expect(section.columns).toBe(3);
    expect(section.items[0]).toEqual({ title: 'dr Osoba 0', subtitle: 'Ortodonta', text: ['Bio.'], image: { src: 'https://a.pl/p0.jpg', width: 160, height: 160 }, links: [] });
    expect(section.itemStyle).toEqual({ radius: 0, border: false, shadow: false, imageShape: 'round', align: 'center' });
  });

  it('normalizes the style: hex colors, px padding per side, alignment, full bleed', () => {
    const block = rawBlock({ style: { background: 'rgb(245, 247, 250)', color: 'rgb(17, 17, 17)', textAlign: 'center', paddingTop: 61.4, paddingBottom: 80.2 }, contentBox: box(960, 0, 1440, 480) });
    expect(readSiteSections(raw({ blocks: [HERO, block] }), LAYOUT).sections!.sections[1]!.style).toEqual({
      background: '#f5f7fa', textColor: '#111111', align: 'center', paddingY: 71, fullBleed: true,
    });
  });

  it('moves a price out of the text and keeps it as written', () => {
    const rows = [item({ title: 'Przegląd', text: ['od 150 zł'], price: 'od 150 zł' }), item({ title: 'Higienizacja', text: ['300 zł'], price: '300 zł', box: box(1500, 200, 320, 300) })];
    const s = readSiteSections(raw({ blocks: [HERO, rawBlock({ group: { items: rows } })] }), LAYOUT).sections!.sections[1]!;
    expect(s.items.map((i) => [i.title, i.text, i.price])).toEqual([['Przegląd', [], 'od 150 zł'], ['Higienizacja', [], '300 zł']]);
  });

  it('attaches a stray paragraph between blocks to the nearer section, before or after its own text', () => {
    const second = rawBlock({ box: box(1000, 0, 1440, 600) });
    const nearHero = { text: 'Zapraszamy od poniedziałku do soboty.', top: 800 };
    const nearSecond = { text: 'Kolejny akapit.', top: 990 };
    const { sections } = readSiteSections(raw({ blocks: [HERO, second], uncaptured: [nearHero, nearSecond] }), LAYOUT);
    expect(sections!.sections[0]!.extra).toEqual([{ type: 'text', text: ['Zapraszamy od poniedziałku do soboty.'] }]);
    expect(sections!.sections[1]!.extra).toEqual([{ type: 'text', text: ['Kolejny akapit.'] }]);
    expect(sections!.coverage.uncaptured).toEqual([]);
  });

  it('leaves text that sits beside a section, not between sections, in uncaptured', () => {
    const { sections } = readSiteSections(raw({ uncaptured: [{ text: 'Menu boczne', top: 1000 }] }), LAYOUT);
    expect(sections!.coverage.uncaptured).toEqual(['Menu boczne']);
  });

  it('removes noise lines with a reason and skips a section that is all noise', () => {
    const footer = rawBlock({ role: 'footer', block: undefined, box: box(1600, 0, 1440, 200), intro: { text: [], links: [] }, extra: [{ type: 'text', text: ['ul. Długa 5', '© 2024 Falco. Wszelkie prawa zastrzeżone.'] }] });
    const consent = rawBlock({ block: 2, box: box(1500, 0, 1440, 90), intro: { text: ['Ta strona używa plików cookies.'], links: [] } });
    const { sections } = readSiteSections(raw({ blocks: [HERO, rawBlock(), consent], footer }), [...LAYOUT, layoutBlock()]);
    const f = sections!.sections.find((s) => s.role === 'footer')!;
    expect(f.extra).toEqual([{ type: 'text', text: ['ul. Długa 5'] }]);
    expect(sections!.skipped).toEqual([
      { index: 2, reason: 'noise', sample: 'Ta strona używa plików cookies.' },
      { index: 3, reason: 'noise', sample: '© 2024 Falco. Wszelkie prawa zastrzeżone.' },
    ]);
    expect(sections!.sections.map((s) => s.index)).toEqual([0, 1, 3]);
  });

  it('skips an empty block and a duplicate with a reason', () => {
    const empty = rawBlock({ block: 2, intro: { text: [], links: [] } });
    const again = rawBlock({ block: 3 });
    const { sections } = readSiteSections(raw({ blocks: [HERO, rawBlock(), empty, again] }), [...LAYOUT, layoutBlock(), layoutBlock()]);
    expect(sections!.skipped.map((s) => [s.index, s.reason])).toEqual([[2, 'empty'], [3, 'duplicate']]);
    expect(sections!.skipped[1]!.heading).toBe('Nasze usługi');
  });

  it('keeps an image-only section', () => {
    const photo = rawBlock({ block: 2, intro: { text: [], links: [] }, images: [{ src: 'https://a.pl/x.jpg', alt: '', box: box(1600, 0, 400, 300), radius: 0 }] });
    expect(readSiteSections(raw({ blocks: [HERO, rawBlock(), photo] }), [...LAYOUT, layoutBlock()]).sections!.sections).toHaveLength(3);
  });

  it('computes coverage from the kept and the skipped text', () => {
    // Kept: "Gabinet Falco"(13) + "Witamy."(7) + "Nasze usługi"(12) + "Leczymy kompleksowo."(20) = 52; the skipped duplicate adds its 32
    const { sections } = readSiteSections(raw({ blocks: [HERO, rawBlock(), rawBlock({ block: 2 })], pageChars: 100 }), [...LAYOUT, layoutBlock()]);
    expect(sections!.coverage).toEqual({ pageChars: 100, capturedChars: 84, ratio: 0.84, uncaptured: [] });
    expect(readSiteSections(raw({ pageChars: 10 }), LAYOUT).sections!.coverage.ratio).toBe(1);
  });

  it('cuts at the caps, sets truncated, and sends sections past the limit to skipped', () => {
    const many = Array.from({ length: L.items + 5 }, (_, i) => item({ title: `Usługa ${i}`, box: box(1100, i * 10, 100, 100) }));
    const long = rawBlock({ intro: { heading: 'Nasze usługi', text: ['x'.repeat(L.textChars + 10)], links: [] }, group: { items: many } });
    const s = readSiteSections(raw({ blocks: [HERO, long] }), LAYOUT).sections!.sections[1]!;
    expect(s.items).toHaveLength(L.items);
    expect(s.intro.text[0]).toHaveLength(L.textChars);
    expect(s.truncated).toBe(true);

    const blocks = Array.from({ length: L.sections + 3 }, (_, i) => rawBlock({ block: i, box: box(900 + i * 700), intro: { heading: `Sekcja ${i}`, text: [], links: [] } }));
    const capped = readSiteSections(raw({ blocks }), blocks.map(() => layoutBlock())).sections!;
    expect(capped.sections).toHaveLength(L.sections);
    expect(capped.skipped.filter((s) => s.reason === 'cap')).toHaveLength(3);
  });

  it('stops at the total text budget', () => {
    const big = (i: number) => rawBlock({ block: i, box: box(900 + i * 700), intro: { heading: `S${i}`, text: Array.from({ length: L.textsPerArray }, (_, j) => `${i}-${j}-${'x'.repeat(L.textChars - 10)}`), links: [] } });
    const blocks = Array.from({ length: 4 }, (_, i) => big(i));
    const { sections } = readSiteSections(raw({ blocks }), blocks.map(() => layoutBlock()));
    const total = sections!.sections.reduce((sum, s) => sum + s.intro.text.join('').length, 0);
    expect(total).toBeLessThanOrEqual(L.totalChars);
    expect(sections!.skipped.some((s) => s.reason === 'cap')).toBe(true);
  });

  it('drops links it cannot store and repeats of the same link', () => {
    const links = [
      { label: 'Umów', href: 'https://a.pl/kontakt', button: true },
      { label: 'Umów', href: 'https://a.pl/kontakt', button: true },
      { label: 'WhatsApp', href: 'whatsapp://send?phone=1', button: false },
    ];
    const s = readSiteSections(raw({ blocks: [HERO, rawBlock({ intro: { heading: 'Kontakt', text: [], links } })] }), LAYOUT).sections!.sections[1]!;
    expect(s.intro.links).toEqual([{ label: 'Umów', href: 'https://a.pl/kontakt', kind: 'cta' }]);
  });

  it('reports why nothing could be read instead of inventing sections', () => {
    expect(readSiteSections(undefined).error).toMatch(/could not be collected/);
    const onlyHeader = raw({ blocks: [], header: rawBlock({ role: 'header', block: undefined, box: box(0) }) });
    expect(readSiteSections(onlyHeader, []).error).toMatch(/No content sections/);
    const invalid = raw({ blocks: [HERO, rawBlock({ intro: { heading: 'X', headingLevel: 9, text: [], links: [] } })] });
    expect(readSiteSections(invalid, LAYOUT).error).toMatch(/failed validation.*headingLevel/);
  });
});

describe('toTypography (REV-109)', () => {
  it('keeps the first family, rounds sizes and turns px line height into a ratio', () => {
    expect(
      toTypography({
        heading: { family: '"Playfair Display", Georgia, serif', size: 32.4, weight: 700, transform: 'uppercase', color: 'rgb(17, 17, 17)' },
        body: { family: 'Arial, sans-serif', size: 16, weight: 400, lineHeight: '24px', color: 'rgb(51, 51, 51)' },
        button: { radius: 4, background: 'rgb(0, 170, 119)', borderWidth: 0, transform: 'none', color: 'rgb(255, 255, 255)' },
      }),
    ).toEqual({
      heading: { family: 'Playfair Display', size: 32, weight: 700, uppercase: true, color: '#111111' },
      body: { family: 'Arial', size: 16, weight: 400, lineHeight: 1.5, color: '#333333' },
      button: { radius: 4, filled: true, uppercase: false, background: '#00aa77', color: '#ffffff' },
    });
    expect(toTypography({ heading: undefined })).toBeUndefined();
    expect(toTypography({ heading: { family: 'A', size: 30, weight: 700, transform: 'none', color: '' }, body: { family: 'B', size: 16, weight: 400, lineHeight: 'normal', color: '' } })!.body.lineHeight).toBeUndefined();
  });
});
