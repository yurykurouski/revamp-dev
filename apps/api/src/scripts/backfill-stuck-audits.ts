/**
 * REV-44 backfill: moves leads stuck in AUDITING after a failed audit to AUDIT_FAILED, with the
 * audit's error as a readable one-line reason, and cleans that error on the Audit too.
 *
 *   npm run backfill:stuck-audits --workspace=@revamp/api            # apply
 *   npm run backfill:stuck-audits --workspace=@revamp/api -- --dry-run
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Audit } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';
import { planStuckAuditUpdate } from '../services/stuck-audit-backfill.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGODB_URI);

  const leads = await Lead.find({ status: 'AUDITING' }, { status: 1, originalUrl: 1 }).lean().exec();
  let updated = 0;
  for (const lead of leads) {
    const audit = await Audit.findOne({ leadId: lead._id }, { status: 1, errorMessage: 1 })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const set = planStuckAuditUpdate(lead, audit);
    if (!set) continue;
    updated++;
    console.log(`[Backfill] ${String(lead._id)} ${lead.originalUrl}: ${set.auditError}`);
    if (dryRun) continue;
    await Lead.updateOne({ _id: lead._id, status: 'AUDITING' }, { $set: set }).exec();
    await Audit.updateOne({ _id: audit!._id }, { $set: { errorMessage: set.auditError } }).exec();
  }

  console.log(`[Backfill] ${leads.length} lead(s) in AUDITING, ${dryRun ? 'would update' : 'updated'} ${updated}`);
}

main()
  .catch((error: unknown) => {
    console.error('[Backfill] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
