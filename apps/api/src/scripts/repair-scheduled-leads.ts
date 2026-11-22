/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp is enough (REV-198).
 * REV-203 repair: returns to review the leads stranded in SCHEDULED by an approval whose send was never queued (no
 * campaign, or an approved campaign with no email job, for at least 10 minutes), so the operator can approve again.
 * Each lead and its campaign go back in one transaction (`revertOutreachApproval`).
 *
 *   npm run repair:scheduled-leads --workspace=@revamp/api               # dry run
 *   npm run repair:scheduled-leads --workspace=@revamp/api -- --apply
 */
import mongoose from 'mongoose';
import { redactMongoUri } from '@revamp/db';
import type { EmailCampaignStatus } from '@revamp/shared-types';
import { env } from '../config/env.js';
import { EmailCampaign, revertOutreachApproval } from '../models/EmailCampaign.model.js';
import { Lead } from '../models/Lead.model.js';
import { emailQueue } from '../queues/email.queue.js';
import { redisConnection } from '../queues/connection.js';
import { planScheduledLeadRepair } from '../services/scheduled-lead-repair.js';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`[Repair] ${apply ? 'Applying' : 'Dry run'} on ${redactMongoUri(env.MONGODB_URI)}`);
  await mongoose.connect(env.MONGODB_URI);

  const leads = await Lead.find({ status: 'SCHEDULED' }, { updatedAt: 1, businessName: 1 }).lean().exec();
  const campaigns = await EmailCampaign.find({ leadId: { $in: leads.map((l) => l._id) } }, { leadId: 1, status: 1 }).lean().exec();
  const campaignStatusByLead = new Map(campaigns.map((c) => [String(c.leadId), c.status as EmailCampaignStatus]));
  const jobs = await emailQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized', 'paused', 'waiting-children']);
  const leadIdsWithJob = new Set(jobs.map((job) => job?.data?.leadId).filter((id): id is string => Boolean(id)));
  // A send that failed after its retries may still have reached the provider: such a lead is listed, never reverted
  const failed = await emailQueue.getJobs(['failed']);
  const leadIdsWithFailedJob = new Set(failed.map((job) => job?.data?.leadId).filter((id): id is string => Boolean(id)));
  for (const id of leadIdsWithFailedJob) {
    if (leads.some((lead) => String(lead._id) === id)) console.log(`[Repair] ${id}: SCHEDULED with a failed send job; check it by hand, not reverted`);
  }

  const plan = planScheduledLeadRepair({
    leads: leads.map((lead) => ({ _id: String(lead._id), updatedAt: lead.updatedAt as Date })),
    campaignStatusByLead,
    leadIdsWithJob,
    leadIdsWithFailedJob,
    now: new Date(),
  });

  const names = new Map(leads.map((lead) => [String(lead._id), lead.businessName]));
  let repaired = 0;
  for (const item of plan) {
    console.log(`[Repair] ${item.leadId} ${names.get(item.leadId)}: ${item.reason}`);
    if (apply && (await revertOutreachApproval(item.leadId))) repaired++;
  }

  console.log(
    `[Repair] ${leads.length} lead(s) in SCHEDULED, ${plan.length} stranded, ${apply ? `returned ${repaired} to review` : 'nothing changed (dry run; pass --apply)'}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[Repair] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // BullMQ leaves the shared Redis connection open, so quit it too
    await Promise.allSettled([mongoose.disconnect(), emailQueue.close().then(() => redisConnection.quit())]);
  });
