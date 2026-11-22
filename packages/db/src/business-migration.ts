import type mongoose from 'mongoose';
import { Audit } from './models/Audit.model.js';
import { Business } from './models/Business.model.js';
import { Lead } from './models/Lead.model.js';
import { retryOnDuplicateKey } from './retry-duplicate-key.js';

/**
 * REV-208: a lead made before the split has no `businessId`, and its audits none either. `migrateBusinesses` gives
 * every such lead the shared `Business` of its domain (created from the oldest lead of the domain on first sight) and
 * every audit the business of its lead; `checkBusinessLinks` lets the API and workers say at startup that it still
 * has to run. It assigns no tenant: that is REV-210.
 */

export const MIGRATE_BUSINESSES_COMMAND = 'npm run migrate:businesses --workspace=@revamp/api';

export interface BusinessMigrationReport {
  /** False for a dry run: nothing was written */
  applied: boolean;
  leadsToLink: number;
  businessesToCreate: number;
  auditsToLink: number;
}

const unlinked = { $or: [{ businessId: { $exists: false } }, { businessId: null }] };

/** Plans and, with `apply`, runs the backfill. Idempotent: a second run finds nothing to do */
export async function migrateBusinesses(options: { apply: boolean }): Promise<BusinessMigrationReport> {
  const report: BusinessMigrationReport = { applied: options.apply, leadsToLink: 0, businessesToCreate: 0, auditsToLink: 0 };

  // The oldest lead of a domain gives the business its name, URL, niche and city
  const legacy = await Lead.find(unlinked, { domain: 1, originalUrl: 1, businessName: 1, niche: 1, city: 1, createdAt: 1 })
    .sort({ createdAt: 1 })
    .lean();
  const byDomain = new Map<string, typeof legacy>();
  for (const lead of legacy) {
    const key = String(lead.domain).toLowerCase();
    byDomain.set(key, [...(byDomain.get(key) ?? []), lead]);
  }

  for (const [domain, leads] of byDomain) {
    const first = leads[0]!;
    let business = await Business.findOne({ domain }, { _id: 1 }).lean();
    if (!business) {
      report.businessesToCreate++;
      if (options.apply) {
        // A running API may create the same business meanwhile: the unique domain then fails one upsert, and a second
        // try finds it
        business = await retryOnDuplicateKey(() =>
          Business.findOneAndUpdate(
            { domain },
            {
              $setOnInsert: {
                originalUrl: first.originalUrl,
                businessName: first.businessName,
                niche: first.niche ?? 'other',
                ...(first.city ? { city: first.city } : {}),
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean(),
        );
      }
    }
    report.leadsToLink += leads.length;
    // Audits of these leads that have no business yet
    const leadIds = leads.map((l) => l._id);
    report.auditsToLink += await Audit.countDocuments({ leadId: { $in: leadIds }, businessId: { $exists: false } });
    if (options.apply && business) {
      await Lead.updateMany({ _id: { $in: leadIds } }, { $set: { businessId: business._id } });
      await Audit.updateMany({ leadId: { $in: leadIds }, businessId: { $exists: false } }, { $set: { businessId: business._id } });
    }
  }
  // Audits that still have no business although their lead is linked (an old API during a rolling deploy). The audits
  // of unlinked leads were linked above when applying and are not matched here: their lead has no business yet
  const orphaned = await Audit.find({ businessId: { $exists: false } }, { leadId: 1 }).lean();
  if (orphaned.length > 0) {
    const leadBusiness = new Map(
      (await Lead.find({ _id: { $in: orphaned.map((a) => a.leadId) }, businessId: { $exists: true } }, { businessId: 1 }).lean()).map((l) => [String(l._id), l.businessId]),
    );
    const ops = orphaned.flatMap((audit) => {
      const businessId = leadBusiness.get(String(audit.leadId));
      return businessId ? [{ updateOne: { filter: { _id: audit._id, businessId: { $exists: false } }, update: { $set: { businessId } } } }] : [];
    });
    report.auditsToLink += ops.length;
    if (options.apply && ops.length > 0) await Audit.bulkWrite(ops);
  }
  return report;
}

/** Startup warning (API and workers): says so while any lead or audit has no business, with the command that fixes it */
export async function checkBusinessLinks(connection: mongoose.Connection): Promise<string[]> {
  const [leads, audits] = await Promise.all([
    connection.collection('leads').countDocuments(unlinked),
    // An audit of a lead that is not linked yet is covered by the lead; these are the ones the lead's link does not reach
    connection.collection('audits').countDocuments({ businessId: { $exists: false } }),
  ]);
  if (leads === 0 && audits === 0) return [];
  const what = [leads > 0 ? `${leads} lead(s)` : '', audits > 0 ? `${audits} audit(s)` : ''].filter(Boolean).join(' and ');
  return [
    `${what} have no shared business yet (REV-208): they keep working, but another studio adding the same site ` +
      `would audit it again. Run \`${MIGRATE_BUSINESSES_COMMAND}\` (dry run), then \`-- --apply\`.`,
  ];
}
