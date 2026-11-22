/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp is enough (REV-198).
 * REV-209: gives every lead that has no studio to one organization (the oldest, or the one named with
 * `--organization <id>`), and every MVP, campaign and event the studio of its lead. Until it ran, no studio sees those
 * records. Safe to repeat.
 *
 *   npm run migrate:tenants --workspace=@revamp/api                              # dry run
 *   npm run migrate:tenants --workspace=@revamp/api -- --apply
 *   npm run migrate:tenants --workspace=@revamp/api -- --apply --organization <id>
 */
import mongoose from 'mongoose';
import { TenantMigrationError, migrateTenants, redactMongoUri } from '@revamp/db';
import { env } from '../config/env.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const flag = process.argv.indexOf('--organization');
  const organizationId = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (flag >= 0 && (!organizationId || organizationId.startsWith('--'))) {
    throw new TenantMigrationError('--organization needs an organization id');
  }
  await mongoose.connect(env.MONGODB_URI);
  console.log(`[Migrate] ${redactMongoUri(env.MONGODB_URI)} — ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
  const report = await migrateTenants({ apply, ...(organizationId ? { organizationId } : {}) });
  const verb = apply ? 'assigned' : 'to assign';
  console.log(
    `[Migrate] organization ${report.organizationId}: ${report.leadsToAssign} lead(s) ${verb}; ` +
      `${report.mvpsToAssign} MVP(s), ${report.campaignsToAssign} campaign(s) and ${report.eventsToAssign} event(s) ${verb} to the studio of their lead`,
  );
  for (const c of report.conflicts) {
    console.warn(`[Migrate] business ${c.businessId} has ${c.leadIds.length} leads that would belong to one studio: ${c.leadIds.join(', ')}`);
  }
  if (report.conflicts.length > 0 && !apply) console.warn('[Migrate] --apply refuses until these duplicates are resolved');
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error instanceof TenantMigrationError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
