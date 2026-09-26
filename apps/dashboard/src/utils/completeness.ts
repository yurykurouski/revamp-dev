import type {
  CompletenessField,
  CompletenessStatus,
  CompletenessTier,
  ICompletenessCheck,
  IMvpCompletenessReport,
  IMvpCompletenessSummary,
} from '@revamp/shared-types';
import { criticalCompletenessIssues } from '@revamp/validation';

/** MUI chip color per check status (REV-36) */
export const COMPLETENESS_STATUS_COLOR: Record<
  CompletenessStatus,
  'success' | 'error' | 'warning' | 'default'
> = {
  present: 'success',
  missing: 'error',
  altered: 'warning',
  unsourced: 'error',
  not_in_source: 'default',
};

const TIER_ORDER: Record<CompletenessTier, number> = { critical: 0, important: 1, informational: 2 };
const STATUS_ORDER: Record<CompletenessStatus, number> = {
  unsourced: 0,
  missing: 1,
  altered: 2,
  present: 3,
  not_in_source: 4,
};

/** Critical first, and within a tier the problems before what's fine */
export function sortCompletenessChecks(checks: ICompletenessCheck[]): ICompletenessCheck[] {
  return [...checks].sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
}

/**
 * Critical fields the MVP lost, changed or made up. Reads the full report when the inspector has
 * it, else the summary from the leads list.
 */
export function criticalIssueFields(
  report?: IMvpCompletenessReport | null,
  summary?: IMvpCompletenessSummary | null,
): CompletenessField[] {
  if (report) {
    return report.status === 'verified' ? (criticalCompletenessIssues(report.checks) as CompletenessField[]) : [];
  }
  return summary?.status === 'verified' ? summary.criticalIssues : [];
}

/** Approving needs an explicit extra confirmation while critical data is missing or changed */
export function approvalNeedsConfirmation(
  report?: IMvpCompletenessReport | null,
  summary?: IMvpCompletenessSummary | null,
): boolean {
  return criticalIssueFields(report, summary).length > 0;
}

/**
 * How the report was made (REV-37). Reports saved before the LLM check have no method: code made
 * them. `fallbackError` is set when the LLM was tried and failed, so code's result is shown.
 */
export function completenessMethodInfo(
  report?: IMvpCompletenessReport | null,
): { method: 'llm' | 'deterministic'; model?: string; fallbackError?: string } | undefined {
  if (!report || report.status !== 'verified') return undefined;
  if (report.method === 'llm') return { method: 'llm', model: report.model || '?' };
  return { method: 'deterministic', fallbackError: report.llmError || undefined };
}
