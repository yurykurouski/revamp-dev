import { describe, it, expect } from 'vitest';
import { auditFailureRejectReason, isAuditFailed } from '../auditFailure.js';

describe('audit failure helpers (REV-44)', () => {
  it('flags only AUDIT_FAILED leads', () => {
    expect(isAuditFailed({ status: 'AUDIT_FAILED' })).toBe(true);
    expect(isAuditFailed({ status: 'AUDITING' })).toBe(false);
    expect(isAuditFailed({ status: 'AUDITED' })).toBe(false);
  });

  it('builds a reject reason from the audit error', () => {
    expect(auditFailureRejectReason('net::ERR_CERT_DATE_INVALID')).toBe('Audit failed: net::ERR_CERT_DATE_INVALID');
  });

  it('keeps the reason within the 200-character limit of the reject endpoint', () => {
    expect(auditFailureRejectReason('x'.repeat(300))).toHaveLength(200);
  });

  it('still gives a valid reason when the error is missing', () => {
    expect(auditFailureRejectReason(undefined)).toBe('Audit failed: unknown error');
  });
});
