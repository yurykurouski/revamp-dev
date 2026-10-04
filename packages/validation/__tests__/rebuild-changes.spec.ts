import { describe, expect, it } from 'vitest';
import { REBUILD_CHANGE_KINDS, REBUILD_OMISSION_REASONS, REBUILD_OMISSIONS, SITE_SKIP_REASONS } from '@revamp/shared-types';
import { MvpPerformanceSchema, MvpRebuildSummarySchema, parseRebuildChange } from '../src/index.js';

describe('parseRebuildChange (REV-119)', () => {
  it('reads the fixed codes', () => {
    expect(parseRebuildChange('font:body-16')).toEqual({ kind: 'font-body' });
    expect(parseRebuildChange('line-height:1.5')).toEqual({ kind: 'line-height' });
    expect(parseRebuildChange('h1:hidden')).toEqual({ kind: 'h1-hidden' });
    expect(parseRebuildChange('booking:replaced')).toEqual({ kind: 'booking-replaced' });
    expect(parseRebuildChange('booking:appended')).toEqual({ kind: 'booking-appended' });
    expect(parseRebuildChange('footer:added')).toEqual({ kind: 'footer-added' });
    expect(parseRebuildChange('seo:description')).toEqual({ kind: 'seo-description' });
    expect(parseRebuildChange('seo:og')).toEqual({ kind: 'seo-og' });
    expect(parseRebuildChange('seo:jsonld')).toEqual({ kind: 'seo-jsonld' });
  });

  it('reads a count and a section index', () => {
    expect(parseRebuildChange('alt:12')).toEqual({ kind: 'alt', count: 12 });
    expect(parseRebuildChange('contrast:3')).toEqual({ kind: 'contrast', section: 3 });
    expect(parseRebuildChange('overlay:0')).toEqual({ kind: 'overlay', section: 0 });
    expect(parseRebuildChange('collapse:11')).toEqual({ kind: 'collapse', section: 11 });
    expect(parseRebuildChange('wall:9')).toEqual({ kind: 'text-wall', section: 9 });
  });

  it('reads the source of a design change', () => {
    expect(parseRebuildChange('modernize:cards:5')).toEqual({ kind: 'cards', source: 'modernize', section: 5 });
    expect(parseRebuildChange('edit:style:2')).toEqual({ kind: 'style', source: 'edit', section: 2 });
    expect(parseRebuildChange('edit:side:4')).toEqual({ kind: 'side', source: 'edit', section: 4 });
    expect(parseRebuildChange('modernize:fill:4')).toEqual({ kind: 'fill', source: 'modernize', section: 4 });
    expect(parseRebuildChange('modernize:hero-photo:s-3.m1')).toEqual({ kind: 'hero-photo', source: 'modernize', section: 3 });
    expect(parseRebuildChange('edit:hero-cta')).toEqual({ kind: 'hero-cta', source: 'edit' });
    expect(parseRebuildChange('modernize:type')).toEqual({ kind: 'type', source: 'modernize' });
    expect(parseRebuildChange('edit:theme')).toEqual({ kind: 'theme', source: 'edit' });
    expect(parseRebuildChange('edit:order')).toEqual({ kind: 'order', source: 'edit' });
    expect(parseRebuildChange('edit:css-dropped')).toEqual({ kind: 'css-dropped', source: 'edit' });
  });

  it('rejects codes no kind covers', () => {
    for (const code of ['', 'contrast', 'contrast:x', 'alt:', 'modernize:order', 'modernize:css-dropped', 'other:style:1', 'seo:title', 'font:body-14', 'wall:', 'modernize:wall:1', 'text-wall:1']) {
      expect(parseRebuildChange(code), code).toBeUndefined();
    }
  });

  it('has a kind for every parsed code and a code for every kind', () => {
    const samples = [
      'contrast:1', 'overlay:1', 'alt:2', 'font:body-16', 'line-height:1.5', 'collapse:1', 'h1:hidden', 'booking:replaced',
      'booking:appended', 'footer:added', 'seo:description', 'seo:og', 'seo:jsonld', 'edit:style:1', 'edit:cards:1',
      'edit:side:1', 'edit:fill:1', 'edit:hero-photo:s-1.m0', 'edit:hero-cta', 'edit:type', 'edit:theme', 'edit:order',
      'edit:css-dropped', 'wall:9',
    ];
    expect(new Set(samples.map((code) => parseRebuildChange(code)?.kind))).toEqual(new Set(REBUILD_CHANGE_KINDS));
  });
});

describe('REBUILD_OMISSION_REASONS (REV-119)', () => {
  it('lists reasons for every omission kind, the reader skips among a section`s', () => {
    expect(Object.keys(REBUILD_OMISSION_REASONS).sort()).toEqual([...REBUILD_OMISSIONS].sort());
    for (const reason of SITE_SKIP_REASONS) expect(REBUILD_OMISSION_REASONS.section).toContain(reason);
  });
});

describe('MvpRebuildSummarySchema facts (REV-119)', () => {
  const summary = { coverage: 0.9, sections: 3, omitted: [], tuning: ['contrast:2'] };
  it('accepts a summary with and without facts', () => {
    expect(MvpRebuildSummarySchema.safeParse(summary).success).toBe(true);
    const facts = [{ code: 'contrast:2', section: 'Services', from: '#9a9a9a', to: '#595959', background: '#ffffff', ratioBefore: 2.8, ratioAfter: 4.6 }];
    expect(MvpRebuildSummarySchema.safeParse({ ...summary, facts }).success).toBe(true);
    expect(MvpRebuildSummarySchema.safeParse({ ...summary, tuning: ['wall:9'], facts: [{ code: 'wall:9', value: 26, median: 2 }] }).success).toBe(true);
    expect(MvpRebuildSummarySchema.safeParse({ ...summary, facts: [{ code: 'wall:9', median: -1 }] }).success).toBe(false);
  });
  it('rejects a ratio outside 1..21 and a fact without a code', () => {
    expect(MvpRebuildSummarySchema.safeParse({ ...summary, facts: [{ code: 'contrast:2', ratioBefore: 0.5 }] }).success).toBe(false);
    expect(MvpRebuildSummarySchema.safeParse({ ...summary, facts: [{ section: 'x' }] }).success).toBe(false);
  });
});

describe('MvpPerformanceSchema (REV-119)', () => {
  const measuredAt = new Date('2026-10-04T10:00:00Z');
  it('accepts measured vitals with their score', () => {
    expect(MvpPerformanceSchema.safeParse({ webVitals: { lcp: 900, cls: 0.01 }, score: 100, host: 'localhost:9000', measuredAt }).success).toBe(true);
  });
  it('accepts a failed measurement with its error and no values', () => {
    expect(MvpPerformanceSchema.safeParse({ webVitals: {}, host: 'localhost:9000', measuredAt, error: 'timeout' }).success).toBe(true);
  });
  it('rejects a score without an LCP, a negative value and a missing host', () => {
    expect(MvpPerformanceSchema.safeParse({ webVitals: { cls: 0 }, score: 90, host: 'h', measuredAt }).success).toBe(false);
    expect(MvpPerformanceSchema.safeParse({ webVitals: { lcp: -1 }, host: 'h', measuredAt }).success).toBe(false);
    expect(MvpPerformanceSchema.safeParse({ webVitals: {}, measuredAt }).success).toBe(false);
  });
});
