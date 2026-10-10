import { describe, expect, it } from 'vitest';
import type { IAudit, ILead } from '@revamp/shared-types';
import { buildMvpSourceBrief, verifiedContacts } from '../mvp-source-brief.js';

type BriefAudit = Parameters<typeof buildMvpSourceBrief>[0];
type BriefLead = Parameters<typeof buildMvpSourceBrief>[1];

const PHONE = '+48 600 100 200';
const EMAIL = 'kontakt@falco-dent.pl';
const ADDRESS = 'ul. Długa 5, 31-147 Kraków';
const HOURS = 'Pn–Pt 9:00–18:00';

const audit = (over: Partial<IAudit> = {}): BriefAudit => ({
  extractedContacts: { phone: PHONE, email: EMAIL, address: ADDRESS, workingHours: HOURS, socialLinks: [] },
  extractedServices: ['Implanty', 'Ortodoncja'],
  extractedBrandTokens: {
    primaryColor: '#0a5c8a',
    secondaryColor: '#ffffff',
    accentColor: '#f2a900',
    fontFamilies: ['Lato'],
    logoUrl: 'https://falco-dent.pl/logo.png',
  },
  extractedContent: {
    language: 'pl',
    title: 'Falco-Dent',
    metaDescription: 'Gabinet stomatologiczny',
    h1: 'Twój uśmiech',
    headings: ['Usługi'],
    paragraphs: ['Leczymy z troską.'],
    serviceItems: [{ title: 'Implanty', description: 'Trwałe' }],
    navItems: ['Start'],
    testimonials: [{ text: 'Polecam', author: 'Anna' }],
    images: ['https://falco-dent.pl/a.jpg', 'https://falco-dent.pl/logo.png'],
    rating: { value: 4.9, count: 120 },
    foundingYear: 2004,
  },
  ...over,
});

const lead = (over: Partial<ILead> = {}): BriefLead => ({
  businessName: 'Falco-Dent',
  niche: 'DENTAL',
  city: 'Kraków',
  originalUrl: 'https://falco-dent.pl',
  ...over,
});

describe('buildMvpSourceBrief (REV-136)', () => {
  it('carries the business, language, services, copy, brand and images', () => {
    const brief = buildMvpSourceBrief(audit(), lead());
    expect(brief.business).toEqual({ name: 'Falco-Dent', niche: 'DENTAL', city: 'Kraków', originalUrl: 'https://falco-dent.pl' });
    expect(brief.language).toBe('pl');
    expect(brief.services).toEqual(['Implanty', 'Ortodoncja']);
    expect(brief.copy).toMatchObject({ h1: 'Twój uśmiech', headings: ['Usługi'], rating: { value: 4.9, count: 120 }, foundingYear: 2004 });
    expect(brief.brand).toEqual({
      primary: '#0a5c8a',
      secondary: '#ffffff',
      accent: '#f2a900',
      fonts: ['Lato'],
      logoUrl: 'https://falco-dent.pl/logo.png',
    });
    expect(brief.placeholders).toEqual(['phone', 'email', 'address', 'hours', 'booking']);
  });

  it('never carries a contact value', () => {
    const json = JSON.stringify(buildMvpSourceBrief(audit(), lead()));
    for (const value of [PHONE, EMAIL, ADDRESS, HOURS]) expect(json).not.toContain(value);
  });

  it('takes phone and email from the lead when the site had none', () => {
    const brief = buildMvpSourceBrief(
      audit({ extractedContacts: { socialLinks: [] } }),
      lead({ contactPhone: PHONE, contactEmail: EMAIL }),
    );
    expect(brief.placeholders).toEqual(['phone', 'email', 'booking']);
  });

  it('offers only the booking placeholder when no contact is verified', () => {
    const brief = buildMvpSourceBrief(audit({ extractedContacts: { phone: '  ', socialLinks: [] } }), lead());
    expect(brief.placeholders).toEqual(['booking']);
  });

  it('deduplicates services and caps them at 30', () => {
    const services = ['Implanty', ' implanty ', ...Array.from({ length: 48 }, (_, i) => `Usługa ${i}`)];
    const brief = buildMvpSourceBrief(audit({ extractedServices: services }), lead());
    expect(brief.services).toHaveLength(30);
    expect(brief.services.filter((s) => s.toLowerCase().trim() === 'implanty')).toHaveLength(1);
  });

  it('keeps whole paragraphs up to the copy cap and drops the rest', () => {
    const paragraph = 'a'.repeat(1000);
    const paragraphs = Array.from({ length: 20 }, (_, i) => `${i} ${paragraph}`);
    const content = { ...audit().extractedContent!, headings: [], serviceItems: [], testimonials: [], paragraphs };
    const brief = buildMvpSourceBrief(audit({ extractedContent: content }), lead());
    expect(brief.copy.paragraphs.length).toBeGreaterThan(0);
    expect(brief.copy.paragraphs.length).toBeLessThan(20);
    expect(brief.copy.paragraphs.every((p) => paragraphs.includes(p))).toBe(true);
    expect(brief.copy.paragraphs.join('').length).toBeLessThanOrEqual(12_000);
  });

  it('leaves the logo out of the image list', () => {
    expect(buildMvpSourceBrief(audit(), lead()).images).toEqual(['https://falco-dent.pl/a.jpg']);
  });

  it('drops relative image URLs and texts longer than the brief takes, instead of failing', () => {
    const content = { ...audit().extractedContent!, images: ['/img/a.jpg', 'https://falco-dent.pl/b.jpg'], paragraphs: ['x'.repeat(4001), 'Krótki.'] };
    const brief = buildMvpSourceBrief(audit({ extractedContent: content }), lead());
    expect(brief.images).toEqual(['https://falco-dent.pl/b.jpg']);
    expect(brief.copy.paragraphs).toEqual(['Krótki.']);
  });

  it('drops a too-long service, font or author and accepts empty brand colors, instead of failing', () => {
    const content = { ...audit().extractedContent!, testimonials: [{ text: 'Polecam', author: 'A'.repeat(201) }] };
    const brief = buildMvpSourceBrief(
      audit({
        extractedServices: ['S'.repeat(201), 'Implanty'],
        extractedContent: content,
        extractedBrandTokens: { primaryColor: '', secondaryColor: '', accentColor: '', fontFamilies: ['F'.repeat(101), 'Lato'] },
      }),
      lead(),
    );
    expect(brief.services).toEqual(['Implanty']);
    expect(brief.brand.fonts).toEqual(['Lato']);
    expect(brief.copy.testimonials).toEqual([{ text: 'Polecam' }]);
  });

  it('leaves out copy that carries a contact, so no contact reaches the model (review, REV-137)', () => {
    const content = {
      ...audit().extractedContent!,
      headings: ['Usługi', 'Napisz: biuro@falco-dent.pl'],
      paragraphs: ['Leczymy z troską.', 'Zadzwoń 600 100 200 i umów wizytę.', `Zapraszamy: ${ADDRESS}.`, 'NIP 677-123-45-67'],
      testimonials: [{ text: 'Polecam, tel. +48 600 100 200' }, { text: 'Super!' }],
      metaDescription: 'Dentysta Kraków, tel. 600 100 200',
    };
    const brief = buildMvpSourceBrief(audit({ extractedContent: content }), lead());
    expect(brief.copy.headings).toEqual(['Usługi']);
    expect(brief.copy.paragraphs).toEqual(['Leczymy z troską.', 'NIP 677-123-45-67']);
    expect(brief.copy.testimonials).toEqual([{ text: 'Super!' }]);
    expect(brief.copy.metaDescription).toBeUndefined();
  });

  it('builds an empty copy and no language when the content was not extracted', () => {
    const brief = buildMvpSourceBrief(audit({ extractedContent: undefined }), lead());
    expect(brief.language).toBeUndefined();
    expect(brief.copy).toEqual({ headings: [], paragraphs: [], serviceItems: [], testimonials: [] });
    expect(brief.images).toEqual([]);
  });
});

describe('verifiedContacts (REV-136)', () => {
  it('prefers the site, then the lead, and maps working hours', () => {
    expect(verifiedContacts(audit(), lead({ contactPhone: '+48 111 222 333' }))).toEqual({
      phone: PHONE,
      email: EMAIL,
      address: ADDRESS,
      hours: HOURS,
    });
  });
});
