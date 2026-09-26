import type { ILeadItem } from '../api/client.js';

const MAX_REJECT_REASON_LENGTH = 200;

/** Whether the dashboard shows the audit failure and its Retry / Reject actions (REV-44) */
export const isAuditFailed = (lead: Pick<ILeadItem, 'status'>): boolean => lead.status === 'AUDIT_FAILED';

/** Reason stored when the operator rejects a lead whose site could not be audited (REV-44) */
export const auditFailureRejectReason = (auditError: string | undefined): string =>
  `Audit failed: ${auditError || 'unknown error'}`.slice(0, MAX_REJECT_REASON_LENGTH);
