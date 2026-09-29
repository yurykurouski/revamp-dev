/**
 * Audit vitals migration. Safe to run more than once.
 *   REV-105: removes `lighthouseMetrics.speedIndex` (an estimate, not a measurement) and
 *            `lighthouseMetrics.fidOrInp` (never written) from stored audits.
 *   REV-102: renames `lighthouseMetrics` to `webVitals`; no Lighthouse runs. An audit re-run after the
 *            rename already has the newer `webVitals`, so its old field is dropped instead.
 *
 *   npm run migrate:audit-vitals --workspace=@revamp/api            # apply
 *   npm run migrate:audit-vitals --workspace=@revamp/api -- --dry-run
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Audit } from '../models/Audit.model.js';
import {
  auditsWithLegacyVitalsOnly,
  auditsWithRemovedVitals,
  auditsWithStaleLegacyVitals,
  renameLegacyVitals,
  unsetLegacyVitals,
  unsetRemovedVitals,
} from '../services/audit-vitals-migration.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGODB_URI);

  // The raw collection: Mongoose's strict mode drops updates to paths the schema no longer has
  const steps = [
    { label: 'unmeasured vitals cleared', filter: auditsWithRemovedVitals(), update: unsetRemovedVitals() },
    { label: 'lighthouseMetrics renamed to webVitals', filter: auditsWithLegacyVitalsOnly(), update: renameLegacyVitals() },
    { label: 'stale lighthouseMetrics dropped', filter: auditsWithStaleLegacyVitals(), update: unsetLegacyVitals() },
  ];
  for (const step of steps) {
    // A dry run counts each step on the current data, so a later step may count audits an earlier one would change
    const count = dryRun
      ? await Audit.collection.countDocuments(step.filter)
      : (await Audit.collection.updateMany(step.filter, step.update)).modifiedCount;
    console.log(`[Migrate] ${dryRun ? 'Would apply' : 'Applied'} "${step.label}" to ${count} audit(s)`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
