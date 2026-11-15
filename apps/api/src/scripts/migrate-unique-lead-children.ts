/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp covers delete, dropIndex and createIndex (REV-198).
 * REV-201: removes duplicate MvpProjects and EmailCampaigns per lead and makes `leadId` unique on both.
 * Keeps the MVP the lead's previewUrl points at (else the newest) and the campaign furthest along
 * (UNSUBSCRIBED first, else the newest). Removed MVPs' storage folders are listed, not deleted.
 *
 *   npm run migrate:unique-lead-children --workspace=@revamp/api             # dry run
 *   npm run migrate:unique-lead-children --workspace=@revamp/api -- --apply
 */
import mongoose from 'mongoose';
import { migrateLeadChildren, redactMongoUri } from '@revamp/db';
import { env } from '../config/env.js';

async function main() {
  const apply = process.argv.includes('--apply');
  // No autoIndex: this script builds the leadId index itself, after the duplicates are gone
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false });
  console.log(`[Migrate] ${redactMongoUri(env.MONGODB_URI)} — ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);

  const report = await migrateLeadChildren(mongoose.connection, { apply });
  for (const [collection, { groups, index }] of Object.entries(report)) {
    for (const group of groups) {
      const orphaned = group.orphanedSlugs?.length ? `; storage left behind: ${group.orphanedSlugs.map((slug) => `v/${slug}/`).join(', ')}` : '';
      console.log(`[Migrate] ${collection} lead ${group.leadId}: keep ${group.keep}, ${apply ? 'removed' : 'would remove'} ${group.remove.join(', ')}${orphaned}`);
    }
    console.log(`[Migrate] ${collection}: ${groups.length} lead(s) with duplicates; leadId index ${index}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
