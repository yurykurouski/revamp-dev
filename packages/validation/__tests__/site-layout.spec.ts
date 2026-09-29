import { describe, it, expect } from 'vitest';
import { SITE_SECTION_KINDS } from '@revamp/shared-types';
import {
  MvpDesignSchema,
  MvpLayoutSelectionSchema,
  SITE_LAYOUT_MAX_SECTIONS,
  SiteLayoutSchema,
  manualMvpLayout,
} from '../src/index.js';

const layout = {
  sections: [{ kind: 'services', heading: 'Nasze usługi' }, { kind: 'gallery' }, { kind: 'contact', heading: 'Kontakt' }],
  hero: { media: 'side', mediaSide: 'right', align: 'left', tone: 'dark' },
  nav: { itemCount: 5, centeredLogo: false, sticky: true, hasCta: true },
  density: 'compact',
};

describe('SiteLayoutSchema (REV-104)', () => {
  it('accepts a layout read from the DOM', () => {
    expect(SiteLayoutSchema.parse(layout)).toEqual(layout);
    expect(SiteLayoutSchema.safeParse({ ...layout, sections: [] }).success).toBe(true);
  });

  it('accepts every section kind and rejects unknown ones', () => {
    for (const kind of SITE_SECTION_KINDS) {
      expect(SiteLayoutSchema.safeParse({ ...layout, sections: [{ kind }] }).success).toBe(true);
    }
    expect(SiteLayoutSchema.safeParse({ ...layout, sections: [{ kind: 'blog' }] }).success).toBe(false);
  });

  it('limits the sections and the heading length', () => {
    const sections = (count: number) => Array.from({ length: count }, () => ({ kind: 'other' }));
    expect(SiteLayoutSchema.safeParse({ ...layout, sections: sections(SITE_LAYOUT_MAX_SECTIONS) }).success).toBe(true);
    expect(SiteLayoutSchema.safeParse({ ...layout, sections: sections(SITE_LAYOUT_MAX_SECTIONS + 1) }).success).toBe(false);
    expect(SiteLayoutSchema.safeParse({ ...layout, sections: [{ kind: 'about', heading: 'x'.repeat(100) }] }).success).toBe(true);
    expect(SiteLayoutSchema.safeParse({ ...layout, sections: [{ kind: 'about', heading: 'x'.repeat(101) }] }).success).toBe(false);
  });

  it('rejects unknown hero, tone and density values', () => {
    expect(SiteLayoutSchema.safeParse({ ...layout, hero: { ...layout.hero, media: 'video' } }).success).toBe(false);
    expect(SiteLayoutSchema.safeParse({ ...layout, hero: { ...layout.hero, align: 'right' } }).success).toBe(false);
    expect(SiteLayoutSchema.safeParse({ ...layout, hero: { ...layout.hero, tone: 'neon' } }).success).toBe(false);
    expect(SiteLayoutSchema.safeParse({ ...layout, density: 'dense' }).success).toBe(false);
  });

  it('keeps menu counts whole and within bounds', () => {
    expect(SiteLayoutSchema.safeParse({ ...layout, nav: { ...layout.nav, itemCount: -1 } }).success).toBe(false);
    expect(SiteLayoutSchema.safeParse({ ...layout, nav: { ...layout.nav, itemCount: 2.5 } }).success).toBe(false);
    expect(SiteLayoutSchema.safeParse({ ...layout, nav: { ...layout.nav, itemCount: 101 } }).success).toBe(false);
  });
});

describe('design spec additions (REV-104)', () => {
  it('accepts a photo behind the hero copy and the header arrangement', () => {
    expect(MvpDesignSchema.safeParse({ hero: { imageSide: 'behind' } }).success).toBe(true);
    expect(MvpDesignSchema.safeParse({ header: { layout: 'centered', links: true } }).success).toBe(true);
    expect(MvpDesignSchema.safeParse({ header: { layout: 'standard' } }).success).toBe(true);
  });

  it('rejects values outside the vocabulary', () => {
    expect(MvpDesignSchema.safeParse({ hero: { imageSide: 'top' } }).success).toBe(false);
    expect(MvpDesignSchema.safeParse({ header: { layout: 'sidebar' } }).success).toBe(false);
    expect(MvpDesignSchema.safeParse({ header: { links: 'yes' } }).success).toBe(false);
  });
});

describe('layout selection with a derived design (REV-104)', () => {
  const derived = {
    variant: 'split',
    reasons: ['rule:derived', 'hero:side-right', 'images:4'],
    design: { sectionOrder: ['gallery', 'services'], hero: { imageSide: 'right' }, header: { links: true } },
  };

  it('carries the derived design, validated like any design', () => {
    expect(MvpLayoutSelectionSchema.parse(derived)).toEqual(derived);
    expect(MvpLayoutSelectionSchema.safeParse({ ...derived, design: { hero: { imageSide: 'top' } } }).success).toBe(false);
    expect(MvpLayoutSelectionSchema.safeParse({ variant: 'bento', reasons: [] }).success).toBe(true);
  });

  it("keeps the facts and the derived design when the operator picks a layout", () => {
    expect(manualMvpLayout(derived as never, 'editorial')).toEqual({
      variant: 'editorial',
      reasons: ['rule:manual', 'hero:side-right', 'images:4'],
      design: derived.design,
    });
  });

  it('picks a layout for an MVP with no previous choice', () => {
    expect(manualMvpLayout(undefined, 'bento')).toEqual({ variant: 'bento', reasons: ['rule:manual'] });
    expect(manualMvpLayout({ reasons: null, design: null }, 'compact')).toEqual({ variant: 'compact', reasons: ['rule:manual'] });
  });

  it('keeps at most 12 reasons', () => {
    const reasons = ['rule:derived', ...Array.from({ length: 11 }, (_, i) => `fact:${i}`)];
    expect(manualMvpLayout({ reasons }, 'split').reasons).toHaveLength(12);
  });
});
