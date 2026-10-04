import { describe, it, expect } from 'vitest';
import { SITE_DATED_SIGNS, type ISiteSection } from '@revamp/shared-types';
import {
  MvpLayoutSelectionSchema,
  RebuildEditAnswerSchema,
  RebuildModernizeAnswerSchema,
  RebuildModernizeSchema,
  SiteEraSchema,
  UpdateMvpLayoutSchema,
  cardRun,
  checkRebuildEdit,
  hasRebuildEdit,
  manualMvpLayout,
  rebuildItemsFitCards,
  textWalls,
  REBUILD_WALL_MIN_PARAGRAPHS,
} from '../src/index.js';

const paragraphs = (...lengths: number[]) => lengths.map((n) => 'x'.repeat(n));

const section = (index: number, role: ISiteSection['role'], over: Partial<ISiteSection> = {}): ISiteSection =>
  ({
    index,
    role,
    kind: 'about',
    arrangement: 'text',
    intro: { heading: `Heading ${index}`, headingLevel: 2, text: [], links: [] },
    items: [],
    extra: [],
    images: [],
    embeds: [],
    style: {},
    ...over,
  }) as unknown as ISiteSection;

const intro = (...lengths: number[]) => ({ heading: 'H', headingLevel: 2, text: paragraphs(...lengths), links: [] });

const page = (over: { s4?: number[] } = {}) => ({
  sections: [
    section(0, 'header'),
    section(1, 'hero', { intro: { heading: 'Welcome', headingLevel: 1, text: [], links: [] } }),
    section(2, 'content', {
      arrangement: 'media-beside-text',
      images: [{ src: 'https://x/a.jpg', width: 352 }],
    } as Partial<ISiteSection>),
    section(3, 'content', { intro: intro(300, 300, 300) }),
    section(4, 'content', { intro: intro(...(over.s4 ?? [50, 301, 50, 50])) }),
    section(5, 'content', {
      arrangement: 'list',
      items: [
        { title: 'A', text: [], links: [] },
        { title: 'B', text: [], links: [] },
      ],
    } as Partial<ISiteSection>),
    section(6, 'footer'),
  ],
});

describe('SiteEraSchema', () => {
  it('lists the signs in the spec order', () => {
    expect(SITE_DATED_SIGNS).toEqual(['table_layout', 'no_viewport', 'frames', 'flash', 'narrow_fixed', 'legacy_tags', 'default_font', 'old_jquery', 'stale_copyright']);
  });
  it('accepts a read era', () => {
    expect(SiteEraSchema.safeParse({ dated: true, score: 7, signs: ['table_layout', 'narrow_fixed'], contentWidth: 760 }).success).toBe(true);
  });
  it('rejects an unknown sign, a negative score and extra keys', () => {
    expect(SiteEraSchema.safeParse({ dated: true, score: 1, signs: ['blink'] }).success).toBe(false);
    expect(SiteEraSchema.safeParse({ dated: false, score: -1, signs: [] }).success).toBe(false);
    expect(SiteEraSchema.safeParse({ dated: false, score: 0, signs: [], extra: 1 }).success).toBe(false);
  });
});

describe('RebuildModernizeAnswerSchema', () => {
  const answer = {
    hero: { photo: 's-2.m0', style: 'split' },
    theme: { typeScale: 'modern' },
    sections: { 's-9': { arrangement: 'card-grid' }, 's-3': { mediaSide: 'left', media: 'fill' } },
  };
  it('accepts the look fields', () => {
    expect(RebuildModernizeAnswerSchema.safeParse(answer).success).toBe(true);
  });
  it('rejects order, hiding, dropping and CSS', () => {
    for (const extra of [{ hidden: ['s-1'] }, { order: ['s-1'] }, { dropped: ['s-1.t0'] }, { customCss: 'a{}' }]) {
      expect(RebuildModernizeAnswerSchema.safeParse({ ...answer, ...extra }).success).toBe(false);
    }
  });
  it('rejects a text piece as the hero photo and a slider arrangement', () => {
    expect(RebuildModernizeAnswerSchema.safeParse({ hero: { photo: 's-2.t0', style: 'split' } }).success).toBe(false);
    expect(RebuildModernizeAnswerSchema.safeParse({ sections: { 's-3': { arrangement: 'slider' } } }).success).toBe(false);
  });
  it('the saved design needs a 24-hex audit id and a known source', () => {
    const saved = { auditId: 'a'.repeat(24), source: 'llm', design: answer };
    expect(RebuildModernizeSchema.safeParse(saved).success).toBe(true);
    expect(RebuildModernizeSchema.safeParse({ ...saved, auditId: 'nope' }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ ...saved, source: 'x' }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ ...saved, extra: 1 }).success).toBe(false);
  });
  it('a failure has a reason and no design; the default design is no longer a source (REV-132)', () => {
    const auditId = 'a'.repeat(24);
    for (const error of ['not_configured', 'call_failed', 'invalid_answer']) {
      expect(RebuildModernizeSchema.safeParse({ auditId, source: 'failed', error, message: 'timeout' }).success).toBe(true);
    }
    expect(RebuildModernizeSchema.safeParse({ auditId, source: 'failed', error: 'other' }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ auditId, source: 'failed' }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ auditId, source: 'failed', error: 'call_failed', design: answer }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ auditId, source: 'llm' }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ auditId, source: 'llm', design: answer, error: 'call_failed' }).success).toBe(false);
    expect(RebuildModernizeSchema.safeParse({ auditId, source: 'default', design: answer, error: 'not_configured' }).success).toBe(false);
  });
});

describe('RebuildEditAnswerSchema (operator layer)', () => {
  it('accepts the new fields', () => {
    expect(
      RebuildEditAnswerSchema.safeParse({
        hero: { photo: 's-2.m0', style: 'banner' },
        theme: { typeScale: 'original' },
        sections: { 's-3': { arrangement: 'list', media: 'natural', mediaSide: 'right' } },
      }).success,
    ).toBe(true);
  });
});

describe('cardRun', () => {
  it('takes a run of at least 3 paragraphs up to 300 characters', () => {
    expect(cardRun(paragraphs(300, 300, 300))).toEqual({ start: 0, end: 3 });
    expect(cardRun(paragraphs(301, 50, 50, 50))).toEqual({ start: 1, end: 4 });
    expect(cardRun(paragraphs(50, 50, 50, 600))).toEqual({ start: 0, end: 3 });
    expect(cardRun(paragraphs(400, 50, 50, 50, 400))).toEqual({ start: 1, end: 4 });
  });
  it('finds no run when a long paragraph sits inside it or the run is short', () => {
    expect(cardRun(paragraphs(50, 301, 50, 50))).toBeNull();
    expect(cardRun(paragraphs(50, 50, 301))).toBeNull();
    expect(cardRun(paragraphs(50, 50))).toBeNull();
    expect(cardRun([])).toBeNull();
  });
});

describe('checkRebuildEdit (modernize rules)', () => {
  const sections = (s: Record<string, object>) => checkRebuildEdit({ sections: s }, page());
  it('text becomes cards when its paragraphs fit', () => {
    expect(sections({ 's-3': { arrangement: 'card-grid' } })).toEqual({ ok: true });
    expect(sections({ 's-3': { arrangement: 'list' } })).toEqual({ ok: true });
  });
  it('rejects text that does not fit, with the reason', () => {
    expect(sections({ 's-4': { arrangement: 'card-grid' } })).toEqual({ ok: false, reason: 's-4 cannot be shown as card-grid' });
  });
  it('accepts a long paragraph before or after the run', () => {
    const leading = checkRebuildEdit({ sections: { 's-4': { arrangement: 'card-grid' } } }, page({ s4: [301, 50, 50, 50] }));
    const trailing = checkRebuildEdit({ sections: { 's-4': { arrangement: 'card-grid' } } }, page({ s4: [50, 50, 50, 600] }));
    expect(leading).toEqual({ ok: true });
    expect(trailing).toEqual({ ok: true });
    expect(checkRebuildEdit({ sections: { 's-4': { arrangement: 'card-grid' } } }, page({ s4: [50, 50, 301] })).ok).toBe(false);
  });
  it('rejects a list of two as cards and accepts a read arrangement as itself', () => {
    expect(sections({ 's-5': { arrangement: 'card-grid' } }).ok).toBe(false);
    expect(sections({ 's-5': { arrangement: 'list' } })).toEqual({ ok: true });
  });
  it('items beside a photo become cards from 3 items (REV-122)', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ text: [`Atut ${i}`], links: [] }));
    const beside = (n: number) =>
      checkRebuildEdit({ sections: { 's-2': { arrangement: 'card-grid' } } }, { sections: [section(1, 'hero'), section(2, 'content', { arrangement: 'media-beside-text', items: items(n) })] });
    expect(beside(3)).toEqual({ ok: true });
    expect(beside(2)).toEqual({ ok: false, reason: 's-2 cannot be shown as card-grid' });
    expect(rebuildItemsFitCards({ arrangement: 'media-beside-text', items: items(24) })).toBe(true);
    expect(rebuildItemsFitCards({ arrangement: 'list', items: items(3) })).toBe(true);
    expect(rebuildItemsFitCards({ arrangement: 'slider', items: items(5) })).toBe(false);
    expect(rebuildItemsFitCards({ arrangement: 'text', items: items(5) })).toBe(false);
  });
  it('mediaSide and media need a photo beside the text', () => {
    expect(sections({ 's-3': { mediaSide: 'left' } })).toEqual({ ok: false, reason: 's-3 has no photo beside its text' });
    expect(sections({ 's-2': { mediaSide: 'left', media: 'fill' } })).toEqual({ ok: true });
  });
  it('the hero photo comes from a later section', () => {
    expect(checkRebuildEdit({ hero: { photo: 's-2.m0', style: 'split' } }, page())).toEqual({ ok: true });
  });
  it('a banner needs a photo at least 1000 px wide', () => {
    expect(checkRebuildEdit({ hero: { photo: 's-2.m0', style: 'banner' } }, page())).toEqual({
      ok: false,
      reason: 's-2.m0 is too small for a banner',
    });
  });
  it('rejects an unknown photo, a photo of the h1 section and an opening section that has one', () => {
    expect(checkRebuildEdit({ hero: { photo: 's-2.m1', style: 'split' } }, page())).toEqual({ ok: false, reason: 'unknown piece s-2.m1' });
    const withPhoto = page();
    withPhoto.sections[1]!.images = [{ src: 'https://x/h.jpg', width: 1200 }];
    expect(checkRebuildEdit({ hero: { photo: 's-2.m0', style: 'split' } }, withPhoto)).toEqual({
      ok: false,
      reason: 'the opening section already shows a photo',
    });
    const self = page();
    self.sections[1]!.images = [];
    expect(checkRebuildEdit({ hero: { photo: 's-1.m0', style: 'split' } }, self).ok).toBe(false);
  });
});

describe('manualMvpLayout with a level', () => {
  const previous = { variant: 'original', reasons: ['modernize:dated', 'dated:7', 'rule:rebuild', 'images:3'], rebuildLevel: 'modern' } as const;
  it('records the pick and drops the render outcome', () => {
    const next = manualMvpLayout({ reasons: [...previous.reasons], rebuildLevel: 'modern' }, 'original', 'faithful');
    expect(next.rebuildLevel).toBe('faithful');
    expect(next.reasons[0]).toBe('rule:manual');
    expect(next.reasons).toContain('modernize:manual');
    expect(next.reasons).not.toContain('modernize:dated');
    expect(next.reasons).not.toContain('dated:7');
    expect(next.reasons).toContain('images:3');
  });
  it('has no level and no manual level reason on a layout other than original', () => {
    const next = manualMvpLayout({ reasons: ['modernize:manual'], rebuildLevel: 'modern' }, 'bento');
    expect(next.rebuildLevel).toBeUndefined();
    expect(next.reasons).not.toContain('modernize:manual');
    expect(manualMvpLayout({ reasons: [] }, 'bento', 'modern').rebuildLevel).toBeUndefined();
  });
  it('keeps the previous level without one', () => {
    expect(manualMvpLayout({ reasons: [...previous.reasons], rebuildLevel: 'modern' }, 'original').rebuildLevel).toBe('modern');
  });
});

describe('UpdateMvpLayoutSchema level', () => {
  it('allows a level only with the original layout', () => {
    expect(UpdateMvpLayoutSchema.safeParse({ variant: 'bento', level: 'modern' }).success).toBe(false);
    expect(UpdateMvpLayoutSchema.safeParse({ variant: 'original', level: 'modern' }).success).toBe(true);
    expect(UpdateMvpLayoutSchema.safeParse({ variant: 'split' }).success).toBe(true);
  });
});

describe('hasRebuildEdit and MvpLayoutSelectionSchema', () => {
  it('counts the hero and the new section fields', () => {
    expect(hasRebuildEdit({ hero: { photo: 's-2.m0', style: 'split' } })).toBe(true);
    expect(hasRebuildEdit({ sections: { 's-3': { media: 'fill' } } })).toBe(true);
  });
  it('validates the level', () => {
    expect(MvpLayoutSelectionSchema.safeParse({ variant: 'original', reasons: [], rebuildLevel: 'modern' }).success).toBe(true);
    expect(MvpLayoutSelectionSchema.safeParse({ variant: 'original', reasons: [], rebuildLevel: 'retro' }).success).toBe(false);
  });
});

describe('textWalls (REV-122)', () => {
  const counts = (...paragraphs: number[]) => paragraphs.map((n, index) => ({ index, paragraphs: n }));
  it('flags a section of at least 10 paragraphs over 3 times the median of the others', () => {
    expect(textWalls(counts(0, 2, 2, 3, 3, 0, 7, 2, 26, 2))).toEqual([{ index: 8, paragraphs: 26, median: 2 }]);
    // An even count of others takes the mean of the middle two
    expect(textWalls(counts(1, 3, 12))).toEqual([{ index: 2, paragraphs: 12, median: 2 }]);
  });
  it('leaves a short section, one not far above the others, and a page of long sections alone', () => {
    expect(REBUILD_WALL_MIN_PARAGRAPHS).toBe(10);
    expect(textWalls(counts(0, 0, 9))).toEqual([]);
    expect(textWalls(counts(4, 4, 12))).toEqual([]);
    expect(textWalls(counts(4, 4, 13))).toEqual([{ index: 2, paragraphs: 13, median: 4 }]);
    expect(textWalls(counts(12, 14, 15))).toEqual([]);
    expect(textWalls(counts(10))).toEqual([{ index: 0, paragraphs: 10, median: 0 }]);
    expect(textWalls([])).toEqual([]);
  });
});
