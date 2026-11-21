import type { AuditStatus } from '@revamp/shared-types';

/** A QUEUED lead changed more recently than this may still have its add-lead request running (REV-202) */
export const QUEUED_REPAIR_MIN_AGE_MS = 10 * 60_000;

/** Written on a repaired lead and its audit; Retry audit recovers it */
export const QUEUED_REPAIR_ERROR = 'Found in QUEUED with no audit job (REV-202 repair). Retry the audit.';

export interface QueuedLeadRepair {
  leadId: string;
  auditId?: string;
  reason: 'no_audit' | 'no_job';
}

/**
 * REV-202 repair: picks the QUEUED leads no worker will ever take, those with no audit or with no
 * audit job in the queue, older than QUEUED_REPAIR_MIN_AGE_MS. The script moves them to AUDIT_FAILED.
 */
export function planQueuedLeadRepair(input: {
  leads: ReadonlyArray<{ _id: string; updatedAt: Date }>;
  latestAuditByLead: ReadonlyMap<string, { _id: string; status: AuditStatus } | undefined>;
  leadIdsWithJob: ReadonlySet<string>;
  now: Date;
}): QueuedLeadRepair[] {
  const plan: QueuedLeadRepair[] = [];
  for (const lead of input.leads) {
    if (input.now.getTime() - lead.updatedAt.getTime() < QUEUED_REPAIR_MIN_AGE_MS) continue;
    if (input.leadIdsWithJob.has(lead._id)) continue;
    const audit = input.latestAuditByLead.get(lead._id);
    plan.push(audit ? { leadId: lead._id, auditId: audit._id, reason: 'no_job' } : { leadId: lead._id, reason: 'no_audit' });
  }
  return plan;
}
