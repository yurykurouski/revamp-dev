/** An anident-like page outline and a model answer for it (REV-113): logo, menu, three headed sections with photos, footer */
import type { SiteGroupingAnswer } from '@revamp/validation';
import type { RawOutlinePiece, RawPageOutline, RawSiteBlock, RawSiteSections } from '../../site-sections.page.js';

export const box = (top: number, left = 480, width = 460, height = 40) => ({ top, left, width, height });
export const font = { size: 13, weight: 400, uppercase: false, color: 'rgb(0, 0, 0)' };
export const bold = { ...font, size: 15, weight: 700 };
export const P = (id: number, type: RawOutlinePiece['type'], over: Partial<RawOutlinePiece> = {}): RawOutlinePiece => ({
  id,
  type,
  tag: 'td',
  box: box(id * 100),
  font,
  background: 'rgb(255, 255, 255)',
  align: 'left',
  ...over,
});
const long = (s: string) => `${s} ${'treść akapitu '.repeat(12)}`.trim();

export const pieces: RawOutlinePiece[] = [
  P(1, 'image', { tag: 'img', box: box(20, 40, 367, 179), image: { src: 'https://anident.test/logo.jpg', alt: 'ANIDENT', box: box(20, 40, 367, 179), radius: 0 } }),
  P(2, 'links', { box: box(210, 40, 1360, 30), links: [{ label: 'Start', href: 'https://anident.test/', button: false }, { label: 'Oferta', href: 'https://anident.test/oferta', button: false }] }),
  P(3, 'heading', { text: 'IMPLANTY ZĘBÓW', styled: true, font: bold }),
  P(4, 'text', { text: long('Implanty') }),
  P(5, 'image', { tag: 'img', box: box(500, 590, 350, 233), image: { src: 'https://anident.test/implant.jpg', alt: 'Implanty', box: box(500, 590, 350, 233), radius: 0 } }),
  P(6, 'heading', { text: 'LICÓWKI', styled: true, font: bold }),
  P(7, 'text', { text: long('Licówki') }),
  P(8, 'image', { tag: 'img', box: box(800, 480, 350, 350), image: { src: 'https://anident.test/licowki.jpg', alt: 'Licówki', box: box(800, 480, 350, 350), radius: 0 } }),
  P(9, 'heading', { text: 'ORTODONCJA', styled: true, font: bold }),
  P(10, 'text', { text: long('Aparaty') }),
  P(11, 'text', { text: 'ul. Przykładowa 1, Warszawa · tel. 22 000 00 00', box: box(1300, 40, 1360, 30) }),
  P(12, 'text', { text: 'Licznik odwiedzin 12345' }),
];
export const outline: RawPageOutline = { pieces, bodySize: 13, pageHeight: 1400, truncated: false };
export const raw: RawSiteSections = {
  viewportWidth: 1440,
  viewportHeight: 900,
  blocks: [],
  typography: {},
  pageChars: pieces.reduce((n, p) => n + (p.text?.length ?? 0), 0) + 11,
  uncaptured: [],
  outline,
};
export const answer: SiteGroupingAnswer = {
  header: { logo: 1, pieces: [2] },
  sections: [
    { heading: 3, pieces: [4, 5], kind: 'services', arrangement: 'media-beside-text' },
    { heading: 6, pieces: [7, 8], kind: 'services', arrangement: 'media-beside-text' },
    { heading: 9, pieces: [10], kind: 'services', arrangement: 'text' },
  ],
  footer: { pieces: [11] },
};

const contentBlock = (top: number, heading: string, text: string[]): RawSiteBlock => ({
  role: 'content',
  box: { top, left: 0, width: 1440, height: 500 },
  introBox: { top: top + 40, left: 200, width: 1040, height: 400 },
  contentBox: { top: top + 40, left: 200, width: 1040, height: 420 },
  intro: { heading, headingLevel: 2, text, links: [] },
  extra: [],
  images: [],
  embeds: [],
  style: { background: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)', textAlign: 'start', paddingTop: 40, paddingBottom: 40 },
});

/** A rules reading's raw facts: one headed block of 600 chars */
export const rulesRaw: RawSiteSections = { ...raw, blocks: [contentBlock(1000, 'O nas', ['a'.repeat(300), 'b'.repeat(300)])], pageChars: 700 };

/** Three headed blocks of 600 chars each: a rules reading that passes the rebuild gate */
export const passingRules: RawSiteSections = {
  ...raw,
  blocks: [contentBlock(1000, 'Implanty', ['i'.repeat(600)]), contentBlock(1600, 'Licówki', ['l'.repeat(600)]), contentBlock(2200, 'Ortodoncja', ['o'.repeat(600)])],
  pageChars: 1900,
};
