import { describe, it, expect, vi, afterEach } from 'vitest';
import { IAudit, ILead, IMvpGeneratedContent } from '@revamp/shared-types';
import { MvpCompletenessReportSchema } from '@revamp/validation';
import {
  CompletenessSource,
  MvpCompletenessService,
  bigramSimilarity,
  findPhoneInText,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  normalizeUrl,
  phonesMatch,
  tokenCoverage,
  wordsMatch,
} from '../mvp-completeness.service.js';
import { bentoTemplateService } from '../template.service.js';

const service = new MvpCompletenessService();

const emptySource = (overrides: Partial<CompletenessSource> = {}): CompletenessSource => ({
  phones: [],
  emails: [],
  services: [],
  socialLinks: [],
  images: [],
  testimonials: [],
  sourceText: '',
  ...overrides,
});

const page = (body: string, title = 'Demo') => `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const checkOf = (report: ReturnType<MvpCompletenessService['compare']>, field: string, status?: string) =>
  report.checks.find((c) => c.field === field && (status ? c.status === status : c.status !== 'unsourced'));

describe('MvpCompletenessService (REV-36)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizers', () => {
    it('normalizes phones to E.164 when a country code is present', () => {
      expect(normalizePhone('+48 22 555-12-34')).toBe('+48225551234');
      expect(normalizePhone('tel:+375(29)123-45-67')).toBe('+375291234567');
      expect(normalizePhone('0048 22 555 12 34')).toBe('+48225551234');
      expect(normalizePhone('8 (029) 123-45-67')).toBe('80291234567');
      expect(normalizePhone('12-34')).toBeUndefined();
      expect(normalizePhone('')).toBeUndefined();
      expect(normalizePhone('+1234567890123456')).toBeUndefined();
    });

    it('matches phones written in different formats', () => {
      expect(phonesMatch('+48 22 555 12 34', '(22) 555-12-34')).toBe(true);
      expect(phonesMatch('+375 29 123 45 67', '8 029 123 45 67')).toBe(true);
      expect(phonesMatch('0048225551234', '+48-22-555-1234')).toBe(true);
      expect(phonesMatch('+48 22 555 12 34', '+48 22 555 12 99')).toBe(false);
      expect(phonesMatch('1234567', '1234567')).toBe(true);
      expect(phonesMatch('1234567', '7654321')).toBe(false);
      expect(phonesMatch(undefined, '+48225551234')).toBe(false);
    });

    it('finds a known phone in text whatever the separators', () => {
      expect(findPhoneInText('8200-175', 'Call 8200-175 today')).toBe('8200-175');
      expect(findPhoneInText('8200175', 'Call 8 200 175')).toBe('8 200 175');
      expect(findPhoneInText('+48 22 555 12 34', 'Tel. (22) 555-12-34')).toBe('22) 555-12-34');
      expect(findPhoneInText('+48225551234', 'Tel. +48225551234')).toBe('225551234');
      expect(findPhoneInText('+48 22 555 12 34', 'Tel. 22 555 12 345')).toBeUndefined();
      expect(findPhoneInText('+48 22 555 12 34', 'Nothing here')).toBeUndefined();
      expect(findPhoneInText('abc', 'abc')).toBeUndefined();
    });

    it('compares emails case-insensitively and strips mailto: and query strings', () => {
      expect(normalizeEmail('MAILTO:Info@Smile.PL?subject=Hi')).toBe('info@smile.pl');
      expect(normalizeEmail('  Kontakt@Firma.com ')).toBe('kontakt@firma.com');
      expect(normalizeEmail('not-an-email')).toBeUndefined();
    });

    it('normalizes URLs to host and path', () => {
      expect(normalizeUrl('https://www.facebook.com/Smile/')).toBe('facebook.com/smile');
      expect(normalizeUrl('http://facebook.com/smile?ref=1#top')).toBe('facebook.com/smile');
      expect(normalizeUrl('https://m.facebook.com/smile')).toBe('facebook.com/smile');
      expect(normalizeUrl('not a url')).toBeUndefined();
    });

    it('keeps identifying query parameters and drops tracking ones', () => {
      expect(normalizeUrl('https://www.facebook.com/profile.php?id=123&fbclid=abc')).toBe('facebook.com/profile.php?id=123');
      expect(normalizeUrl('https://facebook.com/profile.php?id=123')).not.toBe(normalizeUrl('https://facebook.com/profile.php?id=456'));
      expect(normalizeUrl('https://instagram.com/smile/?utm_source=site&igshid=x')).toBe('instagram.com/smile');
      expect(normalizeUrl('https://x.com/p?b=2&a=1')).toBe(normalizeUrl('https://x.com/p?a=1&b=2'));
    });

    it('normalizes text across case, accents and punctuation', () => {
      expect(normalizeText('  Zdrowy   UŚMIECH!! ')).toBe('zdrowy usmiech');
      expect(normalizeText('Café, Crème')).toBe('cafe creme');
    });

    it('matches words with different endings but not different words', () => {
      expect(wordsMatch('implants', 'implant')).toBe(true);
      expect(wordsMatch('marszalkowska', 'marszalkowskiej')).toBe(true);
      expect(wordsMatch('dent', 'dentist')).toBe(false);
      expect(wordsMatch('cat', 'cats')).toBe(false);
      expect(wordsMatch('2005', '2006')).toBe(false);
      expect(wordsMatch('whitening', 'whitelist')).toBe(false);
    });

    it('measures token coverage and bigram similarity', () => {
      expect(tokenCoverage('Teeth whitening', 'Professional teeth whitening today')).toBe(1);
      expect(tokenCoverage('Teeth whitening', 'Whitening')).toBe(0.5);
      expect(tokenCoverage('', 'anything')).toBe(0);
      expect(bigramSimilarity('Root canal treatment', 'Root-canal treatment')).toBe(1);
      expect(bigramSimilarity('Dental implants', 'Dental implant')).toBeGreaterThan(0.9);
      expect(bigramSimilarity('Dental implants', 'Car repair')).toBeLessThan(0.3);
      expect(bigramSimilarity('', 'x')).toBe(0);
    });
  });

  describe('critical fields', () => {
    it('finds the phone as text and as a tel: link after normalization', () => {
      const html = page('<footer><a href="tel:+48225551234">+48 (22) 555-12-34</a></footer>');
      const report = service.compare(html, emptySource({ phones: ['22 555 12 34'] }));
      expect(checkOf(report, 'phone')).toMatchObject({ status: 'present', tier: 'critical' });
      expect(checkOf(report, 'phone', 'unsourced')).toBeUndefined();
    });

    it('flags a phone shown as text without a tel: link as altered', () => {
      const report = service.compare(page('<p>Call +48 22 555 12 34</p>'), emptySource({ phones: ['+48225551234'] }));
      expect(checkOf(report, 'phone')).toMatchObject({ status: 'altered', note: expect.stringContaining('tel:') });
    });

    it('flags a different phone number as altered and unsourced', () => {
      const html = page('<a href="tel:+48229999999">+48 22 999 99 99</a>');
      const report = service.compare(html, emptySource({ phones: ['+48 22 555 12 34'] }));
      expect(checkOf(report, 'phone')).toMatchObject({ status: 'altered', mvpValue: expect.stringContaining('999') });
      expect(checkOf(report, 'phone', 'unsourced')).toBeDefined();
      expect(report.hasCriticalIssues).toBe(true);
    });

    it('reports a missing phone', () => {
      const report = service.compare(page('<p>Hello</p>'), emptySource({ phones: ['+48225551234'] }));
      expect(checkOf(report, 'phone')?.status).toBe('missing');
      expect(report.hasCriticalIssues).toBe(true);
    });

    it('matches email case-insensitively and requires a mailto: link', () => {
      const html = page('<a href="mailto:INFO@Smile.pl">INFO@Smile.pl</a>');
      expect(checkOf(service.compare(html, emptySource({ emails: ['info@smile.pl'] })), 'email')?.status).toBe('present');

      const textOnly = service.compare(page('<p>info@smile.pl</p>'), emptySource({ emails: ['info@smile.pl'] }));
      expect(checkOf(textOnly, 'email')).toMatchObject({ status: 'altered', note: expect.stringContaining('mailto:') });

      const different = service.compare(
        page('<a href="mailto:office@smile.pl">office@smile.pl</a>'),
        emptySource({ emails: ['info@smile.pl'] }),
      );
      expect(checkOf(different, 'email')).toMatchObject({ status: 'altered', mvpValue: 'office@smile.pl' });
      expect(checkOf(different, 'email', 'unsourced')?.mvpValue).toBe('office@smile.pl');
    });

    it('does not glue text from neighbouring elements into a bogus email', () => {
      const html = page('<h1>Smile Dental</h1><a href="mailto:info@smile.pl">info@smile.pl</a>');
      const report = service.compare(html, emptySource({ emails: ['info@smile.pl'] }));
      expect(checkOf(report, 'email', 'unsourced')).toBeUndefined();
    });

    it('matches address variations (abbreviations, punctuation, order of street words)', () => {
      const source = emptySource({ address: 'ul. Marszałkowska 10, 00-001 Warszawa' });
      for (const shown of ['Marszalkowska 10, 00-001 Warszawa', 'ulica Marszałkowska 10 00-001 Warszawa', 'MARSZAŁKOWSKA 10 · WARSZAWA 00-001']) {
        const html = page(`<a href="https://www.google.com/maps/search/?q=x">${shown}</a>`);
        expect(checkOf(service.compare(html, source), 'address')?.status, shown).toBe('present');
      }
    });

    it('finds an address in plain text, and flags a different address as altered', () => {
      const source = emptySource({ address: 'Lenina 5, Minsk' });
      expect(checkOf(service.compare(page('<p>Visit us: Lenina 5, Minsk</p>'), source), 'address')?.status).toBe('present');

      const report = service.compare(page('<address>Pushkina 12, Minsk</address>'), source);
      expect(checkOf(report, 'address')?.status).toBe('altered');
      expect(checkOf(report, 'address', 'unsourced')?.mvpValue).toBe('Pushkina 12, Minsk');
    });

    it('checks the business name', () => {
      const source = emptySource({ businessName: 'Zdrowy Uśmiech' });
      expect(checkOf(service.compare(page('<h1>ZDROWY USMIECH</h1>'), source), 'businessName')?.status).toBe('present');
      expect(checkOf(service.compare(page('<h1>Other</h1>'), source), 'businessName')?.status).toBe('missing');
    });
  });

  describe('important fields', () => {
    it('matches working hours by text or by their times', () => {
      const source = emptySource({ workingHours: 'Mon-Fri 9:00-18:00' });
      expect(checkOf(service.compare(page('<p>Mon-Fri 9:00-18:00</p>'), source), 'workingHours')?.status).toBe('present');
      expect(checkOf(service.compare(page('<p>Weekdays 09.00 – 18:00</p>'), source), 'workingHours')?.status).toBe('present');

      const partial = service.compare(page('<p>Weekdays 09:00 – 17:00</p>'), source);
      expect(checkOf(partial, 'workingHours')).toMatchObject({ status: 'altered', note: expect.stringContaining('18:00') });
      expect(checkOf(service.compare(page('<p>Hi</p>'), source), 'workingHours')?.status).toBe('missing');
    });

    it('matches working hours without times by words', () => {
      const source = emptySource({ workingHours: 'Open every day' });
      expect(checkOf(service.compare(page('<p>We are open every single day</p>'), source), 'workingHours')?.status).toBe('present');
    });

    it('finds service titles by normalized or fuzzy match and lists the missing ones', () => {
      const html = page('<h3>Teeth Whitening</h3><h3>Root-canal treatment</h3><p>Dental implant placement</p>');
      const source = emptySource({ services: ['teeth whitening', 'Root canal treatment', 'Dental implants', 'Orthodontics'] });
      const check = checkOf(service.compare(html, source), 'services');
      expect(check).toMatchObject({ status: 'missing', mvpValue: '3/4', note: 'Missing: Orthodontics' });

      const all = service.compare(html, emptySource({ services: ['Teeth whitening'] }));
      expect(checkOf(all, 'services')?.status).toBe('present');
    });

    it('gives services partial credit in the score', () => {
      const html = page('<h3>Teeth whitening</h3>');
      const half = service.compare(html, emptySource({ services: ['Teeth whitening', 'Orthodontics'] }));
      const none = service.compare(html, emptySource({ services: ['Veneers', 'Orthodontics'] }));
      expect(half.score).toBe(50);
      expect(none.score).toBe(0);
    });

    it('does not treat a different profile.php?id= profile as the same link', () => {
      const html = page('<a href="https://www.facebook.com/profile.php?id=999">fb</a>');
      const source = emptySource({ socialLinks: [{ platform: 'facebook', url: 'https://www.facebook.com/profile.php?id=123' }] });
      expect(checkOf(service.compare(html, source), 'socialLinks')?.status).toBe('missing');
    });

    it('checks social links by profile URL', () => {
      const html = page('<a href="https://facebook.com/smile">fb</a>');
      const source = emptySource({
        socialLinks: [
          { platform: 'facebook', url: 'https://www.facebook.com/smile/' },
          { platform: 'instagram', url: 'https://instagram.com/smile' },
        ],
      });
      expect(checkOf(service.compare(html, source), 'socialLinks')).toMatchObject({
        status: 'missing',
        mvpValue: '1/2',
        note: 'Missing: instagram',
      });
    });
  });

  describe('informational fields', () => {
    it('checks logo, images, testimonials, rating and founding year', () => {
      const html = page(
        '<img src="https://smile.pl/logo.png"><img src="https://smile.pl/a.jpg">' +
          '<blockquote>Great service, highly recommend them to everyone!</blockquote>' +
          '<p>Rated 4,8 by our patients. Since 2005.</p>',
      );
      const report = service.compare(
        html,
        emptySource({
          logoUrl: 'https://smile.pl/logo.png',
          images: ['https://smile.pl/a.jpg', 'https://smile.pl/b.jpg'],
          testimonials: ['Great service, highly recommend them to everyone! Truly the best.'],
          rating: { value: 4.8, count: 120 },
          foundingYear: 2005,
        }),
      );
      expect(checkOf(report, 'logo')?.status).toBe('present');
      expect(checkOf(report, 'images')).toMatchObject({ status: 'present', mvpValue: '1/2' });
      expect(checkOf(report, 'testimonials')?.status).toBe('present');
      expect(checkOf(report, 'rating')?.status).toBe('present');
      expect(checkOf(report, 'foundingYear')?.status).toBe('present');
      expect(report.checks.filter((c) => c.tier === 'informational').every((c) => c.status === 'present')).toBe(true);
    });

    it('reports informational gaps without raising a critical issue', () => {
      const report = service.compare(
        page('<p>Rated 14.85</p>'),
        emptySource({ logoUrl: 'https://smile.pl/logo.png', rating: { value: 4.8 }, foundingYear: 2005 }),
      );
      expect(checkOf(report, 'logo')?.status).toBe('missing');
      expect(checkOf(report, 'rating')?.status).toBe('missing');
      expect(checkOf(report, 'foundingYear')?.status).toBe('missing');
      expect(report.hasCriticalIssues).toBe(false);
    });
  });

  describe('unsourced contact data', () => {
    it('flags phones, emails and addresses that are not on the original site', () => {
      const html = page(
        '<a href="tel:+48111222333">+48 111 222 333</a><p>Write to hello@madeup.io</p><address>Fake Street 99</address>',
      );
      const report = service.compare(html, emptySource());
      const unsourced = report.checks.filter((c) => c.status === 'unsourced');
      expect(unsourced.map((c) => c.field).sort()).toEqual(['address', 'email', 'phone']);
      expect(unsourced.every((c) => c.tier === 'critical')).toBe(true);
      expect(report.hasCriticalIssues).toBe(true);
    });

    it('treats contact data found anywhere in the original site text as sourced', () => {
      const html = page(
        '<a href="https://maps.google.com/?q=x">Modlińska 330 B, kom. 602 34 24 00</a><p>Or write to biuro@car.pl</p>',
      );
      const report = service.compare(
        html,
        emptySource({ sourceText: 'Warszawa ul. Modlińska 330 B kom. 602 34 24 00 \n Kontakt: biuro@car.pl' }),
      );
      expect(report.checks.filter((c) => c.status === 'unsourced')).toEqual([]);
    });

    it('finds a short local number shown as text', () => {
      const html = page('<a href="tel:8200175">8200-175</a>');
      expect(checkOf(service.compare(html, emptySource({ phones: ['8200-175'] })), 'phone')?.status).toBe('present');
    });

    it('reports each made-up phone once, however often it appears', () => {
      const html = page('<a href="tel:+48111222333">+48 111 222 333</a><p>+48 111-222-333</p>');
      expect(service.compare(html, emptySource()).checks.filter((c) => c.status === 'unsourced')).toHaveLength(1);
    });

    it('ignores years, date ranges and short numbers', () => {
      const html = page('<p>© 2026 Smile. Since 1998. Open 2019 - 2024. Room 12-34. Price 1500</p>');
      expect(service.compare(html, emptySource()).checks.some((c) => c.status === 'unsourced')).toBe(false);
    });
  });

  describe('scoring', () => {
    it('scores 100 and no issues when the source has no data at all', () => {
      const report = service.compare(page('<p>Hello</p>'), emptySource());
      expect(report.score).toBe(100);
      expect(report.hasCriticalIssues).toBe(false);
      expect(report.checks.every((c) => c.status === 'not_in_source')).toBe(true);
    });

    it('weights critical fields more than informational ones', () => {
      const html = page('<h1>Smile</h1>');
      const missingPhone = service.compare(html, emptySource({ businessName: 'Smile', phones: ['+48225551234'] }));
      const missingYear = service.compare(html, emptySource({ businessName: 'Smile', foundingYear: 2005 }));
      // phone (3) missing of 6 → 50; year (1) missing of 4 → 75
      expect(missingPhone.score).toBe(50);
      expect(missingYear.score).toBe(75);
    });

    it('gives altered fields half credit', () => {
      const report = service.compare(page('<p>+48 22 555 12 34</p>'), emptySource({ phones: ['+48225551234'] }));
      expect(report.score).toBe(50);
    });

    it('leaves unset values out of the checks instead of saving them as undefined', () => {
      const report = service.compare(page('<p>hi</p>'), emptySource({ phones: ['+48225551234'] }));
      const phone = checkOf(report, 'phone')!;
      expect(Object.keys(phone).sort()).toEqual(['field', 'originalValue', 'status', 'tier']);
      expect(Object.keys(checkOf(report, 'rating')!).sort()).toEqual(['field', 'status', 'tier']);
    });

    it('returns a report that passes the shared Zod schema, with long values clipped', () => {
      const longAddress = `Street ${'x'.repeat(600)} 1`;
      const report = service.compare(page('<p>hi</p>'), emptySource({ address: longAddress }), new Date('2026-09-26T10:00:00Z'));
      expect(() => MvpCompletenessReportSchema.parse(report)).not.toThrow();
      expect(checkOf(report, 'address')?.originalValue?.length).toBeLessThanOrEqual(500);
      expect(report.checkedAt).toEqual(new Date('2026-09-26T10:00:00Z'));
    });
  });

  describe('buildSource', () => {
    it('collects contacts from the audit and the lead, deduplicated', () => {
      const source = service.buildSource(
        { businessName: ' Smile ', contactPhone: '022 555 12 34', contactEmail: 'INFO@smile.pl' },
        {
          extractedContacts: {
            phone: '+48 22 555 12 34',
            email: 'info@smile.pl',
            address: ' ul. Prosta 1 ',
            socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/s' }, { platform: 'x', url: 'javascript:void(0)' }],
          },
          extractedServices: ['Whitening', 'Implants'],
          extractedContent: {
            headings: [],
            paragraphs: [],
            navItems: [],
            serviceItems: [{ title: 'whitening' }, { title: 'Veneers' }],
            testimonials: [{ text: 'ok' }, { text: 'Lovely people' }],
            images: ['https://smile.pl/a.jpg', 'data:image/png;base64,xx'],
          },
          extractedBrandTokens: { logoUrl: '<svg></svg>' } as IAudit['extractedBrandTokens'],
        },
      );
      expect(source.businessName).toBe('Smile');
      expect(source.phones).toEqual(['+48 22 555 12 34', '022 555 12 34']);
      expect(source.emails).toEqual(['info@smile.pl']);
      expect(source.address).toBe('ul. Prosta 1');
      expect(source.services).toEqual(['whitening', 'Veneers', 'Implants']);
      expect(source.socialLinks).toHaveLength(1);
      expect(source.images).toEqual(['https://smile.pl/a.jpg']);
      expect(source.testimonials).toEqual(['Lovely people']);
      // A generated monogram SVG is not the business's own logo
      expect(source.logoUrl).toBeUndefined();
      expect(source.sourceText).toContain('ul. Prosta 1');
      expect(source.sourceText).toContain('Lovely people');
    });

    it('handles a lead without an audit', () => {
      const source = service.buildSource({ businessName: 'Solo' }, null);
      expect(source).toMatchObject({ businessName: 'Solo', phones: [], emails: [], services: [] });
    });
  });

  describe('check (the deploy step)', () => {
    const lead: Partial<ILead> = {
      _id: 'lead-1',
      businessName: 'Zdrowy Uśmiech',
      domain: 'usmiech.pl',
      niche: 'dental',
      city: 'Warszawa',
      contactEmail: 'kontakt@usmiech.pl',
      originalUrl: 'https://usmiech.pl',
    };
    const audit = {
      extractedBrandTokens: {
        primaryColor: '#123456',
        secondaryColor: '#eeeeee',
        accentColor: '#123456',
        fontFamilies: [],
        logoUrl: 'https://usmiech.pl/logo.png',
      },
      extractedContacts: {
        phone: '+48 22 555 12 34',
        email: 'kontakt@usmiech.pl',
        address: 'ul. Marszałkowska 10, 00-001 Warszawa',
        workingHours: 'Pn-Pt 9:00-18:00, Sob 10:00-14:00',
        socialLinks: [{ platform: 'facebook', url: 'https://www.facebook.com/usmiech/' }],
      },
      extractedContent: {
        language: 'pl',
        headings: [],
        paragraphs: [],
        navItems: [],
        serviceItems: [{ title: 'Wybielanie zębów' }, { title: 'Leczenie kanałowe' }],
        testimonials: [{ text: 'Wspaniała obsługa, polecam każdemu!', author: 'Anna' }],
        images: ['https://usmiech.pl/img/1.jpg'],
      },
    } as unknown as Partial<IAudit>;
    const content: IMvpGeneratedContent = {
      hero: { badge: 'x', headline: 'Piękny uśmiech', subheadline: 'Sub', primaryCtaText: 'Umów', secondaryCtaText: 'Zadzwoń' },
      services: [
        { title: 'Wybielanie zębów', description: 'Opis', lucideIconName: 'Sparkles' },
        { title: 'Leczenie kanałowe', description: 'Opis', lucideIconName: 'Sparkles' },
      ],
      trustSignals: [],
      offerNotice: '',
    };

    it('finds all key data in a real Bento MVP, with nothing flagged as made up', () => {
      const html = bentoTemplateService.renderFromAudit(lead, audit, content);
      const report = service.check(html, lead, audit);

      expect(report.status).toBe('verified');
      expect(report.hasCriticalIssues).toBe(false);
      expect(report.checks.some((c) => c.status === 'unsourced')).toBe(false);
      for (const field of ['businessName', 'phone', 'email', 'address', 'workingHours', 'services', 'socialLinks']) {
        expect(checkOf(report, field)?.status, field).toBe('present');
      }
      expect(report.score).toBe(100);
    });

    it('flags an MVP rendered without the business contacts', () => {
      const html = bentoTemplateService.renderFromAudit(
        { ...lead, contactEmail: undefined },
        { ...audit, extractedContacts: { socialLinks: [] } },
        content,
      );
      const report = service.check(html, lead, audit);
      expect(report.hasCriticalIssues).toBe(true);
      expect(checkOf(report, 'phone')?.status).toBe('missing');
      expect(checkOf(report, 'address')?.status).toBe('missing');
    });

    it('returns an unverified report instead of throwing when the comparison fails', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(service, 'compare').mockImplementation(() => {
        throw new Error('boom');
      });
      const report = service.check('<html></html>', lead, audit);
      expect(report).toMatchObject({ status: 'unverified', hasCriticalIssues: false, checks: [], error: 'boom' });
      expect(report.score).toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });
});
