import { describe, expect, it } from 'vitest';
import type { IStandardsChecks } from '@revamp/shared-types';
import { MvpSeoSchema } from '@revamp/validation';
import { buildMvpSeo, clipDescription, MvpSeoInput, ogLocale, SEO_DESCRIPTION_MAX } from '../mvp-seo.js';

const base = (over: Partial<MvpSeoInput> = {}): MvpSeoInput => ({
  businessName: 'Falco-Dent',
  language: 'pl',
  site: { metaDescription: 'Stomatologia estetyczna w Warszawie.', paragraphs: [], ogImage: 'https://falcodent.pl/og.jpg' },
  contacts: { phone: '+48 510 510 706', email: 'recepcja@falcodent.pl', address: 'ul. Kasprowicza 1, Warszawa' },
  socialLinks: [{ url: 'https://facebook.com/falcodent' }],
  originalUrl: 'https://falcodent.pl/',
  ...over,
});

const ALL_FAILED: IStandardsChecks = {
  https: false, viewport: false, title: false, metaDescription: false, singleH1: false, favicon: false, structuredData: false, openGraph: false,
};

describe('clipDescription (REV-118)', () => {
  it('keeps a short text, squashing its whitespace', () => {
    expect(clipDescription('  Dental   care\nin Wrocław ')).toBe('Dental care in Wrocław');
  });

  it('cuts a long text at a word boundary within the limit and marks the cut', () => {
    const long = 'Lorem ipsum dolor sit amet, '.repeat(10);
    const clipped = clipDescription(long);
    expect(clipped.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).not.toMatch(/[,\s]…$/);
    expect(long.startsWith(clipped.slice(0, -1))).toBe(true);
  });

  it('cuts a single long word at the limit', () => {
    expect(clipDescription('x'.repeat(400))).toHaveLength(SEO_DESCRIPTION_MAX);
  });
});

describe('ogLocale (REV-118)', () => {
  it('uses the region of the language tag', () => {
    expect(ogLocale('pl-PL')).toBe('pl_PL');
    expect(ogLocale('en-GB')).toBe('en_GB');
    expect(ogLocale('RU-by')).toBe('ru_BY');
  });

  it('names the one country of a single-region language, and nothing for the others', () => {
    expect(ogLocale('pl')).toBe('pl_PL');
    expect(ogLocale('lt')).toBe('lt_LT');
    expect(ogLocale('be')).toBe('be_BY');
    expect(ogLocale('en')).toBeUndefined();
    expect(ogLocale('ru')).toBeUndefined();
    expect(ogLocale(undefined)).toBeUndefined();
    expect(ogLocale('')).toBeUndefined();
  });
});

describe('buildMvpSeo (REV-118)', () => {
  it('copies the original description, og:image and the verified contacts, and validates', () => {
    const { seo } = buildMvpSeo(base());
    expect(seo).toEqual({
      description: 'Stomatologia estetyczna w Warszawie.',
      image: 'https://falcodent.pl/og.jpg',
      locale: 'pl_PL',
      localBusiness: {
        name: 'Falco-Dent',
        url: 'https://falcodent.pl/',
        telephone: '+48 510 510 706',
        email: 'recepcja@falcodent.pl',
        address: 'ul. Kasprowicza 1, Warszawa',
        image: 'https://falcodent.pl/og.jpg',
        sameAs: ['https://facebook.com/falcodent'],
      },
    });
    expect(() => MvpSeoSchema.parse(seo)).not.toThrow();
  });

  it('describes the page by its first paragraph long enough when the original has no description', () => {
    const paragraph = 'Nowoczesny gabinet stomatologiczny w centrum Warszawy, czynny od poniedziałku do soboty.';
    const { seo } = buildMvpSeo(base({ site: { paragraphs: ['Witamy!', paragraph], metaDescription: '  ' } }));
    expect(seo.description).toBe(paragraph);
  });

  it('leaves out every tag whose source is missing, never inventing one', () => {
    const { seo } = buildMvpSeo({ businessName: 'Falco-Dent', contacts: {}, socialLinks: [] });
    expect(seo).toEqual({ localBusiness: { name: 'Falco-Dent', sameAs: [] } });
  });

  it('takes the page photo, then the logo, when the original has no og:image', () => {
    expect(buildMvpSeo(base({ site: { paragraphs: [] }, photo: 'https://x.pl/p.jpg', logoUrl: 'https://x.pl/l.png' })).seo.image).toBe('https://x.pl/p.jpg');
    expect(buildMvpSeo(base({ site: { paragraphs: [] }, logoUrl: 'https://x.pl/l.png' })).seo.image).toBe('https://x.pl/l.png');
    expect(buildMvpSeo(base({ site: { paragraphs: [], ogImage: 'data:image/png;base64,AA' } })).seo.image).toBeUndefined();
  });

  it('drops an invalid email, a non-http original URL and social links, and repeated profiles', () => {
    const { seo } = buildMvpSeo(
      base({
        contacts: { email: 'not an email' },
        originalUrl: 'ftp://falcodent.pl',
        socialLinks: [{ url: 'https://facebook.com/falcodent' }, { url: 'https://facebook.com/falcodent' }, { url: 'javascript:alert(1)' }],
      }),
    );
    expect(seo.localBusiness).toEqual({ name: 'Falco-Dent', image: 'https://falcodent.pl/og.jpg', sameAs: ['https://facebook.com/falcodent'] });
  });

  it('records a tag as added only when the audit found the original without it', () => {
    expect(buildMvpSeo(base({ original: ALL_FAILED })).codes).toEqual(['seo:description', 'seo:og', 'seo:jsonld']);
    expect(buildMvpSeo(base({ original: { ...ALL_FAILED, metaDescription: true, openGraph: true, structuredData: true } })).codes).toEqual([]);
    // Not measured: nothing is claimed
    expect(buildMvpSeo(base()).codes).toEqual([]);
    // No description to add: none is recorded
    expect(buildMvpSeo(base({ site: { paragraphs: [] }, original: ALL_FAILED })).codes).toEqual(['seo:og', 'seo:jsonld']);
  });
});
