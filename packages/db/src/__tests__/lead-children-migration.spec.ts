import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import {
  LEAD_CHILD_COLLECTIONS,
  checkLeadChildIndexes,
  migrateLeadChildren,
  planLeadChildDedupe,
  type DedupeDoc,
} from '../lead-children-migration.js';
import { startMongoReplSet } from '../testing/mongo-memory.js';

const at = (iso: string) => new Date(iso);

describe('LEAD_CHILD_COLLECTIONS (REV-201)', () => {
  it('names the collections the models write to', () => {
    expect(LEAD_CHILD_COLLECTIONS).toEqual({ mvp: MvpProject.collection.collectionName, campaign: EmailCampaign.collection.collectionName });
  });
});

describe('planLeadChildDedupe (REV-201)', () => {
  const mvp = (id: string, slug: string, updatedAt: string): DedupeDoc => ({ _id: id, previewSlug: slug, updatedAt: at(updatedAt) });
  const camp = (id: string, status: string, updatedAt: string): DedupeDoc => ({ _id: id, status, updatedAt: at(updatedAt) });

  it("keeps the MVP whose slug the lead's previewUrl points at, even when it is older", () => {
    const plan = planLeadChildDedupe(
      'mvp',
      [mvp('a', 'old-slug', '2026-01-01'), mvp('b', 'new-slug', '2026-02-01')],
      'http://localhost:9000/revamp-demos/v/old-slug/index.html',
    );
    expect(plan).toEqual({ keep: 'a', remove: ['b'] });
  });

  it('keeps the newest MVP when previewUrl matches none', () => {
    const plan = planLeadChildDedupe('mvp', [mvp('a', 's1', '2026-01-01'), mvp('b', 's2', '2026-03-01'), mvp('c', 's3', '2026-02-01')]);
    expect(plan.keep).toBe('b');
    expect([...plan.remove].sort()).toEqual(['a', 'c']);
  });

  it('does not match a slug that is only a prefix of the one in previewUrl', () => {
    const plan = planLeadChildDedupe(
      'mvp',
      [mvp('a', 'shop', '2026-03-01'), mvp('b', 'shop-2', '2026-01-01')],
      'http://localhost:9000/revamp-demos/v/shop-2/index.html',
    );
    expect(plan.keep).toBe('b');
  });

  it('keeps an UNSUBSCRIBED campaign over a newer SCHEDULED one, so later opt-outs still find it', () => {
    const plan = planLeadChildDedupe('campaign', [camp('a', 'UNSUBSCRIBED', '2026-01-01'), camp('b', 'SCHEDULED', '2026-02-01')]);
    expect(plan).toEqual({ keep: 'a', remove: ['b'] });
  });

  it('keeps a DELIVERED campaign over a DRAFT, and the newest when statuses tie', () => {
    expect(planLeadChildDedupe('campaign', [camp('a', 'DRAFT', '2026-03-01'), camp('b', 'DELIVERED', '2026-01-01')]).keep).toBe('b');
    expect(planLeadChildDedupe('campaign', [camp('a', 'SCHEDULED', '2026-01-01'), camp('b', 'SCHEDULED', '2026-02-01')]).keep).toBe('b');
  });
});

describe('migrateLeadChildren and checkLeadChildIndexes on a real MongoDB (REV-201)', () => {
  let mongo: Awaited<ReturnType<typeof startMongoReplSet>>;
  let conn: mongoose.Connection;
  const leadA = new Types.ObjectId();
  const leadB = new Types.ObjectId();
  const leadC = new Types.ObjectId();

  beforeAll(async () => {
    mongo = await startMongoReplSet();
    // A separate connection with no models: the collections look like a database made before REV-201
    conn = await mongoose.createConnection(mongo.uri).asPromise();
  }, 180_000);

  afterAll(async () => {
    await conn?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await conn.db!.dropDatabase();
    const mvps = conn.collection('mvpprojects');
    const campaigns = conn.collection('emailcampaigns');
    const leads = conn.collection('leads');
    await mvps.createIndex({ leadId: 1 });
    await campaigns.createIndex({ leadId: 1 });
    await leads.insertOne({ _id: leadA, previewUrl: 'http://localhost:9000/revamp-demos/v/a-old/index.html' });
    await mvps.insertMany([
      { leadId: leadA, previewSlug: 'a-old', updatedAt: at('2026-01-01') },
      { leadId: leadA, previewSlug: 'a-new', updatedAt: at('2026-02-01') },
      { leadId: leadB, previewSlug: 'b-only', updatedAt: at('2026-01-01') },
    ]);
    await campaigns.insertMany([
      { leadId: leadC, status: 'UNSUBSCRIBED', trackingToken: 't1', updatedAt: at('2026-01-01') },
      { leadId: leadC, status: 'SCHEDULED', trackingToken: 't2', updatedAt: at('2026-02-01') },
    ]);
  });

  const leadIdIndex = async (name: string) =>
    (await conn.collection(name).indexes()).find((index) => index.name === 'leadId_1');

  it('dry run reports the duplicates and the orphaned MVP files, and changes nothing', async () => {
    const report = await migrateLeadChildren(conn, { apply: false });

    expect(report.mvpprojects.groups).toEqual([
      { leadId: leadA.toString(), keep: expect.any(String), remove: [expect.any(String)], orphanedSlugs: ['a-new'] },
    ]);
    expect(report.emailcampaigns.groups).toHaveLength(1);
    expect(report.mvpprojects.index).toBe('would-rebuild');
    expect(await conn.collection('mvpprojects').countDocuments()).toBe(3);
    expect(await conn.collection('emailcampaigns').countDocuments()).toBe(2);
    expect((await leadIdIndex('mvpprojects'))?.unique).toBeFalsy();
  });

  it('apply keeps the right records, removes the rest and makes leadId_1 unique', async () => {
    const report = await migrateLeadChildren(conn, { apply: true });

    expect(report.mvpprojects.index).toBe('rebuilt');
    expect(report.emailcampaigns.index).toBe('rebuilt');
    expect((await conn.collection('mvpprojects').find({ leadId: leadA }).toArray()).map((d) => d['previewSlug'])).toEqual(['a-old']);
    expect((await conn.collection('emailcampaigns').find({ leadId: leadC }).toArray()).map((d) => d['status'])).toEqual(['UNSUBSCRIBED']);
    expect(await conn.collection('mvpprojects').countDocuments({ leadId: leadB })).toBe(1);
    expect((await leadIdIndex('mvpprojects'))?.unique).toBe(true);
    expect((await leadIdIndex('emailcampaigns'))?.unique).toBe(true);
  });

  it('a second apply finds nothing to do', async () => {
    await migrateLeadChildren(conn, { apply: true });
    const again = await migrateLeadChildren(conn, { apply: true });
    expect(again.mvpprojects).toEqual({ groups: [], index: 'unique' });
    expect(again.emailcampaigns).toEqual({ groups: [], index: 'unique' });
  });

  it('builds the unique index on a collection that has none yet', async () => {
    await conn.collection('mvpprojects').dropIndex('leadId_1');
    const report = await migrateLeadChildren(conn, { apply: true });
    expect(report.mvpprojects.index).toBe('rebuilt');
    expect((await leadIdIndex('mvpprojects'))?.unique).toBe(true);
  });

  it('startup check warns for each collection until the migration ran, then is quiet', async () => {
    const before = await checkLeadChildIndexes(conn);
    expect(before).toHaveLength(2);
    for (const warning of before) expect(warning).toContain('npm run migrate:unique-lead-children --workspace=@revamp/api');

    await migrateLeadChildren(conn, { apply: true });
    expect(await checkLeadChildIndexes(conn)).toEqual([]);
  });

  it('startup check turns a failure to read the indexes into a warning, never a throw', async () => {
    const closed = await mongoose.createConnection(mongo.uri).asPromise();
    await closed.close();
    const warnings = await checkLeadChildIndexes(closed);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
