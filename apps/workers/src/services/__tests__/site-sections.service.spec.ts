import { describe, it, expect } from 'vitest';
import type { RawBox, RawItemGroup, RawSiteBlock, RawSiteItem } from '../site-sections.page.js';
import { arrangementOf, cleanText, columnsOf, groupArrangement, imageShape, kindFromItems, linkKind, NOISE_LINE, toHex } from '../site-sections.service.js';

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
