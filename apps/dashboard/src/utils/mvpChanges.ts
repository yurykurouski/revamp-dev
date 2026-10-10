import type { CompletenessField, CompletenessStatus } from '@revamp/shared-types';
import type { IAuditDetail, IMvpProjectDetail } from '../api/client.js';
import { SeoStandardsView, seoStandardsView } from './seoStandards.js';

/** A key business fact the MVP lost, changed or showed without a source on the original site */
export interface MvpDataIssue {
  field: CompletenessField;
  status: Extract<CompletenessStatus, 'missing' | 'altered' | 'unsourced'>;
}

/**
 * What the published MVP changed compared with the original site, from measured facts only (REV-81, REV-140): the
 * standards checks of both pages, the original's accessibility violations, the loading speed of both pages, and the
 * business data the MVP kept. A value that was not measured is left out, never zero, so the review never guesses
 * (AGENTS.md §3.2.2). Nothing here was written by a model.
 */
export interface MvpChangeSummary {
  /** Once the published page was checked; the original's score only when every check of it was read */
  standards?: Pick<SeoStandardsView, 'originalScore' | 'mvpScore' | 'fixed' | 'regressed'>;
  /** The original's axe violations; the MVP's are not measured */
  accessibility?: { originalViolations: number };
  /** LCP in seconds and CLS of the MVP where it is hosted, next to the original's when the audit measured them */
  performance?: {
    host: string;
    measuredAt: string;
    lcp?: { mvp: number; original?: number };
    cls?: { mvp: number; original?: number };
    error?: string;
  };
  /** Only when key business data from the original site was lost, changed or made up */
  businessData?: { kept: number; checked: number; issues: MvpDataIssue[] };
}

const ISSUE_STATUSES: ReadonlyArray<MvpDataIssue['status']> = ['unsourced', 'missing', 'altered'];

const withOriginal = (mvp: number, original: number | undefined) => ({ mvp, ...(original !== undefined ? { original } : {}) });

/** The MVP compared with the original site, or null before an MVP exists */
export function summarizeMvpChanges(
  mvp: IMvpProjectDetail | null | undefined,
  audit: IAuditDetail | null | undefined,
): MvpChangeSummary | null {
  if (!mvp) return null;
  const summary: MvpChangeSummary = {};

  // The published page's standards checks against the original's (REV-118)
  const seo = seoStandardsView(audit, mvp);
  if (seo?.mvpScore !== undefined) {
    const { originalScore, mvpScore, fixed, regressed } = seo;
    summary.standards = { ...(originalScore !== undefined ? { originalScore } : {}), mvpScore, fixed, regressed };
  }

  if (audit?.a11yViolationsCount !== undefined) summary.accessibility = { originalViolations: audit.a11yViolationsCount };

  const measured = mvp.performance;
  if (measured) {
    const { lcp, cls } = measured.webVitals;
    summary.performance = {
      host: measured.host,
      measuredAt: String(measured.measuredAt),
      ...(lcp !== undefined ? { lcp: withOriginal(Math.round(lcp / 100) / 10, audit?.lcpSeconds) } : {}),
      ...(cls !== undefined ? { cls: withOriginal(cls, audit?.cls) } : {}),
      ...(measured.error ? { error: measured.error } : {}),
    };
  }

  const report = mvp.completenessReport;
  // A check that could not run says nothing about a change; the Audit step's data check shows it
  if (report?.status === 'verified') {
    // Fields the original site doesn't have are not part of what the MVP could keep
    const compared = report.checks.filter((check) => check.status !== 'not_in_source');
    const issues = compared
      .filter((check): check is typeof check & { status: MvpDataIssue['status'] } =>
        ISSUE_STATUSES.includes(check.status as MvpDataIssue['status']),
      )
      .sort((a, b) => ISSUE_STATUSES.indexOf(a.status) - ISSUE_STATUSES.indexOf(b.status))
      .map(({ field, status }) => ({ field, status }));
    if (issues.length > 0) {
      summary.businessData = {
        kept: compared.filter((check) => check.status === 'present').length,
        checked: compared.length,
        issues,
      };
    }
  }

  return summary;
}

/** True when the summary has nothing to show */
export function isMvpChangeSummaryEmpty(summary: MvpChangeSummary): boolean {
  return !summary.standards && !summary.accessibility && !summary.performance && !summary.businessData;
}
