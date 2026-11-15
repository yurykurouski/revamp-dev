import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkLeadChildIndexes, migrateLeadChildren } from '../lead-children-migration.js';
import { retryOnDuplicateKey } from '../retry-duplicate-key.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { startMongoReplSet } from '../testing/mongo-memory.js';

// Every real-MongoDB test lives in this file and shares one server: a mongod per file, started in
// parallel with the Chromium tests, slowed them enough to break their timing (REV-201)

const at = (iso: string) => new Date(iso);

const mvpFields = (n: number) => ({
  auditId: new Types.ObjectId(),
  previewSlug: `slug-${n}-${new Types.ObjectId().toString()}`,
  fullPreviewUrl: `http://localhost/v/slug-${n}/index.html`,
  storageHtmlPath: `v/slug-${n}/index.html`,
});

const campaignFields = (n: number) => ({
  status: 'SCHEDULED',
  senderEmail: 'sender@example.com',
  recipientEmail: 'owner@example.com',
  subject: `Subject ${n}`,
  bodyHtml: '<p>Hi</p>',
  bodyPlainText: 'Hi',
  trackingToken: `token-${n}-${new Types.ObjectId().toString()}`,
});

describe('real MongoDB (mongodb-memory-server)', () => {
  let mongo: Awaited<ReturnType<typeof startMongoReplSet>>;

  beforeAll(async () => {
    mongo = await startMongoReplSet();
  }, 180_000);

  afterAll(async () => {
    await mongo?.stop();
  });

  // REV-201 review I1: after the migration rebuilt leadId_1, previewSlug_1 comes first in the index list,
  // so concurrent first deploys (same slug) get E11000 on the slug, which the server does not retry
  it('concurrent first deploys with one slug all succeed on a migrated layout with retryOnDuplicateKey', async () => {
    const conn = await mongoose.createConnection(mongo.uri, { dbName: 'revamp-slug-test', autoIndex: false }).asPromise();
    try {
      const Mvp = conn.model('MvpProject', MvpProject.schema);
      await Mvp.createCollection();
      await Mvp.collection.createIndex({ previewSlug: 1 }, { unique: true });
      await Mvp.collection.createIndex({ leadId: 1 }, { unique: true });
      for (let round = 0; round < 5; round++) {
        const leadId = new Types.ObjectId();
        const fields = mvpFields(round);
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            retryOnDuplicateKey(() =>
              Mvp.findOneAndUpdate({ leadId }, { $set: fields, $inc: { generationCount: 1 } }, { upsert: true, new: true }).exec(),
            ),
          ),
        );
        expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
        expect(await Mvp.countDocuments({ leadId })).toBe(1);
      }
    } finally {
      await conn.close();
    }
  });

  it('startMongoReplSet gives a MongoDB 7.0 replica set Mongoose can connect to', async () => {
    const conn = await mongoose.createConnection(mongo.uri).asPromise();
    try {
      const hello = await conn.db!.admin().command({ hello: 1 });
      expect(hello['setName']).toBeTruthy();
      const info = await conn.db!.admin().command({ buildInfo: 1 });
      expect(String(info['version'])).toMatch(/^7\.0\./);
      expect(conn.db!.databaseName).toBe('revamp-test');
    } finally {
      await conn.close();
    }
  });

  describe('leadId is unique on MvpProject and EmailCampaign (REV-201)', () => {
    beforeAll(async () => {
      await mongoose.connect(mongo.uri);
      await Promise.all([MvpProject.init(), EmailCampaign.init()]);
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      await Promise.all([MvpProject.deleteMany({}), EmailCampaign.deleteMany({})]);
    });

    it('rejects a second MvpProject for the same lead', async () => {
      const leadId = new Types.ObjectId();
      await MvpProject.create({ leadId, ...mvpFields(1) });
      await expect(MvpProject.create({ leadId, ...mvpFields(2) })).rejects.toMatchObject({
        code: 11000,
      });
    });

    it('rejects a second EmailCampaign for the same lead', async () => {
      const leadId = new Types.ObjectId();
      await EmailCampaign.create({ leadId, ...campaignFields(1) });
      await expect(EmailCampaign.create({ leadId, ...campaignFields(2) })).rejects.toMatchObject({
        code: 11000,
      });
    });

    // Same shape as deploy.worker: filter on leadId, leadId not in the update
    it('leaves one MvpProject after 20 concurrent upserts for one lead', async () => {
      const leadId = new Types.ObjectId();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, n) =>
          MvpProject.findOneAndUpdate(
            { leadId },
            { $set: { ...mvpFields(n), isPublished: true }, $inc: { generationCount: 1 } },
            { upsert: true, new: true, strict: false },
          ).exec(),
        ),
      );
      expect(results.every((doc) => doc?.leadId.equals(leadId))).toBe(true);
      expect(await MvpProject.countDocuments({ leadId })).toBe(1);
      expect((await MvpProject.findOne({ leadId }).lean())?.generationCount).toBe(20);
    });

    // Same shape as outreach approve: an implicit $set without leadId
    it('leaves one EmailCampaign after 20 concurrent upserts for one lead', async () => {
      const leadId = new Types.ObjectId();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, n) =>
          EmailCampaign.findOneAndUpdate({ leadId }, campaignFields(n), {
            upsert: true,
            new: true,
          }).exec(),
        ),
      );
      expect(results.every((doc) => doc?.leadId.equals(leadId))).toBe(true);
      expect(await EmailCampaign.countDocuments({ leadId })).toBe(1);
    });
  });

  describe('migrateLeadChildren and checkLeadChildIndexes on a real MongoDB (REV-201)', () => {
    let conn: mongoose.Connection;
    const leadA = new Types.ObjectId();
    const leadB = new Types.ObjectId();
    const leadC = new Types.ObjectId();

    beforeAll(async () => {
      // A separate connection and database with no models: the collections look like a database made before REV-201
      conn = await mongoose
        .createConnection(mongo.uri, { dbName: 'revamp-migration-test' })
        .asPromise();
    });

    afterAll(async () => {
      await conn?.close();
    });

    beforeEach(async () => {
      await conn.db!.dropDatabase();
      const mvps = conn.collection('mvpprojects');
      const campaigns = conn.collection('emailcampaigns');
      const leads = conn.collection('leads');
      await mvps.createIndex({ leadId: 1 });
      await campaigns.createIndex({ leadId: 1 });
      await leads.insertOne({
        _id: leadA,
        previewUrl: 'http://localhost:9000/revamp-demos/v/a-old/index.html',
      });
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
        {
          leadId: leadA.toString(),
          keep: expect.any(String),
          remove: [expect.any(String)],
          orphanedSlugs: ['a-new'],
          // REV-201 review I3: each record's facts, so the dry run can be checked without a query
          docs: [
            expect.objectContaining({ previewSlug: 'a-old', updatedAt: at('2026-01-01'), kept: true }),
            expect.objectContaining({ previewSlug: 'a-new', updatedAt: at('2026-02-01'), kept: false }),
          ],
          sentRemoved: [],
        },
      ]);
      expect(report.emailcampaigns.groups).toEqual([
        expect.objectContaining({
          docs: [
            expect.objectContaining({ status: 'UNSUBSCRIBED', kept: true }),
            expect.objectContaining({ status: 'SCHEDULED', kept: false }),
          ],
          sentRemoved: [],
        }),
      ]);
      expect(report.mvpprojects.index).toBe('would-rebuild');
      expect(await conn.collection('mvpprojects').countDocuments()).toBe(3);
      expect(await conn.collection('emailcampaigns').countDocuments()).toBe(2);
      expect((await leadIdIndex('mvpprojects'))?.unique).toBeFalsy();
    });

    it('flags a removed campaign whose email went out: its tracking links stop working', async () => {
      const leadD = new Types.ObjectId();
      await conn.collection('emailcampaigns').insertMany([
        { leadId: leadD, status: 'DELIVERED', trackingToken: 'd1', updatedAt: at('2026-01-01') },
        { leadId: leadD, status: 'DELIVERED', trackingToken: 'd2', updatedAt: at('2026-02-01') },
      ]);
      const report = await migrateLeadChildren(conn, { apply: false });
      const group = report.emailcampaigns.groups.find((g) => g.leadId === leadD.toString())!;
      const older = (await conn.collection('emailcampaigns').findOne({ trackingToken: 'd1' }))!._id.toString();
      expect(group.remove).toEqual([older]);
      expect(group.sentRemoved).toEqual([older]);
    });

    it('apply keeps the right records, removes the rest and makes leadId_1 unique', async () => {
      const report = await migrateLeadChildren(conn, { apply: true });

      expect(report.mvpprojects.index).toBe('rebuilt');
      expect(report.emailcampaigns.index).toBe('rebuilt');
      expect(
        (await conn.collection('mvpprojects').find({ leadId: leadA }).toArray()).map(
          (d) => d['previewSlug'],
        ),
      ).toEqual(['a-old']);
      expect(
        (await conn.collection('emailcampaigns').find({ leadId: leadC }).toArray()).map(
          (d) => d['status'],
        ),
      ).toEqual(['UNSUBSCRIBED']);
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
      for (const warning of before)
        expect(warning).toContain('npm run migrate:unique-lead-children --workspace=@revamp/api');

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
});
