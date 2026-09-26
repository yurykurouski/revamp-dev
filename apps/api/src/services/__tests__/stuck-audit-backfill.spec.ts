import { describe, it, expect } from 'vitest';
import { planStuckAuditUpdate } from '../stuck-audit-backfill.js';

describe('planStuckAuditUpdate (REV-44)', () => {
  it('moves a lead stuck in AUDITING after a failed audit to AUDIT_FAILED with a clean reason', () => {
    const plan = planStuckAuditUpdate(
      { _id: 'lead-1', status: 'AUDITING' },
      {
        status: 'FAILED',
        errorMessage: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/\nCall log:\n\x1B[2m  - navigating\x1B[22m',
      },
    );
    expect(plan).toEqual({
      status: 'AUDIT_FAILED',
      auditError: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/',
    });
  });

  it('gives a generic reason when the failed audit has no message', () => {
    expect(planStuckAuditUpdate({ _id: 'lead-1', status: 'AUDITING' }, { status: 'FAILED' })?.auditError).toBe(
      'Failed to complete audit inspection',
    );
  });

  it('leaves a lead whose audit is still running or queued', () => {
    expect(planStuckAuditUpdate({ _id: 'lead-1', status: 'AUDITING' }, { status: 'PROCESSING' })).toBeNull();
    expect(planStuckAuditUpdate({ _id: 'lead-1', status: 'AUDITING' }, { status: 'QUEUED' })).toBeNull();
  });

  it('leaves leads that are not in AUDITING or have no audit', () => {
    expect(planStuckAuditUpdate({ _id: 'lead-1', status: 'AUDITED' }, { status: 'FAILED' })).toBeNull();
    expect(planStuckAuditUpdate({ _id: 'lead-1', status: 'AUDITING' }, null)).toBeNull();
  });
});
