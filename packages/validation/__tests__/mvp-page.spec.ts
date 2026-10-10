import { describe, it, expect } from 'vitest';
import {
  MvpGroundingFlagSchema,
  MvpPageFailureSchema,
  MvpSourceBriefSchema,
  MvpThemeControlsSchema,
  MvpThemeSchema,
} from '../src/index.js';

const fullBrief = {
  business: { name: 'Falco-Dent', niche: 'DENTAL', city: 'Kraków', originalUrl: 'https://falco-dent.pl' },
  language: 'pl',
  services: ['Implanty', 'Ortodoncja'],
  copy: {
    title: 'Falco-Dent – stomatologia',
    metaDescription: 'Gabinet stomatologiczny w Krakowie',
    h1: 'Twój uśmiech, nasza pasja',
    headings: ['Usługi', 'O nas'],
    paragraphs: ['Leczymy z troską.'],
    serviceItems: [{ title: 'Implanty', description: 'Trwałe uzupełnienia' }],
    testimonials: [{ text: 'Polecam!', author: 'Anna' }],
    rating: { value: 4.9, count: 120 },
    foundingYear: 2004,
  },
  brand: { primary: '#0a5c8a', secondary: '#ffffff', accent: '#f2a900', fonts: ['Lato'], logoUrl: 'https://falco-dent.pl/logo.png' },
  images: ['https://falco-dent.pl/a.jpg'],
  placeholders: ['phone', 'email', 'booking'],
};

const minimalBrief = {
  business: { name: 'Falco-Dent', niche: 'DENTAL', originalUrl: 'https://falco-dent.pl' },
  services: [],
  copy: { headings: [], paragraphs: [], serviceItems: [], testimonials: [] },
  brand: { primary: '#0a5c8a', secondary: '#ffffff', accent: '#f2a900', fonts: [] },
  images: [],
  placeholders: ['booking'],
};

const theme = {
  primary: '#0a5c8a',
  accent: '#f2a900',
  bg: '#ffffff',
  surface: '#f5f7fa',
  text: '#111111',
  fontHeading: '"DM Serif Display", serif',
  fontBody: 'Inter, sans-serif',
};

describe('MvpSourceBriefSchema (REV-136)', () => {
  it('accepts a full brief', () => {
    expect(MvpSourceBriefSchema.safeParse(fullBrief).success).toBe(true);
  });

  it('accepts a minimal brief with no language and only the booking placeholder', () => {
    expect(MvpSourceBriefSchema.safeParse(minimalBrief).success).toBe(true);
  });

  it('rejects an unknown placeholder', () => {
    expect(MvpSourceBriefSchema.safeParse({ ...fullBrief, placeholders: ['fax'] }).success).toBe(false);
  });

  it('rejects more than 30 services', () => {
    const services = Array.from({ length: 31 }, (_, i) => `Service ${i}`);
    expect(MvpSourceBriefSchema.safeParse({ ...fullBrief, services }).success).toBe(false);
  });

  it('rejects more than 24 images', () => {
    const images = Array.from({ length: 25 }, (_, i) => `https://falco-dent.pl/${i}.jpg`);
    expect(MvpSourceBriefSchema.safeParse({ ...fullBrief, images }).success).toBe(false);
  });

  it('rejects contact values smuggled in as an extra key', () => {
    expect(MvpSourceBriefSchema.safeParse({ ...fullBrief, contacts: { phone: '+48 600 100 200' } }).success).toBe(false);
  });
});

describe('MvpThemeSchema / MvpThemeControlsSchema (REV-136)', () => {
  it('accepts a full theme with font stacks', () => {
    expect(MvpThemeSchema.safeParse(theme).success).toBe(true);
  });

  it('rejects a theme without the body font', () => {
    expect(MvpThemeSchema.safeParse({ ...theme, fontBody: undefined }).success).toBe(false);
  });

  it('accepts empty controls and a single color', () => {
    expect(MvpThemeControlsSchema.safeParse({}).success).toBe(true);
    expect(MvpThemeControlsSchema.safeParse({ primary: '#112233' }).success).toBe(true);
  });

  it('rejects a color control that is not #rrggbb', () => {
    expect(MvpThemeControlsSchema.safeParse({ primary: 'red' }).success).toBe(false);
  });

  it('rejects a font control that could break out of CSS', () => {
    expect(MvpThemeControlsSchema.safeParse({ fontHeading: 'Inter; }' }).success).toBe(false);
  });
});

describe('MvpGroundingFlagSchema (REV-136)', () => {
  it('accepts a number flag and rejects an unknown kind', () => {
    expect(MvpGroundingFlagSchema.safeParse({ kind: 'number', text: '15', context: 'Ponad 15 lat' }).success).toBe(true);
    expect(MvpGroundingFlagSchema.safeParse({ kind: 'date', text: '15', context: 'x' }).success).toBe(false);
  });
});

describe('MvpPageFailureSchema (REV-137)', () => {
  it('accepts the three failure codes and rejects others', () => {
    for (const code of ['not_configured', 'call_failed', 'invalid_page']) expect(MvpPageFailureSchema.safeParse(code).success).toBe(true);
    expect(MvpPageFailureSchema.safeParse('timeout').success).toBe(false);
  });
});
