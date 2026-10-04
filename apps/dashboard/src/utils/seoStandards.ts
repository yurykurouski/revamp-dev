import { STANDARDS_CHECKS, STANDARDS_POINTS } from '@revamp/shared-types';
import type { IStandardsChecks, StandardsCheck } from '@revamp/shared-types';
import type { IAuditDetail, IMvpProjectDetail } from '../api/client.js';

/**
 * A check on one page: passed, failed, or not read (an audit made before the check existed). The MVP's HTTPS is
 * `hosting` when the page is ready for it: whether it is served over HTTPS depends on where it is deployed.
 */
export type CheckState = 'passed' | 'failed' | 'unknown' | 'hosting';

/** Checks that depend on where the MVP is deployed, not on the page (REV-118) */
export const HOSTING_CHECKS: ReadonlySet<StandardsCheck> = new Set(['https']);

export interface SeoStandardsRow {
  check: StandardsCheck;
  points: number;
  original: CheckState;
  /** Absent while the MVP's page has not been checked */
  mvp?: CheckState;
}

/**
 * The original site's SEO and web standards checks next to the published MVP's (REV-118). Both were read by code with
 * the same checks; a score is shown only when every check of its page was read, so the comparison never mixes an
 * audit scored before the SEO checks with the MVP's.
 */
export interface SeoStandardsView {
  rows: SeoStandardsRow[];
  /** The audit read the original's standards */
  originalMeasured: boolean;
  /** The original's score over every check; absent when it was not measured or lacks a check */
  originalScore?: number;
  /** The MVP's score, its HTTPS counted when the page is ready for it; absent while its page has not been checked */
  mvpScore?: number;
  /** Checks the original failed and the MVP passes; hosting checks are never listed */
  fixed: StandardsCheck[];
  /** Checks the original passed and the MVP fails; hosting checks are never listed */
  regressed: StandardsCheck[];
}

const state = (checks: Partial<IStandardsChecks> | undefined, check: StandardsCheck): CheckState => {
  const value = checks?.[check];
  return value === true ? 'passed' : value === false ? 'failed' : 'unknown';
};

/** The MVP's check; one that depends on hosting is never shown as passed outright */
const mvpState = (checks: Partial<IStandardsChecks>, check: StandardsCheck): CheckState => {
  const read = state(checks, check);
  return HOSTING_CHECKS.has(check) && read === 'passed' ? 'hosting' : read;
};

/** The checks of both pages, or null when neither was checked */
export function seoStandardsView(
  audit: Pick<IAuditDetail, 'standardsChecks'> | null | undefined,
  mvp: Pick<IMvpProjectDetail, 'standards'> | null | undefined,
): SeoStandardsView | null {
  const original = audit?.standardsChecks;
  const published = mvp?.standards;
  if (!original && !published) return null;
  const rows = STANDARDS_CHECKS.map((check) => ({
    check,
    points: STANDARDS_POINTS[check],
    original: state(original, check),
    ...(published ? { mvp: mvpState(published.checks, check) } : {}),
  }));
  const complete = original && rows.every((row) => row.original !== 'unknown');
  return {
    rows,
    originalMeasured: Boolean(original),
    ...(complete ? { originalScore: rows.reduce((sum, row) => sum + (row.original === 'passed' ? row.points : 0), 0) } : {}),
    ...(published ? { mvpScore: published.score } : {}),
    fixed: rows.filter((row) => row.original === 'failed' && row.mvp === 'passed').map((row) => row.check),
    // The original's HTTPS is how it is served, the MVP's whether its page is ready for it: not the same check to compare
    regressed: rows.filter((row) => !HOSTING_CHECKS.has(row.check) && row.original === 'passed' && row.mvp === 'failed').map((row) => row.check),
  };
}
