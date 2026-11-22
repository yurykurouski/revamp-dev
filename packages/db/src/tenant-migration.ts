import mongoose, { Types } from 'mongoose';
import { AnalyticsEvent } from './models/AnalyticsEvent.model.js';
import { EmailCampaign } from './models/EmailCampaign.model.js';
import { Lead } from './models/Lead.model.js';
import { MvpProject } from './models/MvpProject.model.js';
import { Organization } from './models/Organization.model.js';

/**
 * REV-209: the API shows a studio only the records that carry its `tenantId`, so a record made before the tenants
 * existed would be invisible to everyone. `migrateTenants` gives every lead without a studio to the organization you
 * name (default: the oldest one), and every MVP, campaign and event the studio of its lead; `checkTenantLinks` lets the
 * API and workers say at startup that it still has to run.
 */

export const MIGRATE_TENANTS_COMMAND = 'npm run migrate:tenants --workspace=@revamp/api';

/** The named organization does not exist, or there is none to give the records to */
export class TenantMigrationError extends Error {
  constructor(message: string, readonly conflicts: TenantMigrationReport['conflicts'] = []) {
    super(message);
    this.name = 'TenantMigrationError';
  }
}

export interface TenantMigrationReport {
  /** False for a dry run: nothing was written */
  applied: boolean;
  /** The organization that takes the leads that have no studio */
  organizationId: string;
  leadsToAssign: number;
  mvpsToAssign: number;
  campaignsToAssign: number;
  eventsToAssign: number;
  /** Businesses that two leads of the same studio would end up with: the unique `{ tenantId, businessId }` index refuses it */
  conflicts: Array<{ businessId: string; leadIds: string[] }>;
}

const missing = { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] };
/** An event that names a lead is the lead's; one that names none (an open of a token nobody holds) stays in no studio */
const missingOfLead = { ...missing, leadId: { $exists: true, $ne: null } };

async function pickOrganization(organizationId?: string): Promise<Types.ObjectId> {
  if (organizationId) {
    if (!Types.ObjectId.isValid(organizationId)) throw new TenantMigrationError(`"${organizationId}" is not an organization id`);
    const found = await Organization.findById(organizationId, { _id: 1 }).lean();
    if (!found) throw new TenantMigrationError(`Organization ${organizationId} does not exist`);
    return found._id;
  }
  const oldest = await Organization.findOne({}, { _id: 1 }).sort({ createdAt: 1, _id: 1 }).lean();
  if (!oldest) throw new TenantMigrationError('No organization exists yet: register one, then run the migration');
  return oldest._id;
}

/** Leads without a studio that share a business with each other, or with a lead the target organization already has */
async function findConflicts(organization: Types.ObjectId): Promise<TenantMigrationReport['conflicts']> {
  const legacy = await Lead.find({ ...missing, businessId: { $exists: true, $ne: null } }, { businessId: 1 }).lean();
  const byBusiness = new Map<string, string[]>();
  for (const lead of legacy) byBusiness.set(String(lead.businessId), [...(byBusiness.get(String(lead.businessId)) ?? []), String(lead._id)]);
  const owned = await Lead.find({ tenantId: organization, businessId: { $in: [...byBusiness.keys()].map((id) => new Types.ObjectId(id)) } }, { businessId: 1 }).lean();
  for (const lead of owned) byBusiness.set(String(lead.businessId), [...(byBusiness.get(String(lead.businessId)) ?? []), String(lead._id)]);
  return [...byBusiness].filter(([, ids]) => ids.length > 1).map(([businessId, leadIds]) => ({ businessId, leadIds }));
}

/** Plans and, with `apply`, runs the migration. Idempotent: a second run finds nothing to do */
export async function migrateTenants(options: { apply: boolean; organizationId?: string }): Promise<TenantMigrationReport> {
  const organization = await pickOrganization(options.organizationId);
  const children = [
    ['mvpsToAssign', MvpProject, missing],
    ['campaignsToAssign', EmailCampaign, missing],
    ['eventsToAssign', AnalyticsEvent, missingOfLead],
  ] as const;

  const report: TenantMigrationReport = {
    applied: options.apply,
    organizationId: String(organization),
    leadsToAssign: await Lead.countDocuments(missing),
    mvpsToAssign: 0,
    campaignsToAssign: 0,
    eventsToAssign: 0,
    conflicts: await findConflicts(organization),
  };
  for (const [key, model, filter] of children) report[key] = await model.countDocuments(filter);
  if (!options.apply) return report;
  if (report.conflicts.length > 0) {
    // Writing would stop halfway on the unique index: nothing is written until the duplicates are resolved
    throw new TenantMigrationError(
      `${report.conflicts.length} business(es) would get two leads of one studio; resolve them first (delete or merge the duplicate lead): ` +
        report.conflicts.map((c) => `${c.businessId} -> ${c.leadIds.join(', ')}`).join('; '),
      report.conflicts,
    );
  }

  await Lead.updateMany(missing, { $set: { tenantId: organization } });
  // A child takes the studio of its lead (the leads of every studio, not only the one just assigned)
  const studios = (await Lead.distinct('tenantId')) as Types.ObjectId[];
  for (const studio of studios) {
    const leadIds = await Lead.distinct('_id', { tenantId: studio });
    for (const [, model, filter] of children) {
      await model.updateMany({ ...filter, leadId: { $in: leadIds } }, { $set: { tenantId: studio } });
    }
  }
  // What names a lead that no longer exists goes to the chosen organization, so nothing stays unowned
  for (const [, model, filter] of children) await model.updateMany(filter, { $set: { tenantId: organization } });
  return report;
}

/** Startup warning (API and workers): says so while any record has no studio, with the command that fixes it */
export async function checkTenantLinks(connection: mongoose.Connection): Promise<string[]> {
  const counts = await Promise.all([
    connection.collection('leads').countDocuments(missing),
    connection.collection('mvpprojects').countDocuments(missing),
    connection.collection('emailcampaigns').countDocuments(missing),
    connection.collection('analyticsevents').countDocuments(missingOfLead),
  ]);
  const [leads, mvps, campaigns, events] = counts;
  if (counts.every((n) => n === 0)) return [];
  const what = [
    leads ? `${leads} lead(s)` : '',
    mvps ? `${mvps} MVP(s)` : '',
    campaigns ? `${campaigns} campaign(s)` : '',
    events ? `${events} event(s)` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return [
    `${what} belong to no studio yet (REV-209): no studio sees them until the migration ran. ` +
      `Run \`${MIGRATE_TENANTS_COMMAND}\` (dry run), then \`-- --apply\`.`,
  ];
}
