/**
 * REV-105 migration: removes `lighthouseMetrics.speedIndex` (an estimate, not a measurement) and
 * `lighthouseMetrics.fidOrInp` from stored audits. Safe to run more than once.
 *
 *   npm run migrate:audit-vitals --workspace=@revamp/api            # apply
 *   npm run migrate:audit-vitals --workspace=@revamp/api -- --dry-run
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Audit } from '../models/Audit.model.js';
import { auditsWithRemovedVitals, unsetRemovedVitals } from '../services/audit-vitals-migration.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGODB_URI);

  // The raw collection: Mongoose's strict mode drops updates to paths the schema no longer has
  const count = dryRun
    ? await Audit.collection.countDocuments(auditsWithRemovedVitals())
    : (await Audit.collection.updateMany(auditsWithRemovedVitals(), unsetRemovedVitals())).modifiedCount;

  console.log(`[Migrate] ${dryRun ? 'Would clear' : 'Cleared'} unmeasured vitals from ${count} audit(s)`);
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
