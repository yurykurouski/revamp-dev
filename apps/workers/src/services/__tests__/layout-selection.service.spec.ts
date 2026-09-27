import { describe, it, expect } from 'vitest';
import type { IAudit, ILead } from '@revamp/shared-types';
import { MvpLayoutSelectionSchema } from '@revamp/validation';
import { buildLayoutSignals, LayoutSignals, selectMvpLayout } from '../layout-selection.service.js';

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
