/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp is enough (REV-198).
 * REV-208: gives every lead made before the split the shared Business of its domain, and every audit the business of
 * its lead. Leads that share a domain share one business. It assigns no tenant (REV-210). Safe to repeat.
 *
 *   npm run migrate:businesses --workspace=@revamp/api             # dry run
 *   npm run migrate:businesses --workspace=@revamp/api -- --apply
 */
import mongoose from 'mongoose';
import { migrateBusinesses, redactMongoUri } from '@revamp/db';
import { env } from '../config/env.js';

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGODB_URI);
  console.log(`[Migrate] ${redactMongoUri(env.MONGODB_URI)} — ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
  const report = await migrateBusinesses({ apply });
  console.log(
    `[Migrate] ${report.leadsToLink} lead(s) ${apply ? 'linked' : 'to link'}, ` +
      `${report.businessesToCreate} business(es) ${apply ? 'created' : 'to create'}, ` +
      `${report.auditsToLink} audit(s) ${apply ? 'linked' : 'to link'}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
