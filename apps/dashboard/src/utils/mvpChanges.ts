import { MVP_LAYOUT_VARIANTS } from '@revamp/shared-types';
import type { CompletenessField, CompletenessStatus, MvpLayoutVariant } from '@revamp/shared-types';
import type { IAuditDetail, IMvpProjectDetail } from '../api/client.js';
import { layoutRuleOf } from '../components/MvpLayoutChip.js';
import { MvpSourceSummary, summarizeMvpSource } from './llmChoice.js';
import { SeoStandardsView, seoStandardsView } from './seoStandards.js';

/** A key business fact the MVP lost, changed or showed without a source on the original site */
export interface MvpDataIssue {
  field: CompletenessField;
  status: Extract<CompletenessStatus, 'missing' | 'altered' | 'unsourced'>;
}

/**
 * What the generated MVP changed compared with the original site (REV-81). Every part comes from
 * data the pipeline stored: the layout choice, the copy source, the generated copy, the palette,
 * the completeness report and the audit. Only changes are listed: a part that stayed as it was on
 * the original site, or has no data, stays undefined (or empty), so the review omits it instead of
 * guessing (AGENTS.md §3.2.2).
 */
export interface MvpChangeSummary {
  layout?: { variant: MvpLayoutVariant; rule?: ReturnType<typeof layoutRuleOf> };
  copySource?: MvpSourceSummary;
  /** `services` only when the MVP's count differs from the service list the crawler found */
  sections?: { services?: { original: number; mvp: number }; about: boolean; trustSignals: number };
  /** Only when the MVP's primary color differs from the site's; `original` is absent when the site had none */
  palette?: { original?: string; mvp: string };
  /** Only when key business data from the original site was lost, changed or made up */
  businessData?: { kept: number; checked: number; issues: MvpDataIssue[] };
  /** The design critique's quick wins, given to the copy writer as guidance; not checked on the page */
  critiqueGuidance: string[];
  /** Only when the published MVP was checked and a check differs from the original's (REV-118) */
  seo?: Pick<SeoStandardsView, 'originalScore' | 'mvpScore' | 'fixed' | 'regressed'>;
}

const ISSUE_STATUSES: ReadonlyArray<MvpDataIssue['status']> = ['unsourced', 'missing', 'altered'];

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** The page's sections as the MVP record stores them; a malformed record yields nothing rather than a guess */
function readGeneratedContent(content: IMvpProjectDetail['generatedContent']) {
  const about = record(content?.['about']);
  const services = content?.['services'];
  const trustSignals = content?.['trustSignals'];
  return {
    hasAbout: Boolean(text(about?.['heading']) || text(about?.['body'])),
    services: Array.isArray(services) ? services.length : undefined,
    trustSignals: Array.isArray(trustSignals) ? trustSignals.length : 0,
  };
}

/** The MVP compared with the original site, or null before an MVP exists */
export function summarizeMvpChanges(
  mvp: IMvpProjectDetail | null | undefined,
  audit: IAuditDetail | null | undefined,
): MvpChangeSummary | null {
  if (!mvp) return null;
  const summary: MvpChangeSummary = { critiqueGuidance: [] };

  const variant = mvp.layout?.variant;
  if (variant && MVP_LAYOUT_VARIANTS.includes(variant)) {
    summary.layout = { variant, rule: layoutRuleOf(mvp.layout?.reasons) };
  }

  summary.copySource = summarizeMvpSource(mvp) ?? undefined;

  const content = readGeneratedContent(mvp.generatedContent);
  // Without the crawler's count there is nothing to compare the MVP's services with
  const originalServices = audit?.originalServiceCount;
  const services =
    content.services !== undefined && originalServices !== undefined && content.services !== originalServices
      ? { original: originalServices, mvp: content.services }
      : undefined;
  if (services || content.hasAbout || content.trustSignals > 0) {
    summary.sections = { services, about: content.hasAbout, trustSignals: content.trustSignals };
  }

  const mvpPrimary = text(mvp.colorPalette?.primary);
  if (mvpPrimary) {
    const original = text(audit?.colorPalette.primary);
    if (!original || original.toLowerCase() !== mvpPrimary.toLowerCase()) {
      summary.palette = { original, mvp: mvpPrimary };
    }
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

  // The published page's SEO and standards checks against the original's (REV-118); only what changed
  const seo = seoStandardsView(audit, mvp);
  if (seo?.mvpScore !== undefined && (seo.fixed.length > 0 || seo.regressed.length > 0)) {
    const { originalScore, mvpScore, fixed, regressed } = seo;
    summary.seo = { ...(originalScore !== undefined ? { originalScore } : {}), mvpScore, fixed, regressed };
  }

  summary.critiqueGuidance = (audit?.quickWins ?? []).map((win) => win.trim()).filter(Boolean);
  return summary;
}

/** True when the summary has nothing to show */
export function isMvpChangeSummaryEmpty(summary: MvpChangeSummary): boolean {
  return (
    !summary.layout &&
    !summary.copySource &&
    !summary.sections &&
    !summary.palette &&
    !summary.businessData &&
    !summary.seo &&
    summary.critiqueGuidance.length === 0
  );
}
