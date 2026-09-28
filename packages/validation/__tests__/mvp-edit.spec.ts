import { describe, it, expect } from 'vitest';
import { EditMvpSchema, MVP_EDIT_INSTRUCTION_MAX, MvpEditOutputSchema } from '../src/index.js';

const content = {
  hero: {
    badge: 'Warsaw',
    headline: 'Healthy smiles in Mokotów',
    subheadline: 'Gentle dental care for the whole family.',
    primaryCtaText: 'Book a visit',
    secondaryCtaText: 'Call us',
  },
  services: [{ title: 'Implants', description: 'Lasting implants.', lucideIconName: 'shield-check' }],
  trustSignals: [],
  offerNotice: 'Get in touch today.',
};

describe('EditMvpSchema (REV-85)', () => {
  it('accepts an instruction and trims it', () => {
    expect(EditMvpSchema.parse({ instruction: '  make the headline punchier  ' })).toEqual({
      instruction: 'make the headline punchier',
    });
  });

  it('accepts an instruction at the length limit and rejects one over it', () => {
    expect(EditMvpSchema.safeParse({ instruction: 'a'.repeat(MVP_EDIT_INSTRUCTION_MAX) }).success).toBe(true);
    expect(EditMvpSchema.safeParse({ instruction: 'a'.repeat(MVP_EDIT_INSTRUCTION_MAX + 1) }).success).toBe(false);
  });

  it.each([{}, { instruction: '' }, { instruction: '  ab  ' }, { instruction: 42 }])('rejects %j', (body) => {
    expect(EditMvpSchema.safeParse(body).success).toBe(false);
  });
});

describe('MvpEditOutputSchema (REV-85)', () => {
  it('accepts a summary alone: nothing to change', () => {
    expect(MvpEditOutputSchema.parse({ summary: 'The site lists no prices, so none were added.' })).toEqual({
      summary: 'The site lists no prices, so none were added.',
    });
  });

  it('accepts revised copy, a color and a layout together', () => {
    const output = { summary: 'Warmer palette and a punchier headline', content, primaryColor: '#D97706', layout: 'split' };
    expect(MvpEditOutputSchema.parse(output)).toEqual(output);
  });

  it('treats null as "leave as it is"', () => {
    const parsed = MvpEditOutputSchema.parse({ summary: 'Headline only', content, primaryColor: null, layout: null });
    expect(parsed.primaryColor).toBeNull();
    expect(parsed.layout).toBeNull();
  });

  it.each([
    ['no summary', { content }],
    ['an empty summary', { summary: '   ' }],
    ['an over-long summary', { summary: 'a'.repeat(301) }],
    ['a color name', { summary: 'ok', primaryColor: 'orange' }],
    ['a short hex color', { summary: 'ok', primaryColor: '#fa0' }],
    ['an unknown layout', { summary: 'ok', layout: 'masonry' }],
    ['copy without services', { summary: 'ok', content: { ...content, services: [] } }],
    ['copy with an over-long headline', { summary: 'ok', content: { ...content, hero: { ...content.hero, headline: 'a'.repeat(91) } } }],
  ])('rejects %s', (_label, output) => {
    expect(MvpEditOutputSchema.safeParse(output).success).toBe(false);
  });
});
