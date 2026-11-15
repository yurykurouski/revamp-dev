/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp covers delete, dropIndex and createIndex (REV-198).
 * REV-201: removes duplicate MvpProjects and EmailCampaigns per lead and makes `leadId` unique on both.
 * Run --apply with the workers stopped. Keeps the MVP the lead's previewUrl points at (else the newest) and the campaign furthest along
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
  // A queued deploy, edit or email job may name a record this removes; it would then fail
  if (apply) console.log('[Migrate] Run this with the workers stopped.');

  const report = await migrateLeadChildren(mongoose.connection, { apply });
  for (const [collection, { groups, index }] of Object.entries(report)) {
    for (const group of groups) {
      console.log(`[Migrate] ${collection} lead ${group.leadId}:`);
      for (const doc of group.docs) {
        const facts = [doc.status, doc.previewSlug && `slug ${doc.previewSlug}`, doc.updatedAt && `updated ${doc.updatedAt.toISOString()}`].filter(Boolean).join(', ');
        console.log(`[Migrate]   ${doc.kept ? 'keep  ' : apply ? 'removed' : 'remove'} ${doc.id} (${facts || 'no status or date'})`);
      }
      if (group.orphanedSlugs?.length) console.log(`[Migrate]   storage left behind: ${group.orphanedSlugs.map((slug) => `v/${slug}/`).join(', ')}`);
      if (group.sentRemoved.length) {
        console.warn(`[Migrate]   WARNING: ${group.sentRemoved.join(', ')} already went out; the unsubscribe and tracking links in that email stop working. Check before --apply.`);
      }
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
