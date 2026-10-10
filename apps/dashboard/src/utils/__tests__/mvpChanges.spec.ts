import { describe, it, expect } from 'vitest';
import type { ICompletenessCheck } from '@revamp/shared-types';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { isMvpChangeSummaryEmpty, summarizeMvpChanges } from '../mvpChanges.js';

const audit = (overrides: Partial<IAuditDetail> = {}): IAuditDetail => ({
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: [],
  colorPalette: {},
  measurementErrors: [],
  designCritiqueFallback: false,
  ...overrides,
});

const mvp = (overrides: Partial<IMvpProjectDetail> = {}): IMvpProjectDetail => ({
  leadId: 'lead-1',
  fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/demo/index.html',
  ...overrides,
});

const check = (field: ICompletenessCheck['field'], status: ICompletenessCheck['status']): ICompletenessCheck => ({
  field,
  status,
  tier: 'critical',
});

const performance = (overrides: Partial<NonNullable<IMvpProjectDetail['performance']>> = {}): NonNullable<IMvpProjectDetail['performance']> => ({
  webVitals: { lcp: 1400, cls: 0.02 },
  host: 'demo.example',
  measuredAt: '2026-10-10T12:00:00.000Z',
  ...overrides,
});

describe('summarizeMvpChanges: measured facts only (REV-140)', () => {
  it('is null until an MVP exists', () => {
    expect(summarizeMvpChanges(null, audit())).toBeNull();
  });

  it('compares LCP and CLS with the host named', () => {
    const summary = summarizeMvpChanges(mvp({ performance: performance() }), audit({ lcpSeconds: 3.2, cls: 0.21 }))!;
    expect(summary.performance).toEqual({
      host: 'demo.example',
      measuredAt: '2026-10-10T12:00:00.000Z',
      lcp: { mvp: 1.4, original: 3.2 },
      cls: { mvp: 0.02, original: 0.21 },
    });
  });

  it('leaves out what was not measured, never a zero', () => {
    const noOriginal = summarizeMvpChanges(mvp({ performance: performance() }), audit())!;
    expect(noOriginal.performance?.lcp).toEqual({ mvp: 1.4 });
    expect(noOriginal.performance?.cls).toEqual({ mvp: 0.02 });

    const failed = summarizeMvpChanges(mvp({ performance: performance({ webVitals: {}, error: 'navigation timeout' }) }), audit({ lcpSeconds: 3.2 }))!;
    expect(failed.performance).toEqual({ host: 'demo.example', measuredAt: '2026-10-10T12:00:00.000Z', error: 'navigation timeout' });

    expect(summarizeMvpChanges(mvp(), audit({ lcpSeconds: 3.2 }))!.performance).toBeUndefined();
  });

  it("reports the original's accessibility violations, which the MVP does not measure", () => {
    expect(summarizeMvpChanges(mvp(), audit({ a11yViolationsCount: 7 }))!.accessibility).toEqual({ originalViolations: 7 });
    expect(summarizeMvpChanges(mvp(), audit({ a11yViolationsCount: 0 }))!.accessibility).toEqual({ originalViolations: 0 });
    expect(summarizeMvpChanges(mvp(), audit())!.accessibility).toBeUndefined();
  });

  it('lists no layout, copy, palette, sections or critique', () => {
    const summary = summarizeMvpChanges(
      // A record of the previous generator, with fields the types no longer declare
      mvp({
        layout: { variant: 'editorial', reasons: ['rule:professional_niche'] },
        provider: 'deterministic',
        colorPalette: { primary: '#0000aa', secondary: '#ffffff', accent: '#0000aa' },
        generatedContent: { services: [{ title: 'A' }] },
      } as Partial<IMvpProjectDetail>),
      audit({ quickWins: ['Add a sticky call button'], colorPalette: { primary: '#aa0000' }, originalServiceCount: 2 }),
    )!;
    expect(Object.keys(summary).sort()).toEqual([]);
    expect(isMvpChangeSummaryEmpty(summary)).toBe(true);
  });

  it('lists the business data the MVP lost, changed or made up', () => {
    const summary = summarizeMvpChanges(
      mvp({
        completenessReport: {
          status: 'verified',
          hasCriticalIssues: true,
          checkedAt: '2026-10-10T00:00:00Z',
          checks: [check('phone', 'present'), check('address', 'missing'), check('email', 'not_in_source'), check('workingHours', 'unsourced')],
        },
      }),
      audit(),
    )!;
    expect(summary.businessData).toEqual({
      kept: 1,
      checked: 3,
      issues: [
        { field: 'workingHours', status: 'unsourced' },
        { field: 'address', status: 'missing' },
      ],
    });
  });

  it('leaves out a data check that could not run', () => {
    const summary = summarizeMvpChanges(
      mvp({ completenessReport: { status: 'unverified', hasCriticalIssues: false, checkedAt: '2026-10-10T00:00:00Z', checks: [check('address', 'missing')] } }),
      audit(),
    )!;
    expect(summary.businessData).toBeUndefined();
  });
});

describe('summarizeMvpChanges SEO and web standards (REV-118)', () => {
  const original = {
    https: true, viewport: true, title: true, metaDescription: false, singleH1: true, favicon: true, structuredData: false, openGraph: false,
  };
  const checks = { ...original, metaDescription: true, structuredData: true, openGraph: true };

  it('lists the checks the published MVP fixed, with both scores', () => {
    const summary = summarizeMvpChanges(mvp({ standards: { checks, score: 100 } }), audit({ standardsChecks: original }))!;
    expect(summary.standards).toEqual({ originalScore: 70, mvpScore: 100, fixed: ['metaDescription', 'structuredData', 'openGraph'], regressed: [] });
    expect(isMvpChangeSummaryEmpty({ standards: summary.standards })).toBe(false);
  });

  it('lists a check the MVP lost', () => {
    const summary = summarizeMvpChanges(
      mvp({ standards: { checks: { ...checks, favicon: false }, score: 90 } }),
      audit({ standardsChecks: original }),
    )!;
    expect(summary.standards?.regressed).toEqual(['favicon']);
  });

  it('keeps the score once the MVP page was checked, even when no check differs', () => {
    expect(summarizeMvpChanges(mvp({ standards: { checks: original, score: 70 } }), audit({ standardsChecks: original }))!.standards).toEqual({
      originalScore: 70,
      mvpScore: 70,
      fixed: [],
      regressed: [],
    });
    expect(summarizeMvpChanges(mvp(), audit({ standardsChecks: original }))!.standards).toBeUndefined();
  });
});
