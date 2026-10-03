import { describe, it, expect } from 'vitest';
import { OUTLINE_LIMITS, SiteGroupingAnswerSchema, SiteSectionsSchema } from '../src/index.js';

const section = { heading: 3, pieces: [4, 5], kind: 'about', arrangement: 'text' };

describe('SiteGroupingAnswerSchema (REV-113)', () => {
  it('accepts ids-only answers with header, sections, items and footer', () => {
    const answer = {
      header: { logo: 1, pieces: [2] },
      sections: [section, { heading: 6, pieces: [], items: [{ title: 7, pieces: [8] }, { pieces: [9] }], kind: 'services', arrangement: 'card-grid' }],
      footer: { pieces: [10] },
    };
    expect(SiteGroupingAnswerSchema.safeParse(answer).success).toBe(true);
  });

  it('rejects text where an id belongs, ids out of range, and unknown kinds or arrangements', () => {
    for (const bad of [
      { sections: [{ ...section, heading: 'O nas' }] },
      { sections: [{ ...section, heading: 0 }] },
      { sections: [{ ...section, heading: OUTLINE_LIMITS.pieces + 1 }] },
      { sections: [{ ...section, pieces: [1.5] }] },
      { sections: [{ ...section, kind: 'blog' }] },
      { sections: [{ ...section, arrangement: 'masonry' }] },
      { sections: [] },
      { sections: Array.from({ length: OUTLINE_LIMITS.sections + 1 }, (_, i) => ({ ...section, heading: i + 1, pieces: [] })) },
    ]) {
      expect(SiteGroupingAnswerSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('drops keys it does not know, so no model text survives parsing', () => {
    const parsed = SiteGroupingAnswerSchema.parse({ sections: [{ ...section, title: 'Invented' }], note: 'hi' });
    expect(JSON.stringify(parsed)).not.toContain('Invented');
    expect(JSON.stringify(parsed)).not.toContain('hi');
  });
});

describe('SiteSectionsSchema source and unassigned (REV-113)', () => {
  const reading = { sections: [], skipped: [{ index: 0, reason: 'unassigned', sample: '' }], coverage: { pageChars: 0, capturedChars: 0, ratio: 0, uncaptured: [] } };
  it('accepts a reading with or without a source, and the unassigned reason', () => {
    expect(SiteSectionsSchema.safeParse(reading).success).toBe(true);
    expect(SiteSectionsSchema.safeParse({ ...reading, source: 'llm' }).success).toBe(true);
    expect(SiteSectionsSchema.safeParse({ ...reading, source: 'model' }).success).toBe(false);
  });
});
