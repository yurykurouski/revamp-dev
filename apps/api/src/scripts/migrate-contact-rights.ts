/**
 * Runs as revamp_app (MONGODB_URI): readWrite on revamp is enough (REV-198).
 * REV-224: gives the oldest studio lead of each business without a contact right a right (granted now, for
 * CONTACT_RIGHT_DAYS), turns an UNSUBSCRIBED lead into a business opt-out plus a suppressed address hash, and lists the
 * other studios' leads of a claimed business as conflicts (they are not changed). Dry run by default, safe to repeat.
 *
 *   npm run migrate:contact-rights --workspace=@revamp/api                # dry run
 *   npm run migrate:contact-rights --workspace=@revamp/api -- --apply
 */
import mongoose from 'mongoose';
import { migrateContactRights, redactMongoUri } from '@revamp/db';
import { env } from '../config/env.js';

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGODB_URI);
  console.log(`[Migrate] ${redactMongoUri(env.MONGODB_URI)} — ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
  const report = await migrateContactRights({
    apply,
    durations: { rightDays: env.CONTACT_RIGHT_DAYS, cooldownDays: env.CONTACT_COOLDOWN_DAYS },
  });
  const verb = apply ? 'granted' : 'to grant';
  console.log(
    `[Migrate] ${report.rightsToGrant} right(s) ${verb} (${env.CONTACT_RIGHT_DAYS} days each); ` +
      `${report.businessesToOptOut} business(es) ${apply ? 'opted out' : 'to opt out'}; ` +
      `${report.addressesToSuppress} address hash(es) ${apply ? 'suppressed' : 'to suppress'}`,
  );
  for (const c of report.conflicts) {
    console.warn(`[Migrate] business ${c.businessId}: lead ${c.keptLeadId} keeps the right; other studios' leads ${c.otherLeadIds.join(', ')} are left unchanged`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[Migrate] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
