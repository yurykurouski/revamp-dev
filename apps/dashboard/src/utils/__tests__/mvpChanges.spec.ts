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

describe('summarizeMvpChanges (REV-81)', () => {
  it('is null until an MVP exists', () => {
    expect(summarizeMvpChanges(null, audit())).toBeNull();
    expect(summarizeMvpChanges(undefined, undefined)).toBeNull();
  });

  it('summarizes a fully recorded MVP', () => {
    const summary = summarizeMvpChanges(
      mvp({
        layout: { variant: 'split', reasons: ['complexity:ONE_PAGE_BROCHURE', 'rule:visual_niche'] },
        provider: 'anthropic',
        modelUsed: 'claude-sonnet-5',
        generatedContent: {
          about: { heading: 'About us', body: 'Since 2004' },
          services: [{ title: 'Cut' }, { title: 'Color' }, { title: 'Beard' }],
          trustSignals: [{ metric: '20', label: 'years' }],
        },
        colorPalette: { primary: '#123456' },
        completenessReport: {
          status: 'verified',
          hasCriticalIssues: true,
          checkedAt: '2026-09-27T00:00:00Z',
          checks: [
            check('phone', 'present'),
            check('email', 'altered'),
            check('address', 'missing'),
            check('workingHours', 'unsourced'),
            check('rating', 'not_in_source'),
          ],
        },
      }),
      audit({
        originalServiceCount: 2,
        colorPalette: { primary: '#ABCDEF' },
        quickWins: ['Add a call button', '  ', 'Shorten the hero text '],
      }),
    );

    expect(summary).toEqual({
      layout: { variant: 'split', rule: 'visual_niche' },
      copySource: { actual: expect.stringContaining('Anthropic') },
      sections: { originalServices: 2, mvpServices: 3, about: true, trustSignals: 1 },
      palette: { original: '#ABCDEF', mvp: '#123456', changed: true },
      businessData: {
        verified: true,
        kept: 1,
        checked: 4,
        issues: [
          { field: 'workingHours', status: 'unsourced' },
          { field: 'address', status: 'missing' },
          { field: 'email', status: 'altered' },
        ],
      },
      critiqueGuidance: ['Add a call button', 'Shorten the hero text'],
    });
  });

  it('leaves out every part the pipeline did not record', () => {
    const summary = summarizeMvpChanges(mvp(), null);
    expect(summary).toEqual({ critiqueGuidance: [] });
    expect(isMvpChangeSummaryEmpty(summary!)).toBe(true);
  });

  it('never guesses the original values it does not have', () => {
    const summary = summarizeMvpChanges(
      mvp({ generatedContent: { services: [] }, colorPalette: { primary: '#5c5bed' } }),
      audit(),
    )!;
    expect(summary.sections).toEqual({ originalServices: undefined, mvpServices: 0, about: false, trustSignals: 0 });
    // No brand color on the site: the MVP's color is the default, reported as such
    expect(summary.palette).toEqual({ original: undefined, mvp: '#5c5bed', changed: true });
    expect(isMvpChangeSummaryEmpty(summary)).toBe(false);
  });

  it('treats the same color in another case as kept', () => {
    const summary = summarizeMvpChanges(mvp({ colorPalette: { primary: '#aabbcc' } }), audit({ colorPalette: { primary: '#AABBCC' } }))!;
    expect(summary.palette?.changed).toBe(false);
  });

  it('ignores malformed copy and unknown layouts', () => {
    const summary = summarizeMvpChanges(
      mvp({
        layout: { variant: 'masonry' as never, reasons: [] },
        generatedContent: { hero: 'not an object', services: 'many', about: { heading: ' ' } },
      }),
      audit(),
    )!;
    expect(summary.layout).toBeUndefined();
    expect(summary.sections).toBeUndefined();
  });

  it('keeps a layout without a known rule', () => {
    expect(summarizeMvpChanges(mvp({ layout: { variant: 'bento', reasons: [] } }), null)!.layout).toEqual({
      variant: 'bento',
      rule: undefined,
    });
  });

  it('reports a data check that could not run, and a clean one', () => {
    const unverified = summarizeMvpChanges(
      mvp({ completenessReport: { status: 'unverified', hasCriticalIssues: false, checks: [], checkedAt: '' } }),
      null,
    )!;
    expect(unverified.businessData).toEqual({ verified: false });

    const clean = summarizeMvpChanges(
      mvp({
        completenessReport: {
          status: 'verified',
          hasCriticalIssues: false,
          checkedAt: '',
          checks: [check('phone', 'present'), check('logo', 'present')],
        },
      }),
      null,
    )!;
    expect(clean.businessData).toEqual({ verified: true, kept: 2, checked: 2, issues: [] });
  });

  it('reports the deterministic fallback as its own copy source', () => {
    expect(summarizeMvpChanges(mvp({ provider: 'deterministic' }), null)!.copySource).toEqual({ actual: 'deterministic' });
  });
});
