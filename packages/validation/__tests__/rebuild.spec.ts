import { describe, expect, it } from 'vitest';
import {
  MvpLayoutSelectionSchema,
  MvpRebuildSummarySchema,
  REBUILD_FLAT_MIN_PAGE_CHARS,
  REBUILD_MAX_SECTION_SHARE,
  REBUILD_MIN_COVERAGE,
  REBUILD_MIN_HEADING_SHARE,
  RebuildPlanSchema,
  UpdateMvpLayoutSchema,
  manualMvpLayout,
  rebuildEligibility,
  siteSectionChars,
} from '../src/index.js';
import type { IRebuildPlan, ISiteSection, ISiteSections } from '@revamp/shared-types';

const sections = (ratio: number, roles: Array<'header' | 'hero' | 'content' | 'footer'> = ['header', 'hero', 'content']): ISiteSections => ({
  sections: roles.map((role, index) => ({
    index, role, kind: 'other', arrangement: 'text',
    intro: { heading: `H${index}`, text: ['Body'], links: [] },
    items: [], extra: [], images: [], embeds: [], style: {},
  })),
  skipped: [],
  coverage: { pageChars: 1000, capturedChars: Math.round(ratio * 1000), ratio, uncaptured: [] },
});

describe('rebuildEligibility (REV-110)', () => {
  it('accepts sections at the coverage threshold', () => {
    expect(REBUILD_MIN_COVERAGE).toBe(0.85);
    expect(rebuildEligibility({ siteSections: sections(0.85) })).toEqual({ ok: true });
  });
  it('falls back just under the threshold, with the ratio as a fact', () => {
    expect(rebuildEligibility({ siteSections: sections(0.849) })).toEqual({
      ok: false, reason: 'rebuild:low_coverage', facts: ['coverage:0.849'],
    });
  });
  it('falls back when the sections were not read', () => {
    expect(rebuildEligibility({ siteSectionsError: 'layout walk failed: x' })).toMatchObject({ ok: false, reason: 'rebuild:unread' });
    expect(rebuildEligibility({})).toMatchObject({ ok: false, reason: 'rebuild:unread' });
    expect(rebuildEligibility(null)).toMatchObject({ ok: false, reason: 'rebuild:unread' });
  });
  it('falls back with only a header and a footer', () => {
    expect(rebuildEligibility({ siteSections: sections(1, ['header', 'footer']) })).toMatchObject({
      ok: false, reason: 'rebuild:no_content',
    });
  });
});

/** A section with `chars` characters of body text, and a heading when given */
const block = (index: number, role: ISiteSection['role'], chars: number, heading?: string): ISiteSection => ({
  index, role, kind: 'other', arrangement: 'text',
  intro: { ...(heading ? { heading } : {}), text: chars > 0 ? ['x'.repeat(chars)] : [], links: [] },
  items: [], extra: [], images: [], embeds: [], style: {},
});
const reading = (pageChars: number, list: ISiteSection[]): ISiteSections => {
  const captured = list.reduce((sum, section) => sum + siteSectionChars(section), 0);
  return { sections: list, skipped: [], coverage: { pageChars, capturedChars: captured, ratio: 0.99, uncaptured: [] } };
};

// The shapes read from Mongo (REV-112): anident.pl and reskor.pl are table layouts read as a few giant
// blocks, falcodent.pl a modern page read section by section
const anident = reading(8605, [block(0, 'hero', 4700), block(1, 'content', 3500), block(2, 'content', 350)]);
const reskor = reading(2781, [block(0, 'header', 60), block(1, 'content', 2600, 'O nas'), block(2, 'footer', 80)]);
const falcodent = reading(5314, [
  block(0, 'header', 120),
  ...Array.from({ length: 17 }, (_, i) => block(i + 1, i === 0 ? 'hero' : 'content', i === 3 ? 1200 : 220, i % 3 === 2 ? undefined : `H${i}`)),
  block(18, 'footer', 300),
]);

describe('rebuildEligibility: flat readings (REV-112)', () => {
  it('names its thresholds', () => {
    expect(REBUILD_FLAT_MIN_PAGE_CHARS).toBe(1500);
    expect(REBUILD_MAX_SECTION_SHARE).toBe(0.5);
    expect(REBUILD_MIN_HEADING_SHARE).toBe(0.25);
  });
  it('falls back on a few giant blocks without headings (anident.pl)', () => {
    expect(rebuildEligibility({ siteSections: anident })).toEqual({
      ok: false, reason: 'rebuild:flat', facts: ['flat:share=0.55', 'flat:headings=0/3'],
    });
  });
  it('falls back when one section holds nearly all the text (reskor.pl)', () => {
    expect(rebuildEligibility({ siteSections: reskor })).toEqual({
      ok: false, reason: 'rebuild:flat', facts: ['flat:share=0.949', 'flat:headings=1/1'],
    });
  });
  it('still rebuilds a page read section by section (falcodent.pl)', () => {
    expect(rebuildEligibility({ siteSections: falcodent })).toEqual({ ok: true });
  });
  it('accepts a section at the share threshold and falls back just above it', () => {
    const at = reading(2000, [block(0, 'hero', 500, 'A'), block(1, 'content', 500, 'B')]);
    expect(rebuildEligibility({ siteSections: at })).toEqual({ ok: true });
    const above = reading(2000, [block(0, 'hero', 501, 'A'), block(1, 'content', 499, 'B')]);
    expect(rebuildEligibility({ siteSections: above })).toMatchObject({ reason: 'rebuild:flat', facts: ['flat:share=0.501', 'flat:headings=2/2'] });
  });
  it('counts the header and footer text in the total, but not as the largest section', () => {
    const list = [block(0, 'header', 900), block(1, 'content', 400, 'A'), block(2, 'content', 300, 'B'), block(3, 'footer', 100)];
    expect(rebuildEligibility({ siteSections: reading(2000, list) })).toEqual({ ok: true });
  });
  it('accepts a quarter of the sections with a heading and falls back below it', () => {
    const titled = (headed: number) =>
      reading(4000, Array.from({ length: 8 }, (_, i) => block(i, 'content', 200, i < headed ? `H${i}` : undefined)));
    expect(rebuildEligibility({ siteSections: titled(2) })).toEqual({ ok: true });
    expect(rebuildEligibility({ siteSections: titled(1) })).toMatchObject({ reason: 'rebuild:flat', facts: ['flat:share=0.126', 'flat:headings=1/8'] });
  });
  it('does not check a short page, which may well be one block', () => {
    const short = (pageChars: number) => reading(pageChars, [block(0, 'hero', 1400)]);
    expect(rebuildEligibility({ siteSections: short(REBUILD_FLAT_MIN_PAGE_CHARS - 1) })).toEqual({ ok: true });
    expect(rebuildEligibility({ siteSections: short(REBUILD_FLAT_MIN_PAGE_CHARS) })).toMatchObject({ reason: 'rebuild:flat' });
  });
  it('reports low coverage before flatness', () => {
    const low = { ...anident, coverage: { ...anident.coverage, ratio: 0.5 } };
    expect(rebuildEligibility({ siteSections: low })).toMatchObject({ reason: 'rebuild:low_coverage' });
  });
  it('is not flat when the sections hold only media', () => {
    expect(rebuildEligibility({ siteSections: reading(3000, [block(0, 'hero', 0), block(1, 'content', 0)]) })).toEqual({ ok: true });
  });
});

describe('siteSectionChars (REV-109, shared by the coverage and REV-112)', () => {
  const section: ISiteSection = {
    ...block(0, 'content', 0, 'Head'),
    intro: { eyebrow: 'Eye', heading: 'Head', text: ['Read more here'], links: [
      { label: 'more', href: 'https://a.pl/x', kind: 'link' },
      { label: 'Call', href: 'tel:1', kind: 'phone' },
    ] },
    items: [{ title: 'Cleaning', text: ['od 150 zł per visit'], price: 'od 150 zł', links: [] }, { title: 'Exam', text: [], price: '90 zł', links: [] }],
    extra: [{ type: 'text', text: ['Extra'] }],
  };
  it('counts each piece of text once', () => {
    // Eye 3 + Head 4 + 'Read more here' 14 + 'Call' 4 ('more' is in the text) + Cleaning 8 + its line 19
    // (the price is in it) + Exam 4 + '90 zł' 5 + Extra 5
    expect(siteSectionChars(section)).toBe(66);
  });
  it('leaves out labels the reader marks as not page text', () => {
    expect(siteSectionChars(section, (link) => link.label === 'Call')).toBe(62);
  });
});

describe('layout variants (REV-110)', () => {
  it('accepts original in the layout selection and the PATCH body', () => {
    expect(MvpLayoutSelectionSchema.parse({ variant: 'original', reasons: ['rule:rebuild'] }).variant).toBe('original');
    expect(UpdateMvpLayoutSchema.parse({ variant: 'original' }).variant).toBe('original');
  });
  it('manualMvpLayout drops render outcomes but keeps audit facts', () => {
    const layout = manualMvpLayout(
      { reasons: ['rebuild:low_coverage', 'coverage:0.7', 'manual:original', 'rule:derived', 'images:3'] },
      'bento',
    );
    expect(layout.reasons).toEqual(['rule:manual', 'images:3']);
  });
  it('manualMvpLayout drops the flat reading facts (REV-112)', () => {
    const layout = manualMvpLayout({ reasons: ['rebuild:flat', 'flat:share=0.549', 'flat:headings=0/3', 'images:3'] }, 'original');
    expect(layout.reasons).toEqual(['rule:manual', 'images:3']);
  });
});

describe('MvpRebuildSummarySchema', () => {
  it('accepts a summary and rejects an unknown omission', () => {
    const summary = { coverage: 0.978, sections: 19, omitted: [{ what: 'nav_link', reason: 'other_page', sample: 'Cennik' }], tuning: ['contrast:3'] };
    expect(MvpRebuildSummarySchema.parse(summary)).toEqual(summary);
    expect(() => MvpRebuildSummarySchema.parse({ ...summary, omitted: [{ what: 'banana', reason: 'x' }] })).toThrow();
  });
  it('caps omitted at 80 and tuning at 120', () => {
    const omitted = Array.from({ length: 81 }, () => ({ what: 'link', reason: 'other_page' }));
    expect(() => MvpRebuildSummarySchema.parse({ coverage: 1, sections: 1, omitted, tuning: [] })).toThrow();
    expect(() => MvpRebuildSummarySchema.parse({ coverage: 1, sections: 1, omitted: [], tuning: Array(121).fill('x') })).toThrow();
  });
});

export const minimalPlan = (): IRebuildPlan => ({
  language: 'pl',
  businessName: 'Falco-Dent',
  hiddenH1: undefined,
  year: 2026,
  theme: {
    primary: '#0e7490', onPrimary: '#ffffff', pageBackground: '#ffffff', pageText: '#111111',
    headingFont: 'sans-serif', bodyFont: 'sans-serif', headingWeight: 700, headingUppercase: false,
    h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, buttonRadius: 6, buttonUppercase: false,
  },
  header: { nav: [], cta: { label: 'Umów wizytę' } },
  sections: [{
    id: 's-1', index: 1, kind: 'other', arrangement: 'text', headingLevel: 1,
    intro: { heading: 'Gabinet', text: ['Tekst'], links: [] },
    items: [], extra: [], images: [], embeds: [], booking: false, collapsed: false,
    style: { text: '#111111', align: 'left', paddingY: 64, fullBleed: false },
  }],
  bookingAppended: true,
  bookingServices: [],
  footer: { contacts: {}, social: [] },
  summary: { coverage: 0.978, sections: 1, omitted: [], tuning: [] },
  seo: {},
});

describe('RebuildPlanSchema', () => {
  it('accepts a minimal plan', () => {
    expect(() => RebuildPlanSchema.parse(minimalPlan())).not.toThrow();
  });

  it('requires the search and sharing tags, and validates them (REV-118)', () => {
    const withoutSeo: Partial<ReturnType<typeof minimalPlan>> = minimalPlan();
    delete withoutSeo.seo;
    expect(RebuildPlanSchema.safeParse(withoutSeo).success).toBe(false);
    expect(RebuildPlanSchema.safeParse({ ...minimalPlan(), seo: { image: 'javascript:alert(1)' } }).success).toBe(false);
  });
  it('rejects a javascript: link and a data: image', () => {
    const plan = minimalPlan();
    plan.sections[0]!.intro.links = [{ label: 'x', href: 'javascript:alert(1)', kind: 'phone' }];
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
    const plan2 = minimalPlan();
    plan2.sections[0]!.images = [{ src: 'data:image/png;base64,AA', alt: '' }];
    expect(() => RebuildPlanSchema.parse(plan2)).toThrow();
  });
  it('rejects an iframe host off the allowlist', () => {
    const plan = minimalPlan();
    plan.sections[0]!.embeds = [{ kind: 'map', src: 'https://evil.example/maps', title: 'Mapa' }];
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
  });
  it('rejects a color that is not #rrggbb', () => {
    const plan = minimalPlan();
    plan.theme.primary = 'red';
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
  });
});

describe('RebuildPlanSchema photo slides and item text (REV-110 review)', () => {
  const withItem = (patch: Record<string, unknown>) => {
    const plan = minimalPlan();
    plan.sections[0]!.items = [{ text: ['Slajd'], links: [], ...patch }];
    return plan;
  };
  it('accepts an http(s) slide photo with its alt, and rejects javascript: or data: photos', () => {
    expect(RebuildPlanSchema.safeParse(withItem({ backgroundImage: 'https://falcodent.pl/ortheo.jpg', backgroundAlt: 'Nakładki' })).success).toBe(true);
    expect(RebuildPlanSchema.safeParse(withItem({ backgroundImage: 'javascript:alert(1)' })).success).toBe(false);
    expect(RebuildPlanSchema.safeParse(withItem({ backgroundImage: 'data:image/png;base64,AA' })).success).toBe(false);
    expect(RebuildPlanSchema.safeParse(withItem({ backgroundAlt: '' })).success).toBe(false);
    expect(RebuildPlanSchema.safeParse(withItem({ backgroundAlt: 'x'.repeat(301) })).success).toBe(false);
  });
  it('accepts a #rrggbb item text color and rejects any other', () => {
    const plan = (text: unknown) => {
      const p = minimalPlan();
      p.sections[0]!.itemStyle = { background: '#ffffff', text } as never;
      return p;
    };
    expect(RebuildPlanSchema.safeParse(plan('#4a4a4a')).success).toBe(true);
    for (const bad of ['white', '#fff', 'rgb(0,0,0)', '#4a4a4a; background:url(x)']) expect(RebuildPlanSchema.safeParse(plan(bad)).success).toBe(false);
  });
  it('takes photoSlides as a boolean only', () => {
    const plan = (photoSlides: unknown) => {
      const p = minimalPlan();
      (p.sections[0] as unknown as Record<string, unknown>).photoSlides = photoSlides;
      return p;
    };
    expect(RebuildPlanSchema.safeParse(plan(true)).success).toBe(true);
    expect(RebuildPlanSchema.safeParse(plan(undefined)).success).toBe(true);
    for (const bad of ['true', 1, null]) expect(RebuildPlanSchema.safeParse(plan(bad)).success).toBe(false);
  });
});

describe('RebuildPlanSchema embeds and links (REV-110 fix)', () => {
  const withEmbed = (src: string) => {
    const plan = minimalPlan();
    plan.sections[0]!.embeds = [{ kind: 'map', src, title: 'Mapa' }];
    return plan;
  };
  it.each([
    'https://www.google.com/maps/embed?pb=1',
    'https://maps.google.pl/maps?q=x',
    'https://www.youtube.com/embed/abc',
    'https://player.vimeo.com/video/1',
  ])('accepts the embed %s', (src) => {
    expect(() => RebuildPlanSchema.parse(withEmbed(src))).not.toThrow();
  });
  it.each([
    'https://google.evil.com/maps',
    'https://google.com.evil.com/maps',
    'https://maps.google.evil.com/',
    'https://www.google.com/mapsX',
    'https://www.youtube.com.evil.com/embed/abc',
    'https://player.vimeo.com.evil.com/video/1',
  ])('rejects the embed %s', (src) => {
    expect(() => RebuildPlanSchema.parse(withEmbed(src))).toThrow();
  });
  it.each([
    ['phone', 'tel:+48510510706'],
    ['email', 'mailto:a@b.pl'],
    ['booking', '#booking'],
    ['anchor', '#s-2'],
  ] as const)('accepts a %s link %s', (kind, href) => {
    const plan = minimalPlan();
    plan.sections[0]!.intro.links = [{ label: 'x', href, kind }];
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });
  it('rejects a link whose href does not match its kind', () => {
    const plan = minimalPlan();
    plan.sections[0]!.intro.links = [{ label: 'x', href: '#booking', kind: 'anchor' }];
    expect(() => RebuildPlanSchema.parse(plan)).toThrow();
  });
});
