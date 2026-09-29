import { describe, it, expect } from 'vitest';
import { SITE_SECTION_ARRANGEMENTS, SITE_SECTION_KINDS, SITE_SECTION_ROLES } from '@revamp/shared-types';
import { SITE_SECTIONS_LIMITS as L, SiteSectionsSchema } from '../src/index.js';

const item = {
  title: 'dr Anna Nowak',
  subtitle: 'Ortodonta',
  text: ['Specjalizuje się w leczeniu aparatami stałymi.'],
  image: { src: 'https://falcodent.pl/team/anna.jpg', alt: 'Anna Nowak', width: 160, height: 160 },
  links: [{ label: 'Umów wizytę', href: 'https://falcodent.pl/kontakt', kind: 'cta' }],
};

const section = {
  index: 2,
  role: 'content',
  kind: 'team',
  arrangement: 'card-grid',
  columns: 3,
  intro: { eyebrow: 'Zespół', heading: 'Poznaj nas', headingLevel: 2, text: ['Nasi lekarze.'], links: [] },
  items: [item],
  itemStyle: { background: '#ffffff', radius: 12, border: false, shadow: true, imageShape: 'round', align: 'center' },
  extra: [
    { type: 'text', text: ['Przyjmujemy od poniedziałku do soboty.'] },
    { type: 'items', arrangement: 'list', items: [{ text: ['Implanty'], price: 'od 150 zł', links: [] }] },
  ],
  images: [],
  embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1' }],
  style: { background: '#f5f7fa', textColor: '#111111', align: 'left', paddingY: 60, fullBleed: false },
};

const result = {
  sections: [section],
  typography: {
    heading: { family: 'Georgia', size: 32, weight: 700, uppercase: false, color: '#111111' },
    body: { family: 'Arial', size: 16, weight: 400, lineHeight: 1.5, color: '#333333' },
    button: { radius: 4, filled: true, uppercase: true, background: '#00aa77', color: '#ffffff' },
  },
  skipped: [{ index: 5, reason: 'noise', sample: 'Wszelkie prawa zastrzeżone' }],
  coverage: { pageChars: 1000, capturedChars: 980, ratio: 0.98, uncaptured: ['Zadzwoń'] },
};

const withSection = (patch: Record<string, unknown>) => ({ ...result, sections: [{ ...section, ...patch }] });
const withItem = (patch: Record<string, unknown>) => withSection({ items: [{ ...item, ...patch }] });
const ok = (value: unknown) => SiteSectionsSchema.safeParse(value).success;

describe('SiteSectionsSchema (REV-109)', () => {
  it('accepts a full result read from the DOM', () => {
    expect(SiteSectionsSchema.parse(result)).toEqual(result);
  });

  it('accepts every role, kind and arrangement, and rejects unknown ones', () => {
    for (const role of SITE_SECTION_ROLES) expect(ok(withSection({ role }))).toBe(true);
    for (const kind of SITE_SECTION_KINDS) expect(ok(withSection({ kind }))).toBe(true);
    for (const arrangement of SITE_SECTION_ARRANGEMENTS) expect(ok(withSection({ arrangement }))).toBe(true);
    expect(ok(withSection({ role: 'sidebar' }))).toBe(false);
    expect(ok(withSection({ arrangement: 'masonry' }))).toBe(false);
    expect(SITE_SECTION_KINDS).toContain('features');
  });

  it('keeps the caps at their limits and rejects one past them', () => {
    const many = <T>(count: number, value: T) => Array.from({ length: count }, () => value);
    expect(ok({ ...result, sections: many(L.sections, section) })).toBe(true);
    expect(ok({ ...result, sections: many(L.sections + 1, section) })).toBe(false);
    expect(ok(withSection({ items: many(L.items, item) }))).toBe(true);
    expect(ok(withSection({ items: many(L.items + 1, item) }))).toBe(false);
    expect(ok(withItem({ text: ['x'.repeat(L.textChars)] }))).toBe(true);
    expect(ok(withItem({ text: ['x'.repeat(L.textChars + 1)] }))).toBe(false);
    expect(ok(withItem({ text: many(L.textsPerArray + 1, 'x') }))).toBe(false);
    expect(ok(withItem({ title: 'x'.repeat(L.labelChars + 1) }))).toBe(false);
    expect(ok(withSection({ images: many(L.images + 1, item.image) }))).toBe(false);
    expect(ok(withSection({ embeds: many(L.embeds + 1, { kind: 'widget' }) }))).toBe(false);
    expect(ok(withSection({ extra: many(L.extra + 1, { type: 'text', text: ['x'] }) }))).toBe(false);
    expect(ok({ ...result, coverage: { ...result.coverage, uncaptured: many(L.uncaptured, 'x') } })).toBe(true);
    expect(ok({ ...result, coverage: { ...result.coverage, uncaptured: many(L.uncaptured + 1, 'x') } })).toBe(false);
    expect(ok({ ...result, skipped: [{ index: 1, reason: 'cap', sample: 'x'.repeat(L.sampleChars) }] })).toBe(true);
    expect(ok({ ...result, skipped: [{ index: 1, reason: 'cap', sample: 'x'.repeat(L.sampleChars + 1) }] })).toBe(false);
    expect(ok({ ...result, skipped: many(L.skipped + 1, { index: 1, reason: 'empty', sample: '' }) })).toBe(false);
  });

  it('rejects an invalid color, URL, rating, split or skip reason', () => {
    expect(ok(withSection({ style: { background: 'rgb(0,0,0)' } }))).toBe(false);
    expect(ok(withSection({ style: { backgroundImage: '/bg.jpg' } }))).toBe(false);
    expect(ok(withItem({ image: { src: 'data:image/gif;base64,R0lG' } }))).toBe(false);
    expect(ok(withItem({ links: [{ label: 'x', href: 'javascript:alert(1)', kind: 'link' }] }))).toBe(false);
    expect(ok(withItem({ links: [{ label: 'Zadzwoń', href: 'tel:+48123456789', kind: 'phone' }] }))).toBe(true);
    expect(ok(withItem({ rating: 5 }))).toBe(true);
    expect(ok(withItem({ rating: 5.5 }))).toBe(false);
    expect(ok(withItem({ rating: -1 }))).toBe(false);
    expect(ok(withSection({ style: { split: 1.2 } }))).toBe(false);
    expect(ok(withSection({ intro: { ...section.intro, headingLevel: 7 } }))).toBe(false);
    expect(ok({ ...result, skipped: [{ index: 1, reason: 'boring', sample: '' }] })).toBe(false);
    expect(ok({ ...result, coverage: { ...result.coverage, ratio: 1.01 } })).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { arrangement: _arrangement, ...noArrangement } = section;
    expect(ok({ ...result, sections: [noArrangement] })).toBe(false);
    const { links: _links, ...noLinks } = item;
    expect(ok(withSection({ items: [noLinks] }))).toBe(false);
    const { coverage: _coverage, ...noCoverage } = result;
    expect(ok(noCoverage)).toBe(false);
    expect(ok({ ...result, typography: undefined })).toBe(true);
  });
});
