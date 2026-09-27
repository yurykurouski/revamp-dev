import { describe, it, expect } from 'vitest';
import { MVP_LAYOUT_VARIANTS } from '@revamp/shared-types';
import { BentoTemplateDataSchema, MvpLayoutSelectionSchema, MvpLayoutVariantSchema } from '../src/index.js';

const templateData = {
  businessName: 'Studio',
  palette: { primary: '#123456', secondary: '#654321', accent: '#abcdef' },
  contacts: {},
  hero: { headline: 'Headline', subheadline: 'Subheadline' },
  services: [{ title: 'Cut', description: 'A haircut.' }],
};

describe('MVP layout schemas (REV-54)', () => {
  it('accepts every layout variant and nothing else', () => {
    for (const variant of MVP_LAYOUT_VARIANTS) {
      expect(MvpLayoutVariantSchema.parse(variant)).toBe(variant);
    }
    expect(MvpLayoutVariantSchema.safeParse('masonry').success).toBe(false);
    expect(MvpLayoutVariantSchema.safeParse('').success).toBe(false);
  });

  it('validates a layout selection with its reason codes', () => {
    const selection = { variant: 'split', reasons: ['rule:image_rich', 'images:5'] };
    expect(MvpLayoutSelectionSchema.parse(selection)).toEqual(selection);
    expect(MvpLayoutSelectionSchema.parse({ variant: 'bento', reasons: [] }).reasons).toEqual([]);
  });

  it('rejects malformed selections', () => {
    expect(MvpLayoutSelectionSchema.safeParse({ variant: 'split' }).success).toBe(false);
    expect(MvpLayoutSelectionSchema.safeParse({ variant: 'split', reasons: [''] }).success).toBe(false);
    expect(MvpLayoutSelectionSchema.safeParse({ variant: 'split', reasons: ['x'.repeat(61)] }).success).toBe(false);
    expect(
      MvpLayoutSelectionSchema.safeParse({ variant: 'split', reasons: Array.from({ length: 13 }, (_, i) => `r${i}`) })
        .success,
    ).toBe(false);
  });

  it('keeps the template layout optional and rejects unknown layouts', () => {
    expect(BentoTemplateDataSchema.parse(templateData).layout).toBeUndefined();
    expect(BentoTemplateDataSchema.parse({ ...templateData, layout: 'editorial' }).layout).toBe('editorial');
    expect(BentoTemplateDataSchema.safeParse({ ...templateData, layout: 'grid' }).success).toBe(false);
  });
});
