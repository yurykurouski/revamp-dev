/**
 * REV-201: a lead has at most one MvpProject and one EmailCampaign, enforced by a unique `leadId` index.
 * A database made before REV-201 has a plain `leadId_1` index that Mongoose's autoIndex cannot turn
 * unique (same name, other options), and may hold duplicates that would fail the build.
 * `migrateLeadChildren` removes the duplicates and rebuilds the index; `checkLeadChildIndexes` lets
 * the API and workers say at startup that it still has to run.
 */
import type mongoose from 'mongoose';

export const LEAD_CHILD_COLLECTIONS = { mvp: 'mvpprojects', campaign: 'emailcampaigns' } as const;
export type LeadChildKind = keyof typeof LEAD_CHILD_COLLECTIONS;
type LeadChildCollection = (typeof LEAD_CHILD_COLLECTIONS)[LeadChildKind];

export const MIGRATE_LEAD_CHILDREN_COMMAND = 'npm run migrate:unique-lead-children --workspace=@revamp/api';

/** Which duplicate campaign to keep: the one furthest along, so an opt-out or a sent email is never lost */
export const CAMPAIGN_KEEP_RANK = [
  'UNSUBSCRIBED',
  'DELIVERED',
  'BOUNCED',
  'SENDING',
  'SCHEDULED',
  'APPROVED',
  'REJECTED',
  'NEEDS_APPROVAL',
  'DRAFT',
] as const;

export interface DedupeDoc {
  _id: unknown;
  previewSlug?: string;
  status?: string;
  updatedAt?: Date;
}

export interface DedupeGroup {
  leadId: string;
  keep: string;
  remove: string[];
  /** MVPs only: storage folders `v/<slug>/` the removed projects leave behind (not deleted) */
  orphanedSlugs?: string[];
}

export interface CollectionReport {
  groups: DedupeGroup[];
  index: 'unique' | 'rebuilt' | 'would-rebuild';
}

export type MigrationReport = Record<LeadChildCollection, CollectionReport>;

const time = (doc: DedupeDoc) => doc.updatedAt?.getTime() ?? 0;
const rank = (status?: string) => {
  const at = CAMPAIGN_KEEP_RANK.indexOf(status as (typeof CAMPAIGN_KEEP_RANK)[number]);
  return at === -1 ? CAMPAIGN_KEEP_RANK.length : at;
};

/**
 * Picks the record to keep among one lead's duplicates. MVP: the one whose slug the lead's
 * previewUrl points at, else the newest. Campaign: the highest CAMPAIGN_KEEP_RANK, else the newest.
 */
export function planLeadChildDedupe(
  kind: LeadChildKind,
  docs: DedupeDoc[],
  previewUrl?: string,
): { keep: string; remove: string[] } {
  const sorted = [...docs].sort((a, b) => {
    if (kind === 'mvp') {
      const pointed = (doc: DedupeDoc) => (previewUrl && doc.previewSlug && previewUrl.includes(`/v/${doc.previewSlug}/`) ? 0 : 1);
      if (pointed(a) !== pointed(b)) return pointed(a) - pointed(b);
    } else if (rank(a.status) !== rank(b.status)) {
      return rank(a.status) - rank(b.status);
    }
    return time(b) - time(a);
  });
  const [keep, ...remove] = sorted.map((doc) => String(doc._id));
  return { keep: keep!, remove };
}

async function leadIdIndexIsUnique(conn: mongoose.Connection, name: string): Promise<boolean | undefined> {
  const exists = await conn.db!.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) return undefined;
  const index = (await conn.db!.collection(name).indexes()).find((ix) => ix.name === 'leadId_1');
  return index ? index.unique === true : undefined;
}

async function migrateCollection(conn: mongoose.Connection, kind: LeadChildKind, apply: boolean): Promise<CollectionReport> {
  const name = LEAD_CHILD_COLLECTIONS[kind];
  const collection = conn.db!.collection(name);
  const duplicates = await collection
    .aggregate<{ _id: unknown; docs: DedupeDoc[] }>([
      { $group: { _id: '$leadId', count: { $sum: 1 }, docs: { $push: { _id: '$_id', previewSlug: '$previewSlug', status: '$status', updatedAt: '$updatedAt' } } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  const previewUrls = new Map<string, string>();
  if (kind === 'mvp' && duplicates.length > 0) {
    const leads = await conn.db!
      .collection('leads')
      .find({ _id: { $in: duplicates.map((group) => group._id) } } as Record<string, unknown>, { projection: { previewUrl: 1 } })
      .toArray();
    for (const lead of leads) if (typeof lead['previewUrl'] === 'string') previewUrls.set(String(lead._id), lead['previewUrl']);
  }

  const groups: DedupeGroup[] = duplicates.map((group) => {
    const plan = planLeadChildDedupe(kind, group.docs, previewUrls.get(String(group._id)));
    const result: DedupeGroup = { leadId: String(group._id), ...plan };
    if (kind === 'mvp') {
      result.orphanedSlugs = group.docs
        .filter((doc) => plan.remove.includes(String(doc._id)) && doc.previewSlug)
        .map((doc) => doc.previewSlug!);
    }
    return result;
  });

  const unique = await leadIdIndexIsUnique(conn, name);
  if (unique === true && groups.length === 0) return { groups, index: 'unique' };
  if (!apply) return { groups, index: unique === true ? 'unique' : 'would-rebuild' };

  const removeIds = new Set(groups.flatMap((group) => group.remove));
  const ids = duplicates.flatMap((group) => group.docs.map((doc) => doc._id)).filter((id) => removeIds.has(String(id)));
  if (ids.length > 0) await collection.deleteMany({ _id: { $in: ids } } as Record<string, unknown>);
  if (unique === true) return { groups, index: 'unique' };
  if (unique === false) await collection.dropIndex('leadId_1');
  await collection.createIndex({ leadId: 1 }, { unique: true, name: 'leadId_1' });
  return { groups, index: 'rebuilt' };
}

/** Removes duplicate MvpProjects and EmailCampaigns per lead and makes `leadId_1` unique. Dry run unless `apply` */
export async function migrateLeadChildren(conn: mongoose.Connection, { apply }: { apply: boolean }): Promise<MigrationReport> {
  return {
    mvpprojects: await migrateCollection(conn, 'mvp', apply),
    emailcampaigns: await migrateCollection(conn, 'campaign', apply),
  };
}

/** One warning per collection whose leadId index is not unique yet. Never throws */
export async function checkLeadChildIndexes(conn: mongoose.Connection): Promise<string[]> {
  const warnings: string[] = [];
  for (const name of Object.values(LEAD_CHILD_COLLECTIONS)) {
    try {
      if (conn.readyState !== 1 || !conn.db) throw new Error('not connected');
      const unique = await leadIdIndexIsUnique(conn, name);
      // A collection that does not exist yet gets the unique index from Mongoose when it is created
      if (unique === false || (unique === undefined && (await conn.db.listCollections({ name }).hasNext()))) {
        warnings.push(`${name}: leadId is not unique yet (REV-201). Run ${MIGRATE_LEAD_CHILDREN_COMMAND} (dry run first, then --apply).`);
      }
    } catch (error) {
      warnings.push(`${name}: could not check the leadId index (${(error as Error).message}). Run ${MIGRATE_LEAD_CHILDREN_COMMAND} to check.`);
    }
  }
  return warnings;
}
