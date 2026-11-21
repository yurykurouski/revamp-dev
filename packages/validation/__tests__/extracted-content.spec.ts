import { describe, expect, it } from 'vitest';
import { ExtractedContactsSchema, SiteContentSchema } from '../src/index.js';

const content = {
  language: 'pl-PL',
  languageSource: 'html',
  title: 'Klinika',
  headings: ['Usługi'],
  paragraphs: ['Tekst'],
  serviceItems: [{ title: 'Implanty', description: 'Opis' }, { title: 'Wybielanie' }],
  navItems: ['Start'],
  testimonials: [{ text: 'Super', author: 'Anna' }, { text: 'OK' }],
  images: ['https://a.test/1.jpg'],
  rating: { value: 4.8, count: 120 },
  foundingYear: 1998,
};

describe('ExtractedContactsSchema (REV-200)', () => {
  it('accepts full and minimal contacts', () => {
    expect(ExtractedContactsSchema.safeParse({ phone: '+48 1', email: 'a@b.test', address: 'X 1', workingHours: '9-17', socialLinks: [{ platform: 'facebook', url: 'https://f.test/x' }] }).success).toBe(true);
    expect(ExtractedContactsSchema.safeParse({ socialLinks: [] }).success).toBe(true);
    expect(ExtractedContactsSchema.safeParse({ phone: undefined, socialLinks: [] }).success).toBe(true);
  });

  it('refuses contacts without socialLinks or with a malformed link', () => {
    expect(ExtractedContactsSchema.safeParse({}).success).toBe(false);
    expect(ExtractedContactsSchema.safeParse({ socialLinks: 'x' }).success).toBe(false);
    expect(ExtractedContactsSchema.safeParse({ socialLinks: [{ platform: 'x' }] }).success).toBe(false);
    expect(ExtractedContactsSchema.safeParse({ phone: 123, socialLinks: [] }).success).toBe(false);
  });
});

describe('SiteContentSchema (REV-200)', () => {
  it('accepts full content and the minimal shape', () => {
    expect(SiteContentSchema.safeParse(content).error).toBeUndefined();
    expect(SiteContentSchema.safeParse({ headings: [], paragraphs: [], serviceItems: [], navItems: [], testimonials: [], images: [] }).success).toBe(true);
  });

  it('refuses a wrong language source, a text rating and a missing list', () => {
    expect(SiteContentSchema.safeParse({ ...content, languageSource: 'guess' }).success).toBe(false);
    expect(SiteContentSchema.safeParse({ ...content, rating: { value: '4.8' } }).success).toBe(false);
    expect(SiteContentSchema.safeParse({ ...content, images: undefined }).success).toBe(false);
  });
});
