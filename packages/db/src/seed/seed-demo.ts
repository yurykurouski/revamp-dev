import mongoose, { Model } from 'mongoose';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { Business } from '../models/Business.model.js';
import { Audit } from '../models/Audit.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { Lead } from '../models/Lead.model.js';
import { Membership } from '../models/Membership.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { Organization } from '../models/Organization.model.js';
import { User } from '../models/User.model.js';
import { DemoCollection, DemoDataset, demoDocumentIds } from './demo-dataset.js';

// REV-199: writes the demo dataset through the models (insertMany validates every document) in one transaction, and
// only ever reads, deletes or inserts the seed documents' fixed ids: the local database is shared with real work.

type SeedModel = Model<Record<string, unknown>>;

/** Hosts a seed may write to: this machine, or the compose service from inside the compose network */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'mongo']);

/** The hosts of a `mongodb://` URI, lowercased and without ports; `undefined` when it is not one */
function uriHosts(uri: string): string[] | undefined {
  const match = /^mongodb:\/\/([^/?#]*)/i.exec(uri.trim());
  if (!match) return undefined;
  const authority = match[1] ?? '';
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  if (!hostList) return undefined;
  return hostList.split(',').map((entry) => {
    const host = entry.startsWith('[') ? entry.slice(1, entry.indexOf(']')) : entry.split(':')[0];
    return (host ?? '').toLowerCase();
  });
}

/** Throws unless the seed would write to a local, non-production database; the reason never carries the URI */
export function assertLocalSeedTarget(uri: string, nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') throw new Error('Refusing to seed: NODE_ENV is production.');
  if (/^mongodb\+srv:/i.test(uri.trim())) throw new Error('Refusing to seed: mongodb+srv URIs point at a hosted cluster.');
  const hosts = uriHosts(uri);
  if (!hosts || hosts.length === 0) throw new Error('Refusing to seed: MONGODB_URI is not a mongodb:// URI.');
  const remote = hosts.filter((host) => !LOCAL_HOSTS.has(host));
  if (remote.length > 0) {
    throw new Error(`Refusing to seed: ${remote.join(', ')} is not a local host (allowed: ${[...LOCAL_HOSTS].join(', ')}).`);
  }
}

export type DemoSeedReport = Record<DemoCollection, { inserted: number; kept: number }>;

/**
 * Seeds the dataset. A plain run inserts the seed documents that are missing and keeps the rest as they are, so a
 * demo's changes survive; `reset` deletes the seed documents, and every document of a demo lead, campaign or MVP, then
 * inserts the seed again. Any error rolls back everything.
 */
export async function seedDemoDataset(ds: DemoDataset, opts: { reset: boolean }): Promise<DemoSeedReport> {
  const steps: [DemoCollection, SeedModel, { _id: unknown }[]][] = [
    ['leads', Lead as unknown as SeedModel, ds.leads],
    ['audits', Audit as unknown as SeedModel, ds.audits],
    ['mvpProjects', MvpProject as unknown as SeedModel, ds.mvpProjects],
    ['emailCampaigns', EmailCampaign as unknown as SeedModel, ds.emailCampaigns],
    ['analyticsEvents', AnalyticsEvent as unknown as SeedModel, ds.analyticsEvents],
    ['organizations', Organization as unknown as SeedModel, ds.organizations],
    ['businesses', Business as unknown as SeedModel, ds.businesses],
    ['users', User as unknown as SeedModel, ds.users],
    ['memberships', Membership as unknown as SeedModel, ds.memberships],
  ];
  const ids = demoDocumentIds(ds);
  // Unique indexes must exist before the transaction: a collection or index cannot be created inside one reliably
  await Promise.all(steps.map(([, model]) => model.init()));

  const report = {} as DemoSeedReport;
  await mongoose.connection.transaction(async (session) => {
    // A database seeded before the split and then backfilled (REV-208) has businesses of the demo domains under other
    // ids, and `domain` is unique. A plain run keeps them and points the demo leads and audits it inserts at them; a
    // reset replaces them with the seed ones, except a business a lead outside the seed still points at
    const demoDomains = ds.businesses.map((b) => b.domain);
    const remap = new Map<string, unknown>();
    if (!opts.reset) {
      const existing = await Business.find({ domain: { $in: demoDomains } }, { domain: 1 }, { session }).lean();
      const idByDomain = new Map(existing.map((b) => [b.domain, b._id]));
      for (const seed of ds.businesses) {
        const found = idByDomain.get(seed.domain);
        if (found && String(found) !== String(seed._id)) remap.set(String(seed._id), found);
      }
    }
    const relink = (doc: { _id: unknown; businessId?: unknown }) =>
      remap.has(String(doc.businessId)) ? { ...doc, businessId: remap.get(String(doc.businessId)) } : doc;

    for (const [name, model, rawDocs] of steps) {
      const docs = name === 'leads' || name === 'audits' ? rawDocs.map((doc) => relink(doc as { _id: unknown; businessId?: unknown })) : rawDocs;
      let missing = docs;
      if (opts.reset) {
        // A demo lead's children belong to the demo, whatever their id: a retried audit, a generated MVP or campaign,
        // tracking hits; leaving them would make the latest audit or the lead's MVP not the seeded one
        const owned: Record<string, unknown>[] = [{ _id: { $in: ids[name] } }];
        if (['audits', 'mvpProjects', 'emailCampaigns', 'analyticsEvents'].includes(name)) owned.push({ leadId: { $in: ids.leads } });
        if (name === 'analyticsEvents') owned.push({ campaignId: { $in: ids.emailCampaigns } }, { mvpProjectId: { $in: ids.mvpProjects } });
        await model.deleteMany({ $or: owned }, { session });
        if (name === 'businesses') {
          // Businesses of the demo domains made by the backfill, unless a lead outside the seed points at them
          const stale = await Business.find({ domain: { $in: demoDomains }, _id: { $nin: ids.businesses } }, { _id: 1 }, { session }).lean();
          for (const business of stale) {
            if (!(await Lead.exists({ businessId: business._id }).session(session))) await Business.deleteOne({ _id: business._id }, { session });
          }
        }
      } else {
        const existing = await model.find({ _id: { $in: ids[name] } }, { _id: 1 }, { session }).lean();
        const kept = new Set(existing.map((doc) => String((doc as { _id: unknown })._id)));
        // A seed business whose domain a backfilled business already holds is kept as that one
        missing = docs.filter((doc) => !kept.has(String(doc._id)) && !(name === 'businesses' && remap.has(String(doc._id))));
      }
      if (missing.length > 0) await model.insertMany(missing as Record<string, unknown>[], { session });
      report[name] = { inserted: missing.length, kept: rawDocs.length - missing.length };
    }
  });
  return report;
}
