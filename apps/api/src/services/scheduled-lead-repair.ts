import type { EmailCampaignStatus } from '@revamp/shared-types';

/** A SCHEDULED lead changed more recently than this may still be waiting for its delayed send (REV-203) */
export const SCHEDULED_REPAIR_MIN_AGE_MS = 10 * 60_000;

export interface ScheduledLeadRepair {
  leadId: string;
  reason: 'no_campaign' | 'no_job';
}

/** Campaign statuses the email worker has taken or finished: such a lead is not stranded by a failed approval */
const TAKEN: ReadonlySet<EmailCampaignStatus> = new Set(['SENDING', 'DELIVERED', 'BOUNCED', 'REJECTED', 'UNSUBSCRIBED']);

/**
 * REV-203 repair: picks the SCHEDULED leads nothing will ever send, those with no campaign or with an approved campaign
 * and no email job in the queue, unchanged for SCHEDULED_REPAIR_MIN_AGE_MS. The script returns them to review.
 */
export function planScheduledLeadRepair(input: {
  leads: ReadonlyArray<{ _id: string; updatedAt: Date }>;
  campaignStatusByLead: ReadonlyMap<string, EmailCampaignStatus>;
  leadIdsWithJob: ReadonlySet<string>;
  now: Date;
}): ScheduledLeadRepair[] {
  const plan: ScheduledLeadRepair[] = [];
  for (const lead of input.leads) {
    if (input.now.getTime() - lead.updatedAt.getTime() < SCHEDULED_REPAIR_MIN_AGE_MS) continue;
    if (input.leadIdsWithJob.has(lead._id)) continue;
    const status = input.campaignStatusByLead.get(lead._id);
    if (status && TAKEN.has(status)) continue;
    plan.push({ leadId: lead._id, reason: status ? 'no_job' : 'no_campaign' });
  }
  return plan;
}
