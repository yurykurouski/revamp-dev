import {
  IDiscoveryCandidate,
  ISiteAssessment,
  SITE_ASSESSMENT_VERDICTS,
  SiteAssessmentFailure,
  SiteAssessmentVerdict,
  SiteBadSign,
  SiteComplexitySign,
} from '@revamp/shared-types';

/**
 * Discovery candidates by their site pre-assessment (REV-98): the worker's verdict, `failed` when
 * the site could not be assessed, `none` when there is no assessment (skipped listings, or a
 * search from before REV-98).
 */
export type AssessmentBucket = SiteAssessmentVerdict | 'failed' | 'none';

/** Buckets the operator can filter on, in display order */
export const ASSESSMENT_FILTER_BUCKETS = [...SITE_ASSESSMENT_VERDICTS, 'failed'] as const;
export type AssessmentFilterBucket = (typeof ASSESSMENT_FILTER_BUCKETS)[number];
export type AssessmentFilter = AssessmentFilterBucket | 'all';

export const ASSESSMENT_CHIP_COLOR = {
  good: 'success',
  maybe: 'warning',
  poor: 'error',
  failed: 'default',
} as const satisfies Record<AssessmentFilterBucket, string>;

/** Best candidates first; sites not yet judged sit between the maybes and the poor ones */
const BUCKET_RANK: Record<AssessmentBucket, number> = { good: 0, maybe: 1, failed: 2, none: 3, poor: 4 };

export function assessmentBucket(assessment: ISiteAssessment | undefined): AssessmentBucket {
  if (!assessment) return 'none';
  return assessment.outcome === 'assessed' ? assessment.verdict : 'failed';
}

/** New candidates per filter bucket */
export function countAssessments(candidates: IDiscoveryCandidate[]): Record<AssessmentFilterBucket, number> {
  const counts: Record<AssessmentFilterBucket, number> = { good: 0, maybe: 0, poor: 0, failed: 0 };
  for (const c of candidates) {
    const bucket = assessmentBucket(c.assessment);
    if (c.status === 'new' && bucket !== 'none') counts[bucket]++;
  }
  return counts;
}

export function hasAssessments(candidates: IDiscoveryCandidate[]): boolean {
  return candidates.some((c) => c.assessment);
}

/** Rows in the chosen bucket; `all` keeps every row */
export function filterByAssessment(candidates: IDiscoveryCandidate[], filter: AssessmentFilter): IDiscoveryCandidate[] {
  if (filter === 'all') return candidates;
  return candidates.filter((c) => assessmentBucket(c.assessment) === filter);
}

/**
 * New candidates best first (good, maybe, could not assess, poor), then every other row in search
 * order. Stable, so equally rated candidates keep the provider's order.
 */
export function sortByAssessment(candidates: IDiscoveryCandidate[]): IDiscoveryCandidate[] {
  const rank = (c: IDiscoveryCandidate) => (c.status === 'new' ? BUCKET_RANK[assessmentBucket(c.assessment)] : 10);
  return candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.index - b.index)
    .map(({ c }) => c);
}

/** New businesses start selected, except those rated poor: the operator can still tick them */
export function defaultSelection(candidates: IDiscoveryCandidate[]): string[] {
  return candidates
    .filter((c) => c.status === 'new' && assessmentBucket(c.assessment) !== 'poor')
    .map((c) => c.externalId);
}

/** One line item of an assessment as the operator reads it, with the numbers its label needs */
export type AssessmentDetail =
  | { kind: 'complexity'; sign: SiteComplexitySign; values: { count: number } }
  | { kind: 'bad'; sign: SiteBadSign; values: { year?: number; seconds?: string; size?: number } }
  | { kind: 'noSigns' }
  | { kind: 'failure'; failure: SiteAssessmentFailure; values: { status?: number } };

/** What made the site complex, then its redesign signs; for a failed check, why it failed */
export function assessmentDetails(assessment: ISiteAssessment): AssessmentDetail[] {
  if (assessment.outcome === 'failed') {
    return [{ kind: 'failure', failure: assessment.failure, values: { status: assessment.httpStatus } }];
  }
  const details: AssessmentDetail[] = assessment.complexitySigns.map((sign) => ({
    kind: 'complexity',
    sign,
    values: { count: assessment.internalPages },
  }));
  for (const sign of assessment.badSigns) {
    details.push({
      kind: 'bad',
      sign,
      values: {
        year: sign === 'stale_copyright' ? assessment.copyrightYear : undefined,
        seconds: sign === 'slow_response' ? (assessment.responseMs / 1000).toFixed(1) : undefined,
        size: sign === 'heavy_html' ? Math.round(assessment.htmlBytes / 1000) : undefined,
      },
    });
  }
  if (assessment.badSigns.length === 0) details.push({ kind: 'noSigns' });
  return details;
}
