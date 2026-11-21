/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp is enough (REV-198).
 * REV-202 repair: moves leads stranded in QUEUED (no audit, or no audit job in the queue, for at least
 * 10 minutes) to AUDIT_FAILED with a readable reason, so the dashboard offers Retry audit.
 *
 *   npm run repair:queued-leads --workspace=@revamp/api               # dry run
 *   npm run repair:queued-leads --workspace=@revamp/api -- --apply
 */
import mongoose from 'mongoose';
import { redactMongoUri } from '@revamp/db';
import { env } from '../config/env.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { auditQueue } from '../queues/audit.queue.js';
import { redisConnection } from '../queues/connection.js';
import { QUEUED_REPAIR_ERROR, planQueuedLeadRepair } from '../services/queued-lead-repair.js';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`[Repair] ${apply ? 'Applying' : 'Dry run'} on ${redactMongoUri(env.MONGODB_URI)}`);
  await mongoose.connect(env.MONGODB_URI);

  const leads = await Lead.find({ status: 'QUEUED' }, { updatedAt: 1, originalUrl: 1 }).lean().exec();
  const latestAuditByLead = new Map<string, { _id: string; status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' }>();
  for (const lead of leads) {
    const audit = await Audit.findOne({ leadId: lead._id }, { status: 1 }).sort({ createdAt: -1 }).lean().exec();
    if (audit) latestAuditByLead.set(String(lead._id), { _id: String(audit._id), status: audit.status });
  }
  const jobs = await auditQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized', 'paused', 'waiting-children']);
  const leadIdsWithJob = new Set(jobs.map((job) => job?.data?.leadId).filter((id): id is string => Boolean(id)));

  const plan = planQueuedLeadRepair({
    leads: leads.map((lead) => ({ _id: String(lead._id), updatedAt: lead.updatedAt as Date })),
    latestAuditByLead,
    leadIdsWithJob,
    now: new Date(),
  });

  const urls = new Map(leads.map((lead) => [String(lead._id), lead.originalUrl]));
  let repaired = 0;
  for (const item of plan) {
    console.log(`[Repair] ${item.leadId} ${urls.get(item.leadId)}: ${item.reason}`);
    if (!apply) continue;
    const moved = await Lead.findOneAndUpdate(
      { _id: item.leadId, status: 'QUEUED' },
      { $set: { status: 'AUDIT_FAILED', auditError: QUEUED_REPAIR_ERROR } },
    ).exec();
    if (!moved) continue;
    repaired++;
    if (item.auditId) {
      await Audit.updateOne(
        { _id: item.auditId, status: { $in: ['QUEUED', 'PROCESSING'] } },
        { $set: { status: 'FAILED', errorMessage: QUEUED_REPAIR_ERROR } },
      ).exec();
    }
  }

  console.log(
    `[Repair] ${leads.length} lead(s) in QUEUED, ${plan.length} stranded, ${apply ? `repaired ${repaired}` : 'nothing changed (dry run; pass --apply)'}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[Repair] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // BullMQ leaves the shared Redis connection open, so quit it too
    await Promise.allSettled([mongoose.disconnect(), auditQueue.close().then(() => redisConnection.quit())]);
  });
