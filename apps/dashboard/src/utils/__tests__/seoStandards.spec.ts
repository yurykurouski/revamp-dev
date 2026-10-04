import { describe, expect, it } from 'vitest';
import { STANDARDS_CHECKS } from '@revamp/shared-types';
import type { IMvpStandards, IStandardsChecks } from '@revamp/shared-types';
import { seoStandardsView } from '../seoStandards.js';

const original: IStandardsChecks = {
  https: true, viewport: true, title: true, metaDescription: false, singleH1: false, favicon: true, structuredData: false, openGraph: false,
};
const mvp: IMvpStandards = {
  checks: { https: false, viewport: true, title: true, metaDescription: true, singleH1: true, favicon: true, structuredData: true, openGraph: true },
  score: 80,
};

describe('seoStandardsView (REV-118)', () => {
  it('is null when neither page was checked', () => {
    expect(seoStandardsView(null, null)).toBeNull();
    expect(seoStandardsView({}, {})).toBeNull();
  });

  it('lists every check with its points and both pages, and what the MVP fixed or lost', () => {
    const view = seoStandardsView({ standardsChecks: original }, { standards: mvp })!;
    expect(view.rows.map((row) => row.check)).toEqual([...STANDARDS_CHECKS]);
    expect(view.rows.find((row) => row.check === 'metaDescription')).toEqual({ check: 'metaDescription', points: 10, original: 'failed', mvp: 'passed' });
    expect(view.originalScore).toBe(60);
    expect(view.mvpScore).toBe(80);
    expect(view.fixed).toEqual(['metaDescription', 'singleH1', 'structuredData', 'openGraph']);
    // The original's HTTPS is how it is served, the MVP's whether its page is ready: never compared
    expect(view.regressed).toEqual([]);
  });

  it('shows the MVP\'s HTTPS as depending on hosting when its page is ready, never as passed outright', () => {
    const ready = seoStandardsView({ standardsChecks: { ...original, https: false } }, { standards: { ...mvp, checks: { ...mvp.checks, https: true }, score: 100 } })!;
    expect(ready.rows.find((row) => row.check === 'https')?.mvp).toBe('hosting');
    expect(ready.fixed).not.toContain('https');
    expect(ready.rows.find((row) => row.check === 'viewport')?.mvp).toBe('passed');
  });

  it('lists a page check the MVP lost', () => {
    const view = seoStandardsView({ standardsChecks: original }, { standards: { ...mvp, checks: { ...mvp.checks, favicon: false }, score: 70 } })!;
    expect(view.regressed).toEqual(['favicon']);
  });

  it('shows no original score for an audit made before the SEO checks, so the scores are never compared across rules', () => {
    const before: IStandardsChecks = { ...original };
    delete before.metaDescription;
    delete before.singleH1;
    const view = seoStandardsView({ standardsChecks: before }, { standards: mvp })!;
    expect(view.originalMeasured).toBe(true);
    expect(view.originalScore).toBeUndefined();
    expect(view.rows.find((row) => row.check === 'singleH1')?.original).toBe('unknown');
    // A check the original never had read is neither fixed nor lost
    expect(view.fixed).toEqual(['structuredData', 'openGraph']);
  });

  it('shows the original alone until the MVP is checked', () => {
    const view = seoStandardsView({ standardsChecks: original }, null)!;
    expect(view.mvpScore).toBeUndefined();
    expect(view.rows.every((row) => row.mvp === undefined)).toBe(true);
    expect(view.fixed).toEqual([]);
  });

  it('shows the MVP alone when the original was not measured', () => {
    const view = seoStandardsView({ standardsChecks: undefined }, { standards: mvp })!;
    expect(view.originalMeasured).toBe(false);
    expect(view.rows.every((row) => row.original === 'unknown')).toBe(true);
    expect(view.mvpScore).toBe(80);
  });
});
