import { describe, expect, it } from 'vitest';
import { SCHEDULED_REPAIR_MIN_AGE_MS, planScheduledLeadRepair } from '../scheduled-lead-repair.js';

const now = new Date('2026-11-22T12:00:00Z');
const old = new Date(now.getTime() - SCHEDULED_REPAIR_MIN_AGE_MS - 1);
const lead = (id: string, updatedAt = old) => ({ _id: id, updatedAt });

describe('planScheduledLeadRepair (REV-203)', () => {
  it('waits 10 minutes, longer than the 15–45 s send delay, before calling a lead stranded', () => {
    expect(SCHEDULED_REPAIR_MIN_AGE_MS).toBe(10 * 60_000);
  });

  it('repairs a scheduled lead with no campaign and no job', () => {
    expect(planScheduledLeadRepair({ leads: [lead('L1')], campaignStatusByLead: new Map(), leadIdsWithJob: new Set(), now })).toEqual([
      { leadId: 'L1', reason: 'no_campaign' },
    ]);
  });

  it('repairs a scheduled lead whose approved campaign has no job', () => {
    expect(
      planScheduledLeadRepair({ leads: [lead('L1')], campaignStatusByLead: new Map([['L1', 'SCHEDULED' as const]]), leadIdsWithJob: new Set(), now }),
    ).toEqual([{ leadId: 'L1', reason: 'no_job' }]);
  });

  it('skips a fresh lead, a lead with a waiting or delayed job, and a campaign the worker already took', () => {
    const plan = planScheduledLeadRepair({
      leads: [lead('fresh', new Date(now.getTime() - 60_000)), lead('job'), lead('sending'), lead('delivered'), lead('bounced')],
      campaignStatusByLead: new Map([
        ['job', 'SCHEDULED' as const],
        ['sending', 'SENDING' as const],
        ['delivered', 'DELIVERED' as const],
        ['bounced', 'BOUNCED' as const],
      ]),
      leadIdsWithJob: new Set(['job']),
      now,
    });
    expect(plan).toEqual([]);
  });

  it('leaves a lead whose send failed after its retries for the operator: the provider may have accepted it (review)', () => {
    expect(
      planScheduledLeadRepair({
        leads: [lead('failed')],
        campaignStatusByLead: new Map([['failed', 'SCHEDULED' as const]]),
        leadIdsWithJob: new Set(),
        leadIdsWithFailedJob: new Set(['failed']),
        now,
      }),
    ).toEqual([]);
  });
});
