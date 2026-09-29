import { describe, it, expect } from 'vitest';
import type { ICompletenessCheck, IMvpGeneratedContent, IMvpProject } from '@revamp/shared-types';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { isMvpChangeSummaryEmpty, summarizeMvpChanges } from '../mvpChanges.js';

/** Stored copy and palette as older or malformed records hold them; the summary reads them defensively */
const content = (value: object) => value as IMvpGeneratedContent;
const palette = (value: Partial<IMvpProjectDetail['colorPalette']>) => value as IMvpProject['colorPalette'];

const audit = (overrides: Partial<IAuditDetail> = {}): IAuditDetail => ({
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: [],
  colorPalette: {},
  measurementErrors: [],
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
        generatedContent: content({
          about: { heading: 'About us', body: 'Since 2004' },
          services: [{ title: 'Cut' }, { title: 'Color' }, { title: 'Beard' }],
          trustSignals: [{ metric: '20', label: 'years' }],
        }),
        colorPalette: palette({ primary: '#123456' }),
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
      sections: { services: { original: 2, mvp: 3 }, about: true, trustSignals: 1 },
      palette: { original: '#ABCDEF', mvp: '#123456' },
      businessData: {
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

  it('leaves out what stayed as it was on the original site', () => {
    const summary = summarizeMvpChanges(
      mvp({
        generatedContent: content({ services: [{}, {}], trustSignals: [] }),
        colorPalette: palette({ primary: '#aabbcc' }),
        completenessReport: {
          status: 'verified',
          hasCriticalIssues: false,
          checkedAt: '',
          checks: [check('phone', 'present'), check('logo', 'present'), check('rating', 'not_in_source')],
        },
      }),
      // Same service count and the same color in another case
      audit({ originalServiceCount: 2, colorPalette: { primary: '#AABBCC' } }),
    )!;
    expect(summary.sections).toBeUndefined();
    expect(summary.palette).toBeUndefined();
    expect(summary.businessData).toBeUndefined();
    expect(isMvpChangeSummaryEmpty(summary)).toBe(true);
  });

  it('keeps the other section changes when the service count is unchanged', () => {
    const summary = summarizeMvpChanges(
      mvp({ generatedContent: content({ services: [{}], about: { heading: 'About' }, trustSignals: [{}, {}] }) }),
      audit({ originalServiceCount: 1 }),
    )!;
    expect(summary.sections).toEqual({ services: undefined, about: true, trustSignals: 2 });
  });

  it('never guesses the original values it does not have', () => {
    const summary = summarizeMvpChanges(
      mvp({ generatedContent: content({ services: [{}] }), colorPalette: palette({ primary: '#5c5bed' }) }),
      audit(),
    )!;
    // No crawler count: nothing to compare the services with
    expect(summary.sections).toBeUndefined();
    // No brand color on the site: the MVP's color is the default, reported as such
    expect(summary.palette).toEqual({ original: undefined, mvp: '#5c5bed' });
  });

  it('compares with a service list the crawler did not find', () => {
    const summary = summarizeMvpChanges(mvp({ generatedContent: content({ services: [{}, {}, {}] }) }), audit({ originalServiceCount: 0 }))!;
    expect(summary.sections?.services).toEqual({ original: 0, mvp: 3 });
  });

  it('ignores malformed copy and unknown layouts', () => {
    const summary = summarizeMvpChanges(
      mvp({
        layout: { variant: 'masonry' as never, reasons: [] },
        generatedContent: content({ hero: 'not an object', services: 'many', about: { heading: ' ' } }),
      }),
      audit({ originalServiceCount: 3 }),
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

  it('leaves out a data check that could not run', () => {
    const summary = summarizeMvpChanges(
      mvp({ completenessReport: { status: 'unverified', hasCriticalIssues: false, checks: [], checkedAt: '' } }),
      null,
    )!;
    expect(summary.businessData).toBeUndefined();
  });

  it('reports the deterministic fallback as its own copy source', () => {
    expect(summarizeMvpChanges(mvp({ provider: 'deterministic' }), null)!.copySource).toEqual({ actual: 'deterministic' });
  });
});
