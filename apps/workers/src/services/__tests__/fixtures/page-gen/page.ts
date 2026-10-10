import { readFileSync } from 'node:fs';
import type { IMvpSourceBrief } from '@revamp/shared-types';

/** A model-written page that passes every check (REV-136) */
export const VALID = readFileSync(new URL('./valid-page.html', import.meta.url), 'utf8');

/** The brief `VALID` was written for */
export const BRIEF: IMvpSourceBrief = {
  business: { name: 'Falco-Dent', niche: 'DENTAL', city: 'Kraków', originalUrl: 'https://falco-dent.pl' },
  language: 'pl-PL',
  services: ['Implanty', 'Ortodoncja'],
  copy: { headings: ['Usługi'], paragraphs: ['Leczymy z troską.'], serviceItems: [], testimonials: [] },
  brand: { primary: '#0a5c8a', secondary: '#ffffff', accent: '#f2a900', fonts: [], logoUrl: 'https://falco-dent.pl/logo.png' },
  images: ['https://falco-dent.pl/a.jpg', 'https://falco-dent.pl/b.jpg', 'https://falco-dent.pl/b@2x.jpg'],
  placeholders: ['phone', 'address', 'booking'],
};
