/**
 * REV-62 migration: moves leads stored with a status that was removed from the lead state machine
 * (PENDING, MVP_READY, AWAITING_APPROVAL, APPROVED, DISPATCHED, REPLIED) to the status that replaces it.
 * Safe to run more than once.
 *
 *   npm run migrate:lead-statuses --workspace=@revamp/api            # apply
 *   npm run migrate:lead-statuses --workspace=@revamp/api -- --dry-run
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { REMOVED_LEAD_STATUSES } from '../services/lead-status-migration.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGODB_URI);

  let total = 0;
  for (const [from, to] of Object.entries(REMOVED_LEAD_STATUSES)) {
    const count = dryRun
      ? await Lead.countDocuments({ status: from }).exec()
      : (await Lead.updateMany({ status: from }, { $set: { status: to } }).exec()).modifiedCount;
    total += count;
    if (count > 0) console.log(`[Migrate] ${from} → ${to}: ${count} lead(s)`);
  }

  console.log(`[Migrate] ${dryRun ? 'Would move' : 'Moved'} ${total} lead(s) off removed statuses`);
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
