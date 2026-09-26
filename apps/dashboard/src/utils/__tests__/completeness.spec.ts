import { describe, it, expect } from 'vitest';
import type { ICompletenessCheck, IMvpCompletenessReport, IMvpCompletenessSummary } from '@revamp/shared-types';
import {
  COMPLETENESS_STATUS_COLOR,
  approvalNeedsConfirmation,
  completenessMethodInfo,
  criticalIssueFields,
  sortCompletenessChecks,
} from '../completeness.js';

const report = (checks: ICompletenessCheck[], status: 'verified' | 'unverified' = 'verified'): IMvpCompletenessReport => ({
  status,
  score: 70,
  hasCriticalIssues: false,
  checks,
  checkedAt: '2026-09-26T10:00:00.000Z',
});

describe('MVP completeness in the dashboard (REV-36)', () => {
  it('needs an extra approval confirmation when a critical field is missing, altered or unsourced', () => {
    for (const status of ['missing', 'altered', 'unsourced'] as const) {
      const r = report([{ field: 'phone', tier: 'critical', status }]);
      expect(approvalNeedsConfirmation(r), status).toBe(true);
      expect(criticalIssueFields(r)).toEqual(['phone']);
    }
  });

  it('does not ask for confirmation when only important or informational fields have gaps', () => {
    const r = report([
      { field: 'phone', tier: 'critical', status: 'present' },
      { field: 'address', tier: 'critical', status: 'not_in_source' },
      { field: 'services', tier: 'important', status: 'missing' },
      { field: 'logo', tier: 'informational', status: 'missing' },
    ]);
    expect(approvalNeedsConfirmation(r)).toBe(false);
  });

  it('does not ask for confirmation for an unverified report or when there is no report', () => {
    expect(approvalNeedsConfirmation(report([{ field: 'phone', tier: 'critical', status: 'missing' }], 'unverified'))).toBe(false);
    expect(approvalNeedsConfirmation(undefined, undefined)).toBe(false);
    expect(approvalNeedsConfirmation(null, null)).toBe(false);
  });

  it('falls back to the leads-list summary until the full report is loaded', () => {
    const summary: IMvpCompletenessSummary = {
      status: 'verified',
      score: 40,
      hasCriticalIssues: true,
      criticalIssues: ['email', 'address'],
    };
    expect(criticalIssueFields(undefined, summary)).toEqual(['email', 'address']);
    expect(approvalNeedsConfirmation(undefined, summary)).toBe(true);
    expect(criticalIssueFields(undefined, { ...summary, status: 'unverified' })).toEqual([]);
  });

  it('prefers the full report over the summary', () => {
    const summary: IMvpCompletenessSummary = { status: 'verified', hasCriticalIssues: true, criticalIssues: ['email'] };
    const fresh = report([{ field: 'email', tier: 'critical', status: 'present' }]);
    expect(approvalNeedsConfirmation(fresh, summary)).toBe(false);
  });

  it('lists each critical field once', () => {
    const r = report([
      { field: 'phone', tier: 'critical', status: 'altered' },
      { field: 'phone', tier: 'critical', status: 'unsourced' },
    ]);
    expect(criticalIssueFields(r)).toEqual(['phone']);
  });

  it('sorts checks by tier, with problems first inside a tier', () => {
    const sorted = sortCompletenessChecks([
      { field: 'logo', tier: 'informational', status: 'missing' },
      { field: 'services', tier: 'important', status: 'present' },
      { field: 'email', tier: 'critical', status: 'present' },
      { field: 'address', tier: 'critical', status: 'not_in_source' },
      { field: 'phone', tier: 'critical', status: 'unsourced' },
      { field: 'socialLinks', tier: 'important', status: 'missing' },
    ]);
    expect(sorted.map((c) => `${c.tier}:${c.field}`)).toEqual([
      'critical:phone',
      'critical:email',
      'critical:address',
      'important:socialLinks',
      'important:services',
      'informational:logo',
    ]);
  });

  it('does not mutate the checks it sorts', () => {
    const checks: ICompletenessCheck[] = [
      { field: 'logo', tier: 'informational', status: 'present' },
      { field: 'phone', tier: 'critical', status: 'present' },
    ];
    sortCompletenessChecks(checks);
    expect(checks[0]?.field).toBe('logo');
  });

  it('colors problems as errors or warnings and fine fields as success', () => {
    expect(COMPLETENESS_STATUS_COLOR.present).toBe('success');
    expect(COMPLETENESS_STATUS_COLOR.missing).toBe('error');
    expect(COMPLETENESS_STATUS_COLOR.unsourced).toBe('error');
    expect(COMPLETENESS_STATUS_COLOR.altered).toBe('warning');
    expect(COMPLETENESS_STATUS_COLOR.not_in_source).toBe('default');
  });

  describe('completenessMethodInfo (REV-37)', () => {
    it('reports an LLM-judged report with its model', () => {
      expect(completenessMethodInfo({ ...report([]), method: 'llm', model: 'claude-cli:sonnet' })).toEqual({
        method: 'llm',
        model: 'claude-cli:sonnet',
      });
    });

    it('reports a code-only report, with the LLM error when it fell back', () => {
      expect(completenessMethodInfo({ ...report([]), method: 'deterministic' })).toEqual({ method: 'deterministic' });
      expect(completenessMethodInfo({ ...report([]), method: 'deterministic', llmError: 'timed out' })).toEqual({
        method: 'deterministic',
        fallbackError: 'timed out',
      });
    });

    it('treats reports saved before the LLM check as code-only', () => {
      expect(completenessMethodInfo(report([]))).toEqual({ method: 'deterministic' });
    });

    it('has nothing to say for unverified or absent reports', () => {
      expect(completenessMethodInfo(report([], 'unverified'))).toBeUndefined();
      expect(completenessMethodInfo(undefined)).toBeUndefined();
    });
  });
});
