import type mongoose from 'mongoose';
import { Types } from 'mongoose';
import { hashAddress } from './address-hash.js';
import { grantContactRight, type ContactRightDurations } from './contact-rights.js';
import { Business } from './models/Business.model.js';
import { Lead } from './models/Lead.model.js';
import { SuppressedAddress } from './models/SuppressedAddress.model.js';

/**
 * REV-224: leads made before the contact registry have no right, so nothing would stop a second studio from pitching
 * the same business. `migrateContactRights` gives the oldest studio lead of each unclaimed business a right (granted at
 * migration time, not back-dated: back-dating would expire every live pipeline at once), lists the other studios'
 * leads as conflicts without changing them, and turns an `UNSUBSCRIBED` lead into a business opt-out plus a suppressed
 * address hash. `checkContactRights` lets the API and workers say at startup that it still has to run.
 */

export const MIGRATE_CONTACT_RIGHTS_COMMAND = 'npm run migrate:contact-rights --workspace=@revamp/api';

export interface ContactRightsMigrationReport {
  /** False for a dry run: nothing was written */
  applied: boolean;
  rightsToGrant: number;
  businessesToOptOut: number;
  addressesToSuppress: number;
  /** Businesses where several studios have a lead: the oldest keeps the right, the others are not changed (REV-226 blocks their outreach) */
  conflicts: Array<{ businessId: string; keptLeadId: string; otherLeadIds: string[] }>;
}

/** Leads that ended without outreach; `UNSUBSCRIBED` is handled as an opt-out */
const CLOSED_STATUSES = ['REJECTED', 'AUDIT_FAILED'];

const hasStudioAndBusiness = { tenantId: { $type: 'objectId' }, businessId: { $type: 'objectId' } } as const;

interface MigrationLead {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  businessId: Types.ObjectId;
  status?: string;
  contactEmail?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const byOldest = (a: MigrationLead, b: MigrationLead) =>
  (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || String(a._id).localeCompare(String(b._id));

/** Plans and, with `apply`, runs the migration. Idempotent: a second run finds nothing to do */
export async function migrateContactRights(options: {
  apply: boolean;
  durations: ContactRightDurations;
  now?: Date;
}): Promise<ContactRightsMigrationReport> {
  const now = options.now ?? new Date();
  const leads = (await Lead.find(hasStudioAndBusiness, { tenantId: 1, businessId: 1, status: 1, contactEmail: 1, createdAt: 1, updatedAt: 1 }).lean()) as unknown as MigrationLead[];
  const byBusiness = new Map<string, MigrationLead[]>();
  for (const lead of leads) byBusiness.set(String(lead.businessId), [...(byBusiness.get(String(lead.businessId)) ?? []), lead]);
  const businesses = await Business.find(
    { _id: { $in: [...byBusiness.keys()].map((id) => new Types.ObjectId(id)) } },
    { contactHold: 1, optedOutAt: 1 },
  ).lean();

  const grants: Array<{ lead: MigrationLead }> = [];
  const optOuts: Array<{ businessId: Types.ObjectId; at: Date }> = [];
  const hashes = new Set<string>();
  const conflicts: ContactRightsMigrationReport['conflicts'] = [];

  for (const business of businesses) {
    const group = (byBusiness.get(String(business._id)) ?? []).sort(byOldest);
    const unsubscribed = group.filter((lead) => lead.status === 'UNSUBSCRIBED');
    if (unsubscribed.length > 0) {
      if (!business.optedOutAt) optOuts.push({ businessId: business._id, at: new Date(Math.min(...unsubscribed.map((lead) => (lead.updatedAt ?? lead.createdAt ?? now).getTime()))) });
      for (const lead of unsubscribed) if (lead.contactEmail) hashes.add(hashAddress(lead.contactEmail));
    }
    if (business.contactHold || business.optedOutAt || unsubscribed.length > 0) continue;
    // A closed lead (rejected, audit failed) never keeps the right: it would block another studio's live pipeline
    const [kept, ...others] = group.filter((lead) => !CLOSED_STATUSES.includes(lead.status ?? ''));
    if (!kept) continue;
    grants.push({ lead: kept });
    if (others.length > 0) conflicts.push({ businessId: String(business._id), keptLeadId: String(kept._id), otherLeadIds: others.map((lead) => String(lead._id)) });
  }

  const known = new Set((await SuppressedAddress.find({ hash: { $in: [...hashes] } }, { hash: 1 }).lean()).map((a) => a.hash));
  const missingHashes = [...hashes].filter((hash) => !known.has(hash));

  const report: ContactRightsMigrationReport = {
    applied: options.apply,
    rightsToGrant: grants.length,
    businessesToOptOut: optOuts.length,
    addressesToSuppress: missingHashes.length,
    conflicts,
  };
  if (!options.apply) return report;

  for (const { businessId, at } of optOuts) {
    await Business.updateOne({ _id: businessId, optedOutAt: { $exists: false } }, { $set: { optedOutAt: at } });
  }
  for (const hash of missingHashes) {
    await SuppressedAddress.updateOne({ hash }, { $setOnInsert: { hash } }, { upsert: true });
  }
  for (const { lead } of grants) {
    // A refusal here means a studio claimed the business since the plan was made: the normal path wins, nothing to do
    await grantContactRight({
      tenantId: lead.tenantId,
      businessId: lead.businessId,
      leadId: lead._id,
      source: 'MIGRATION',
      durations: options.durations,
      now,
    });
  }
  return report;
}

/** Startup warning (API and workers): says so while a business with a studio lead has neither a hold nor an opt-out */
export async function checkContactRights(connection: mongoose.Connection): Promise<string[]> {
  const [{ count } = { count: 0 }] = await connection
    .collection('businesses')
    .aggregate<{ count: number }>([
      { $match: { contactHold: { $exists: false }, optedOutAt: { $exists: false } } },
      { $lookup: { from: 'leads', localField: '_id', foreignField: 'businessId', pipeline: [{ $match: { tenantId: { $type: 'objectId' }, status: { $nin: CLOSED_STATUSES } } }, { $limit: 1 }], as: 'studioLeads' } },
      { $match: { studioLeads: { $ne: [] } } },
      { $count: 'count' },
    ])
    .toArray();
  if (count === 0) return [];
  return [
    `${count} business(es) with a studio lead have no contact right yet (REV-224): nothing stops two studios from pitching them until the migration ran. ` +
      `Run \`${MIGRATE_CONTACT_RIGHTS_COMMAND}\` (dry run), then \`-- --apply\`.`,
  ];
}
