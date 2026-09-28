import { describe, it, expect } from 'vitest';
import { MVP_DESIGN_ELEMENTS } from '@revamp/shared-types';
import { MvpDesignSchema, MvpEditOutputSchema, BentoTemplateDataSchema } from '../src/index.js';

const full = {
  sectionOrder: ['reviews', 'block-1', 'services', 'about', 'gallery'],
  hidden: ['gallery', 'trust'],
  hero: { align: 'left', order: ['badge', 'headline', 'actions', 'subheadline'], imageSide: 'left' },
  theme: { font: 'serif-display', density: 'airy', corners: 'extra-round', heroStyle: 'dark' },
  elements: {
    'hero.headline': { size: '2xl', weight: 'black', tracking: 'tight', align: 'left' },
    'cta.primary': { radius: 'pill', shadow: 'brand', background: 'accent', color: 'white' },
    'service.card': { radius: 'lg', shadow: 'md', border: 'subtle' },
  },
  blocks: [
    { id: 'block-1', type: 'highlight', style: 'brand', title: 'Open 24/7', body: 'Emergency repairs any time.' },
    { id: 'block-2', type: 'features', title: 'Why us', items: [{ title: 'Since 2009', text: 'Local team', icon: 'award' }] },
    { id: 'block-3', type: 'cta', title: 'Ready?', buttonText: 'Book now' },
  ],
};

describe('MvpDesignSchema (REV-92)', () => {
  it('accepts a full design and an empty one', () => {
    expect(MvpDesignSchema.parse(full)).toEqual(full);
    expect(MvpDesignSchema.parse({})).toEqual({});
  });

  it('accepts a style for every named element', () => {
    const elements = Object.fromEntries(MVP_DESIGN_ELEMENTS.map((element) => [element, { weight: 'bold' }]));
    expect(MvpDesignSchema.safeParse({ elements }).success).toBe(true);
  });

  it('drops element names it does not know instead of styling them', () => {
    const parsed = MvpDesignSchema.parse({ elements: { 'footer.links': { color: 'primary' }, 'hero.badge': { size: 'lg' } } });
    expect(parsed.elements).toEqual({ 'hero.badge': { size: 'lg' } });
  });

  it.each([
    ['the booking form hidden', { hidden: ['booking'] }],
    ['the hero hidden', { hidden: ['hero'] }],
    ['contacts hidden', { hidden: ['contacts'] }],
    ['a section listed twice', { sectionOrder: ['about', 'about'] }],
    ['an unknown section', { sectionOrder: ['pricing'] }],
    ['a hero part listed twice', { hero: { order: ['headline', 'headline'] } }],
    ['an unknown size token', { elements: { 'hero.headline': { size: '5xl' } } }],
    ['a raw color', { elements: { 'cta.primary': { background: '#ff0000' } } }],
    ['an external font', { theme: { font: 'Comic Sans MS' } }],
    ['four blocks', { blocks: [1, 2, 3, 4].map(() => full.blocks[0]) }],
    ['two blocks with one id', { blocks: [full.blocks[0], { ...full.blocks[2], id: 'block-1' }] }],
    ['a features block without items', { blocks: [{ id: 'block-1', type: 'features', title: 'Why us' }] }],
    ['a CTA block without a button', { blocks: [{ id: 'block-1', type: 'cta', title: 'Ready?' }] }],
    ['an over-long block title', { blocks: [{ ...full.blocks[0], title: 'a'.repeat(81) }] }],
    ['five feature items', { blocks: [{ ...full.blocks[1], items: Array(5).fill({ title: 'x' }) }] }],
  ])('rejects %s', (_label, design) => {
    expect(MvpDesignSchema.safeParse(design).success).toBe(false);
  });

  it('is part of the edit output and of the template data', () => {
    expect(MvpEditOutputSchema.parse({ summary: 'Serif, dark hero', design: full }).design).toEqual(full);
    expect(MvpEditOutputSchema.parse({ summary: 'Keep', design: null }).design).toBeNull();
    expect(MvpEditOutputSchema.safeParse({ summary: 'x', design: { hidden: ['booking'] } }).success).toBe(false);
    const templateData = {
      businessName: 'Studio',
      palette: { primary: '#123456', secondary: '#654321', accent: '#abcdef' },
      contacts: {},
      hero: { headline: 'Headline', subheadline: 'Subheadline' },
      services: [{ title: 'Cut', description: 'A haircut.' }],
    };
    expect(BentoTemplateDataSchema.parse({ ...templateData, design: full }).design).toEqual(full);
  });
});
