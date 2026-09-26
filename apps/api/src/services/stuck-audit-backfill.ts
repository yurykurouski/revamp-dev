import { sanitizeAuditError } from '@revamp/validation';

export interface StuckAuditLead {
  _id: unknown;
  status: string;
}

export interface LatestAudit {
  status: string;
  errorMessage?: string;
}

/**
 * REV-44 backfill: a lead left in AUDITING whose latest audit FAILED is moved to AUDIT_FAILED with
 * a readable reason, so the dashboard offers a retry. Returns the `$set` to apply, or null.
 */
export function planStuckAuditUpdate(
  lead: StuckAuditLead,
  latestAudit: LatestAudit | null | undefined,
): { status: 'AUDIT_FAILED'; auditError: string } | null {
  if (lead.status !== 'AUDITING' || latestAudit?.status !== 'FAILED') return null;
  return { status: 'AUDIT_FAILED', auditError: sanitizeAuditError(latestAudit.errorMessage ?? '') };
}
