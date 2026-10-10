import { describe, it, expect } from 'vitest';
import {
  MvpGroundingFlagSchema,
  MvpPageFailureSchema,
  MvpPageVersionSchema,
  MvpRenderFailureSchema,
  MvpSourceBriefSchema,
  MvpThemeControlsSchema,
  MvpThemeSchema,
  MvpVersionParamsSchema,
  UpdateMvpTokensSchema,
  contrastRatio,
} from '../src/index.js';
import { AUDIT_MEASUREMENTS, MVP_FONT_CHOICES } from '@revamp/shared-types';

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

describe('page failure and versions (REV-138)', () => {
  it('records a page the model could not make as a render failure', () => {
    const at = new Date('2026-10-10T10:00:00Z');
    expect(MvpRenderFailureSchema.safeParse({ code: 'MVP_PAGE_UNAVAILABLE', reason: 'invalid_page', message: 'rejected twice', at }).success).toBe(true);
    expect(MvpRenderFailureSchema.safeParse({ code: 'MVP_PAGE_UNAVAILABLE', reason: 'grouping:call_failed', at }).success).toBe(false);
  });

  it('accepts a page version and rejects an unknown kind or number 0', () => {
    const version = { n: 1, kind: 'generate', jobId: '42', provider: 'claude-cli', model: 'sonnet', storagePath: 'v/s/versions/1.html', createdAt: '2026-10-10T10:00:00Z' };
    expect(MvpPageVersionSchema.safeParse(version).success).toBe(true);
    expect(MvpPageVersionSchema.safeParse({ ...version, instruction: 'Make the hero darker', kind: 'change' }).success).toBe(true);
    expect(MvpPageVersionSchema.safeParse({ ...version, kind: 'edit' }).success).toBe(false);
    expect(MvpPageVersionSchema.safeParse({ ...version, n: 0 }).success).toBe(false);
  });
});

describe('changes, controls and restore (REV-139)', () => {
  const colors = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#ffffff', text: '#767676' };

  it('measures WCAG contrast at the AA boundary', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('accepts colors whose text reads on the background and the surface', () => {
    expect(UpdateMvpTokensSchema.safeParse({ colors }).success).toBe(true);
  });

  it('rejects text below 4.5:1 on the background, at colors.text', () => {
    const result = UpdateMvpTokensSchema.safeParse({ colors: { ...colors, text: '#777777' } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['colors', 'text']);
  });

  it('rejects text below 4.5:1 on the surface', () => {
    const result = UpdateMvpTokensSchema.safeParse({ colors: { ...colors, text: '#111111', surface: '#555555' } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['colors', 'text']);
  });

  it('accepts only a listed font pairing', () => {
    expect(UpdateMvpTokensSchema.safeParse({ fonts: { heading: 'Lora', body: 'Lato' } }).success).toBe(true);
    const off = UpdateMvpTokensSchema.safeParse({ fonts: { heading: 'Lora', body: 'Inter' } });
    expect(off.success).toBe(false);
    expect(off.error?.issues[0]?.path).toEqual(['fonts']);
  });

  it('takes null to clear a group, needs at least one group and refuses the old body', () => {
    expect(UpdateMvpTokensSchema.safeParse({ colors: null }).success).toBe(true);
    expect(UpdateMvpTokensSchema.safeParse({ fonts: null }).success).toBe(true);
    expect(UpdateMvpTokensSchema.safeParse({}).success).toBe(false);
    expect(UpdateMvpTokensSchema.safeParse({ primaryColor: '#000000' }).success).toBe(false);
    expect(UpdateMvpTokensSchema.safeParse({ colors: { ...colors, text: 'red' } }).success).toBe(false);
  });

  it('lists font pairings whose names are safe in CSS', () => {
    expect(MVP_FONT_CHOICES.length).toBe(6);
    for (const choice of MVP_FONT_CHOICES) {
      expect(choice.heading).toMatch(/^[A-Za-z0-9 ]{1,40}$/);
      expect(choice.body).toMatch(/^[A-Za-z0-9 ]{1,40}$/);
    }
    expect(new Set(MVP_FONT_CHOICES.map((c) => c.id)).size).toBe(6);
  });

  it('versions: a restore names its source; controls are no longer a kind', () => {
    const version = { n: 3, kind: 'restore', from: 1, storagePath: 'v/s/versions/3.html', createdAt: '2026-10-10T10:00:00Z' };
    expect(MvpPageVersionSchema.safeParse(version).success).toBe(true);
    expect(MvpPageVersionSchema.safeParse({ ...version, kind: 'controls' }).success).toBe(false);
    expect(MvpPageVersionSchema.safeParse({ ...version, from: 0 }).success).toBe(false);
  });

  it('parses the version number in the restore path', () => {
    expect(MvpVersionParamsSchema.parse({ n: '2' })).toEqual({ n: 2 });
    expect(MvpVersionParamsSchema.safeParse({ n: '0' }).success).toBe(false);
    expect(MvpVersionParamsSchema.safeParse({ n: 'x' }).success).toBe(false);
  });
});

describe('the old pipeline is gone (REV-141)', () => {
  it('AUDIT_MEASUREMENTS has no sections', () => {
    expect(AUDIT_MEASUREMENTS).not.toContain('sections');
  });
});
