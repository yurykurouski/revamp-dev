import { describe, it, expect } from 'vitest';
import { IDiscoveryCandidate, ISiteAssessment } from '@revamp/shared-types';
import {
  assessmentBucket,
  assessmentDetails,
  countAssessments,
  defaultSelection,
  filterByAssessment,
  hasAssessments,
  sortByAssessment,
} from '../siteAssessment.js';

const assessedAt = '2026-09-28T10:00:00.000Z';

const assessed = (verdict: 'good' | 'maybe' | 'poor', extra: Partial<ISiteAssessment> = {}): ISiteAssessment =>
  ({
    outcome: 'assessed',
    verdict,
    simple: true,
    badSigns: [],
    complexitySigns: [],
    internalPages: 1,
    finalUrl: 'https://x.lt/',
    httpStatus: 200,
    responseMs: 400,
    htmlBytes: 9000,
    assessedAt,
    ...extra,
  }) as ISiteAssessment;

const failed: ISiteAssessment = { outcome: 'failed', failure: 'timeout', assessedAt };

const candidate = (
  id: string,
  assessment?: ISiteAssessment,
  status: IDiscoveryCandidate['status'] = 'new',
): IDiscoveryCandidate => ({ provider: 'osm', externalId: id, name: id, status, assessment });

const ids = (list: IDiscoveryCandidate[]) => list.map((c) => c.externalId);

describe('siteAssessment utils (REV-98)', () => {
  const list = [
    candidate('poor', assessed('poor')),
    candidate('none'),
    candidate('good1', assessed('good')),
    candidate('existing', assessed('good'), 'existing_lead'),
    candidate('failed', failed),
    candidate('maybe', assessed('maybe')),
    candidate('good2', assessed('good')),
    candidate('dup', undefined, 'duplicate'),
  ];

  it('assessmentBucket should use the verdict, failed for a failed check, none without one', () => {
    expect(assessmentBucket(assessed('maybe'))).toBe('maybe');
    expect(assessmentBucket(failed)).toBe('failed');
    expect(assessmentBucket(undefined)).toBe('none');
  });

  it('countAssessments should count new candidates per bucket only', () => {
    expect(countAssessments(list)).toEqual({ good: 2, maybe: 1, poor: 1, failed: 1 });
    expect(countAssessments([])).toEqual({ good: 0, maybe: 0, poor: 0, failed: 0 });
  });

  it('hasAssessments should tell a search from before REV-98', () => {
    expect(hasAssessments(list)).toBe(true);
    expect(hasAssessments([candidate('a'), candidate('b')])).toBe(false);
  });

  it('filterByAssessment should keep everything for all, else only the bucket', () => {
    expect(filterByAssessment(list, 'all')).toBe(list);
    expect(ids(filterByAssessment(list, 'good'))).toEqual(['good1', 'existing', 'good2']);
    expect(ids(filterByAssessment(list, 'failed'))).toEqual(['failed']);
    expect(filterByAssessment(list, 'maybe')).toHaveLength(1);
  });

  it('sortByAssessment should put new candidates best first, stable, then the other rows in search order', () => {
    expect(ids(sortByAssessment(list))).toEqual(['good1', 'good2', 'maybe', 'failed', 'none', 'poor', 'existing', 'dup']);
    // The input is not mutated
    expect(ids(list)[0]).toBe('poor');
  });

  it('defaultSelection should preselect new candidates except poor ones', () => {
    expect(defaultSelection(list)).toEqual(['none', 'good1', 'failed', 'maybe', 'good2']);
  });

  describe('assessmentDetails', () => {
    it('should list complexity signs, then bad signs with their numbers', () => {
      const details = assessmentDetails(
        assessed('maybe', {
          simple: false,
          complexitySigns: ['many_pages', 'login'],
          internalPages: 14,
          badSigns: ['no_https', 'stale_copyright', 'slow_response', 'heavy_html'],
          copyrightYear: 2015,
          responseMs: 4250,
          htmlBytes: 612_400,
        } as Partial<ISiteAssessment>),
      );
      expect(details).toEqual([
        { kind: 'complexity', sign: 'many_pages', values: { count: 14 } },
        { kind: 'complexity', sign: 'login', values: { count: 14 } },
        { kind: 'bad', sign: 'no_https', values: { year: undefined, seconds: undefined, size: undefined } },
        { kind: 'bad', sign: 'stale_copyright', values: { year: 2015, seconds: undefined, size: undefined } },
        { kind: 'bad', sign: 'slow_response', values: { year: undefined, seconds: '4.3', size: undefined } },
        { kind: 'bad', sign: 'heavy_html', values: { year: undefined, seconds: undefined, size: 612 } },
      ]);
    });

    it('should say so when a site shows no signs', () => {
      expect(assessmentDetails(assessed('poor'))).toEqual([{ kind: 'noSigns' }]);
    });

    it('should give the reason and status of a failed check', () => {
      expect(assessmentDetails({ outcome: 'failed', failure: 'http_error', httpStatus: 503, assessedAt })).toEqual([
        { kind: 'failure', failure: 'http_error', values: { status: 503 } },
      ]);
    });
  });
});
