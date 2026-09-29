import { describe, it, expect } from 'vitest';
import type { IAudit, ILead, ISiteLayout } from '@revamp/shared-types';
import { MvpDesignSchema, MvpLayoutSelectionSchema } from '@revamp/validation';
import {
  buildLayoutSignals,
  deriveMvpLayout,
  derivedSectionOrder,
  LayoutSignals,
  selectMvpLayout,
} from '../layout-selection.service.js';

const signals = (overrides: Partial<LayoutSignals> = {}): LayoutSignals => ({
  complexity: 'SMALL_MULTI_PAGE',
  niche: 'other',
  imageCount: 0,
  hasHeroImage: false,
  serviceCount: 5,
  reviewCount: 0,
  hasAbout: false,
  paragraphCount: 2,
  ...overrides,
});

describe('selectMvpLayout (REV-54)', () => {
  it('picks the compact layout for a small brochure site', () => {
    const layout = selectMvpLayout(signals({ complexity: 'ONE_PAGE_BROCHURE', serviceCount: 4, imageCount: 8, hasHeroImage: true }));
    expect(layout.variant).toBe('compact');
    expect(layout.reasons[0]).toBe('rule:small_brochure');
    expect(layout.reasons).toContain('complexity:ONE_PAGE_BROCHURE');
  });

  it('picks compact for any site with almost nothing to list', () => {
    expect(selectMvpLayout(signals({ complexity: 'COMPLEX', serviceCount: 2, niche: 'dental', paragraphCount: 12 })).variant).toBe(
      'compact',
    );
    expect(selectMvpLayout(signals({ serviceCount: 1, imageCount: 8, hasHeroImage: true })).variant).toBe('compact');
  });

  it('does not pick compact for a brochure site with many services', () => {
    expect(selectMvpLayout(signals({ complexity: 'ONE_PAGE_BROCHURE', serviceCount: 5 })).variant).not.toBe('compact');
  });

  it('picks the image-led split layout for a visual niche with real photos', () => {
    const layout = selectMvpLayout(signals({ niche: 'restaurant', imageCount: 2, hasHeroImage: true }));
    expect(layout.variant).toBe('split');
    expect(layout.reasons).toEqual(['rule:visual_niche', 'complexity:SMALL_MULTI_PAGE', 'niche:restaurant', 'images:2', 'services:5']);
  });

  it('needs a hero photo for the split layout', () => {
    expect(selectMvpLayout(signals({ niche: 'beauty', imageCount: 6, hasHeroImage: false })).variant).not.toBe('split');
  });

  it('picks the editorial layout for expertise businesses with a lot of text, whatever their photos', () => {
    const layout = selectMvpLayout(signals({ niche: 'dental', paragraphCount: 12, imageCount: 8, hasHeroImage: true }));
    expect(layout.variant).toBe('editorial');
    expect(layout.reasons[0]).toBe('rule:professional_niche');
  });

  it('keeps Bento for expertise businesses with little text', () => {
    const layout = selectMvpLayout(signals({ niche: 'legal', paragraphCount: 3, imageCount: 8, hasHeroImage: true }));
    expect(layout.variant).toBe('bento');
    expect(layout.reasons[0]).toBe('rule:default');
  });

  it('picks split for other businesses with plenty of photos', () => {
    const layout = selectMvpLayout(signals({ niche: 'other', imageCount: 6, hasHeroImage: true }));
    expect(layout.variant).toBe('split');
    expect(layout.reasons[0]).toBe('rule:image_rich');
    expect(selectMvpLayout(signals({ niche: 'other', imageCount: 5, hasHeroImage: true })).variant).toBe('bento');
  });

  it('picks editorial for text-heavy sites with an About block and few photos', () => {
    const layout = selectMvpLayout(signals({ hasAbout: true, paragraphCount: 8, imageCount: 3 }));
    expect(layout.variant).toBe('editorial');
    expect(layout.reasons[0]).toBe('rule:text_heavy');
    expect(selectMvpLayout(signals({ hasAbout: false, paragraphCount: 12, imageCount: 0 })).variant).toBe('bento');
  });

  it('keeps Bento as the fallback', () => {
    const layout = selectMvpLayout(signals({ niche: 'other', serviceCount: 6, imageCount: 1, paragraphCount: 3 }));
    expect(layout.variant).toBe('bento');
    expect(layout.reasons[0]).toBe('rule:default');
  });

  it('is deterministic and always returns a schema-valid selection', () => {
    const input = signals({ niche: 'fitness', imageCount: 3, hasHeroImage: true });
    expect(selectMvpLayout(input)).toEqual(selectMvpLayout(input));
    expect(() => MvpLayoutSelectionSchema.parse(selectMvpLayout(input))).not.toThrow();
    expect(() => MvpLayoutSelectionSchema.parse(selectMvpLayout(signals({ niche: undefined })))).not.toThrow();
  });

  it('gives two leads with different audit profiles different layouts', () => {
    // Profiles taken from real audits: a text-heavy dental clinic and a photo-heavy shopping centre
    const clinic = selectMvpLayout(
      signals({ niche: 'dental', imageCount: 8, hasHeroImage: true, serviceCount: 6, hasAbout: true, paragraphCount: 12 }),
    );
    const mall = selectMvpLayout(
      signals({ niche: 'other', imageCount: 8, hasHeroImage: true, serviceCount: 6, hasAbout: true, paragraphCount: 3 }),
    );
    expect(clinic.variant).toBe('editorial');
    expect(mall.variant).toBe('split');
  });
});

describe('buildLayoutSignals (REV-54)', () => {
  const lead: Partial<ILead> = { businessName: 'Bistro', niche: 'restaurant', siteComplexity: 'SMALL_MULTI_PAGE' };

  it('reads the signals from the audit the template renders', () => {
    const audit: Partial<IAudit> = {
      siteComplexity: { class: 'ONE_PAGE_BROCHURE', reasons: [] },
      extractedBrandTokens: { logoUrl: 'https://bistro.example/logo.png' } as IAudit['extractedBrandTokens'],
      extractedContent: {
        headings: [],
        paragraphs: ['a', 'b', 'c'],
        serviceItems: Array.from({ length: 9 }, (_, i) => ({ title: `Dish ${i}` })),
        navItems: [],
        testimonials: [{ text: 'Great!' }, { text: 'ok' }],
        images: ['https://bistro.example/1.jpg', 'data:image/png;base64,xx', 'https://bistro.example/2.jpg'],
        ogImage: 'https://bistro.example/logo.png',
      },
    };

    expect(buildLayoutSignals(lead, audit)).toEqual({
      complexity: 'ONE_PAGE_BROCHURE',
      niche: 'restaurant',
      imageCount: 2,
      hasHeroImage: true,
      serviceCount: 6,
      reviewCount: 1,
      hasAbout: false,
      paragraphCount: 3,
    });
  });

  it('counts the generated services and About block when there is copy', () => {
    const result = buildLayoutSignals(lead, { extractedContent: undefined }, {
      services: [{ title: 'A', description: 'a' }, { title: 'B', description: 'b' }],
      about: { heading: 'About', body: 'Body' },
    });
    expect(result.serviceCount).toBe(2);
    expect(result.hasAbout).toBe(true);
    // Falls back to the lead's complexity class when the audit has none
    expect(result.complexity).toBe('SMALL_MULTI_PAGE');
  });

  it('treats a missing audit as unknown with nothing to show', () => {
    expect(buildLayoutSignals({})).toEqual({
      complexity: 'UNKNOWN',
      niche: undefined,
      imageCount: 0,
      hasHeroImage: false,
      serviceCount: 0,
      reviewCount: 0,
      hasAbout: false,
      paragraphCount: 0,
    });
  });
});

const site = (overrides: Partial<ISiteLayout> = {}): ISiteLayout => ({
  sections: [{ kind: 'services' }, { kind: 'reviews' }, { kind: 'contact' }],
  hero: { media: 'none', align: 'center', tone: 'light' },
  nav: { itemCount: 5, centeredLogo: false, sticky: true, hasCta: true },
  density: 'comfortable',
  ...overrides,
});

describe('derivedSectionOrder (REV-104)', () => {
  it('follows the original order, mapping each kind to the MVP section that carries it', () => {
    expect(
      derivedSectionOrder(
        site({
          sections: [
            { kind: 'gallery' },
            { kind: 'pricing' },
            { kind: 'team' },
            { kind: 'faq' },
            { kind: 'services' },
            { kind: 'reviews' },
            { kind: 'about' },
            { kind: 'map' },
          ],
        }),
      ),
    ).toEqual(['gallery', 'services', 'about', 'reviews']);
    expect(derivedSectionOrder(site({ sections: [{ kind: 'contact' }, { kind: 'other' }] }))).toEqual([]);
  });
});

describe('deriveMvpLayout (REV-104)', () => {
  it('falls back to the rule-based choice, marked, when the original layout was not read', () => {
    const layout = deriveMvpLayout(undefined, signals({ niche: 'restaurant', imageCount: 2, hasHeroImage: true }));
    expect(layout.variant).toBe(selectMvpLayout(signals({ niche: 'restaurant', imageCount: 2, hasHeroImage: true })).variant);
    expect(layout.reasons[0]).toBe('rule:visual_niche');
    expect(layout.reasons).toContain('site_layout:unread');
    expect(layout.design).toBeUndefined();
  });

  it('follows a photo beside the headline with the split layout, on the same side', () => {
    const layout = deriveMvpLayout(
      site({ hero: { media: 'side', mediaSide: 'left', align: 'left', tone: 'light' } }),
      signals({ hasHeroImage: true, imageCount: 3 }),
    );
    expect(layout.variant).toBe('split');
    expect(layout.design?.hero).toEqual({ imageSide: 'left' });
    expect(layout.reasons[0]).toBe('rule:derived');
    expect(layout.reasons).toContain('hero:side-left');
  });

  it('puts a full-screen photo or a slider behind the copy', () => {
    for (const media of ['background', 'slider'] as const) {
      const layout = deriveMvpLayout(site({ hero: { media, align: 'center', tone: 'dark' } }), signals({ hasHeroImage: true, imageCount: 5 }));
      expect(layout.variant).toBe('split');
      expect(layout.design?.hero).toEqual({ imageSide: 'behind', align: 'center' });
      // The backdrop brings its own dark wash; no hero style on top
      expect(layout.design?.theme?.heroStyle).toBeUndefined();
    }
  });

  it('needs a real photo for an image-led hero', () => {
    const layout = deriveMvpLayout(site({ hero: { media: 'side', mediaSide: 'right', align: 'left', tone: 'light' } }), signals({ hasHeroImage: false }));
    expect(layout.variant).not.toBe('split');
  });

  it('keeps a small brochure compact, whatever its hero', () => {
    const layout = deriveMvpLayout(
      site({ hero: { media: 'side', mediaSide: 'right', align: 'left', tone: 'dark' } }),
      signals({ complexity: 'ONE_PAGE_BROCHURE', serviceCount: 3, hasHeroImage: true, imageCount: 4 }),
    );
    expect(layout.variant).toBe('compact');
    // The compact hero is dark already
    expect(layout.design?.theme?.heroStyle).toBeUndefined();
  });

  it('follows a left-aligned text hero with the editorial layout on a text-led site, else Bento', () => {
    const left = site({ hero: { media: 'none', align: 'left', tone: 'light' } });
    expect(deriveMvpLayout(left, signals({ paragraphCount: 8 })).variant).toBe('editorial');
    expect(deriveMvpLayout(left, signals({ niche: 'legal', paragraphCount: 1 })).variant).toBe('editorial');
    const bento = deriveMvpLayout(left, signals({ paragraphCount: 2 }));
    expect(bento.variant).toBe('bento');
    expect(bento.design?.hero).toEqual({ align: 'left' });
    expect(deriveMvpLayout(site(), signals({ paragraphCount: 12 })).variant).toBe('bento');
  });

  it('carries the section order, hero tone, header and density into the design spec', () => {
    const layout = deriveMvpLayout(
      site({
        sections: [{ kind: 'reviews' }, { kind: 'gallery' }, { kind: 'services' }],
        hero: { media: 'none', align: 'center', tone: 'brand' },
        nav: { itemCount: 6, centeredLogo: true, sticky: false, hasCta: false },
        density: 'airy',
      }),
      signals(),
    );
    expect(layout.design).toEqual({
      sectionOrder: ['reviews', 'gallery', 'services'],
      hero: { align: 'center' },
      theme: { density: 'airy', heroStyle: 'brand' },
      header: { layout: 'centered', links: true },
    });
    expect(MvpDesignSchema.safeParse(layout.design).success).toBe(true);
    expect(MvpLayoutSelectionSchema.safeParse(layout).success).toBe(true);
    expect(layout.reasons).toEqual(expect.arrayContaining(['order:reviews>gallery>services', 'nav:6-centered', 'density:airy', 'hero_tone:brand']));
    expect(layout.reasons.length).toBeLessThanOrEqual(12);
  });

  it('leaves out what matches the template: a light hero, comfortable spacing, a short menu', () => {
    const layout = deriveMvpLayout(site({ nav: { itemCount: 2, centeredLogo: false, sticky: false, hasCta: false } }), signals());
    expect(layout.design?.theme).toBeUndefined();
    expect(layout.design?.header).toBeUndefined();
  });

  it('gives two sites with different layouts different MVP layouts, and one site the same one every time', () => {
    const first = site({ sections: [{ kind: 'services' }, { kind: 'about' }], hero: { media: 'side', mediaSide: 'right', align: 'left', tone: 'light' } });
    const second = site({ sections: [{ kind: 'about' }, { kind: 'reviews' }, { kind: 'services' }], density: 'compact' });
    const facts = signals({ hasHeroImage: true, imageCount: 3 });
    expect(deriveMvpLayout(first, facts)).not.toEqual(deriveMvpLayout(second, facts));
    expect(deriveMvpLayout(first, facts)).toEqual(deriveMvpLayout(structuredClone(first), { ...facts }));
  });

  it('keeps long section orders within the reason length limit', () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({ kind: (['services', 'reviews', 'gallery', 'about'] as const)[i % 4] }));
    const layout = deriveMvpLayout(site({ sections }), signals());
    expect(layout.reasons.every((reason) => reason.length <= 60)).toBe(true);
  });
});
