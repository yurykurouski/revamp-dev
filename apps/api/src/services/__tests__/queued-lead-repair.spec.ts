import { describe, expect, it } from 'vitest';
import { QUEUED_REPAIR_MIN_AGE_MS, planQueuedLeadRepair } from '../queued-lead-repair.js';

const now = new Date('2026-11-21T12:00:00Z');
const old = new Date(now.getTime() - QUEUED_REPAIR_MIN_AGE_MS - 1);
const lead = (id: string, updatedAt = old) => ({ _id: id, updatedAt });

describe('planQueuedLeadRepair (REV-202)', () => {
  it('waits 10 minutes before calling a queued lead stranded', () => {
    expect(QUEUED_REPAIR_MIN_AGE_MS).toBe(10 * 60_000);
  });

  it('repairs a queued lead with no audit', () => {
    const plan = planQueuedLeadRepair({ leads: [lead('L1')], latestAuditByLead: new Map(), leadIdsWithJob: new Set(), now });
    expect(plan).toEqual([{ leadId: 'L1', reason: 'no_audit' }]);
  });

  it('repairs a queued lead whose audit has no job', () => {
    const plan = planQueuedLeadRepair({
      leads: [lead('L1'), lead('L2')],
      latestAuditByLead: new Map([
        ['L1', { _id: 'A1', status: 'QUEUED' as const }],
        ['L2', { _id: 'A2', status: 'PROCESSING' as const }],
      ]),
      leadIdsWithJob: new Set(),
      now,
    });
    expect(plan).toEqual([
      { leadId: 'L1', auditId: 'A1', reason: 'no_job' },
      { leadId: 'L2', auditId: 'A2', reason: 'no_job' },
    ]);
  });

  it('leaves a lead alone while its job is waiting, delayed or running', () => {
    const plan = planQueuedLeadRepair({
      leads: [lead('L1')],
      latestAuditByLead: new Map([['L1', { _id: 'A1', status: 'QUEUED' as const }]]),
      leadIdsWithJob: new Set(['L1']),
      now,
    });
    expect(plan).toEqual([]);
  });

  it('leaves a lead changed in the last 10 minutes alone: its request may still be running', () => {
    const recent = new Date(now.getTime() - QUEUED_REPAIR_MIN_AGE_MS + 1000);
    const plan = planQueuedLeadRepair({ leads: [lead('L1', recent)], latestAuditByLead: new Map(), leadIdsWithJob: new Set(), now });
    expect(plan).toEqual([]);
  });
});
