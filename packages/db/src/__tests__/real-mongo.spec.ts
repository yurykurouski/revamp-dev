import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLeadWithAudit } from '../create-lead-with-audit.js';
import { checkLeadChildIndexes, migrateLeadChildren } from '../lead-children-migration.js';
import { retryOnDuplicateKey } from '../retry-duplicate-key.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { buildDemoDataset } from '../seed/demo-dataset.js';
import { seedDemoDataset } from '../seed/seed-demo.js';
import { approveOutreachWithCampaign, revertOutreachApproval } from '../approve-outreach.js';
import { createOrganizationWithOwner } from '../create-organization-with-owner.js';
import {
  acceptInvitationAsMember,
  changeMemberRole,
  createInvitation,
  findInvitation,
  hashInvitationToken,
  listOrganizationMembers,
  registerWithInvitation,
  removeMember,
} from '../organization-members.js';
import { Invitation } from '../models/Invitation.model.js';
import { Business } from '../models/Business.model.js';
import { Organization } from '../models/Organization.model.js';
import { User } from '../models/User.model.js';
import { Membership } from '../models/Membership.model.js';
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

  describe('createLeadWithAudit (REV-202)', () => {
    const leadFields = {
      businessName: 'Demo Dental',
      originalUrl: 'https://demo-dental.example.com',
      domain: 'demo-dental.example.com',
      niche: 'other',
      status: 'QUEUED',
    };

    beforeAll(async () => {
      await mongoose.connect(mongo.uri);
      await Promise.all([Lead.init(), Audit.init()]);
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      vi.restoreAllMocks();
      await Promise.all([Lead.deleteMany({}), Audit.deleteMany({})]);
    });

    it('creates the lead and its queued audit together', async () => {
      const { lead, audit } = await createLeadWithAudit(leadFields);
      expect(lead.status).toBe('QUEUED');
      expect(audit.status).toBe('QUEUED');
      expect(String(audit.leadId)).toBe(String(lead._id));
      expect(await Lead.countDocuments()).toBe(1);
      expect(await Audit.countDocuments({ leadId: lead._id })).toBe(1);
    });

    it('leaves no lead when the audit insert fails', async () => {
      vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('boom'));
      await expect(createLeadWithAudit(leadFields)).rejects.toThrow('boom');
      expect(await Lead.countDocuments()).toBe(0);
      expect(await Audit.countDocuments()).toBe(0);
    });

    it('leaves nothing when the lead itself is invalid', async () => {
      await expect(createLeadWithAudit({ ...leadFields, businessName: undefined })).rejects.toThrow(/Business name/);
      expect(await Lead.countDocuments()).toBe(0);
      expect(await Audit.countDocuments()).toBe(0);
    });
  });

  describe('seedDemoDataset (REV-199)', () => {
    const ds = buildDemoDataset(new Date('2026-11-21T12:00:00.000Z'));
    const models = [Lead, Audit, MvpProject, EmailCampaign, AnalyticsEvent, Organization, User, Membership] as const;
    const foreignLead = {
      businessName: 'Real Customer',
      originalUrl: 'https://real.example.org',
      domain: 'real.example.org',
      niche: 'other',
      status: 'AUDITED',
    };

    beforeAll(async () => {
      await mongoose.connect(mongo.uri);
      await Promise.all(models.map((m) => (m as typeof Lead).init()));
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      await Promise.all(models.map((m) => (m as typeof Lead).deleteMany({})));
    });

    it('seeds every collection', async () => {
      const report = await seedDemoDataset(ds, { reset: false });
      expect(await Lead.countDocuments()).toBe(ds.leads.length);
      expect(await Audit.countDocuments()).toBe(ds.audits.length);
      expect(await MvpProject.countDocuments()).toBe(ds.mvpProjects.length);
      expect(await EmailCampaign.countDocuments()).toBe(ds.emailCampaigns.length);
      expect(await AnalyticsEvent.countDocuments()).toBe(ds.analyticsEvents.length);
      expect(report.leads).toEqual({ inserted: ds.leads.length, kept: 0 });
      expect(await Promise.all([Organization.countDocuments(), User.countDocuments(), Membership.countDocuments()])).toEqual([1, 3, 3]);
      expect(report.users).toEqual({ inserted: 3, kept: 0 });
    });

    it('leaves a real user and organization alone, also on reset (REV-206)', async () => {
      const real = await createOrganizationWithOwner({ email: 'real@studio.example', passwordHash: 'scrypt$a$b', organizationName: 'Real Studio' });
      await seedDemoDataset(ds, { reset: false });
      await seedDemoDataset(ds, { reset: true });
      expect(await User.findById(real.user._id).lean()).toMatchObject({ email: 'real@studio.example' });
      expect(await Organization.findById(real.organization._id).lean()).toMatchObject({ name: 'Real Studio' });
      expect(await Membership.countDocuments()).toBe(4);
    });

    it('a second run inserts nothing', async () => {
      await seedDemoDataset(ds, { reset: false });
      const report = await seedDemoDataset(ds, { reset: false });
      for (const entry of Object.values(report)) expect(entry.inserted).toBe(0);
      expect(report.leads.kept).toBe(ds.leads.length);
      expect(await Lead.countDocuments()).toBe(ds.leads.length);
    });

    it('a plain run keeps an operator change and reset restores it', async () => {
      await seedDemoDataset(ds, { reset: false });
      const target = ds.leads.find((l) => l.status === 'NEEDS_APPROVAL')!;
      await Lead.updateOne({ _id: target._id }, { $set: { status: 'SCHEDULED' } });
      await seedDemoDataset(ds, { reset: false });
      expect((await Lead.findById(target._id).lean())?.status).toBe('SCHEDULED');
      const report = await seedDemoDataset(ds, { reset: true });
      expect((await Lead.findById(target._id).lean())?.status).toBe('NEEDS_APPROVAL');
      expect(report.leads).toEqual({ inserted: ds.leads.length, kept: 0 });
    });

    it('reset also removes children a seed lead gained after seeding (review I1)', async () => {
      await seedDemoDataset(ds, { reset: false });
      const failed = ds.leads.find((l) => l.status === 'AUDIT_FAILED')!;
      const audited = ds.leads.find((l) => l.status === 'AUDITED')!;
      const seededCampaign = ds.emailCampaigns[0]!;
      await Audit.create({ leadId: failed._id, status: 'QUEUED' });
      await MvpProject.create({ ...mvpFields(7), leadId: audited._id });
      await EmailCampaign.create({ ...campaignFields(7), leadId: audited._id });
      await AnalyticsEvent.create({ campaignId: seededCampaign._id, eventType: 'open' });
      await seedDemoDataset(ds, { reset: true });
      expect(await Audit.countDocuments()).toBe(ds.audits.length);
      expect(await MvpProject.countDocuments()).toBe(ds.mvpProjects.length);
      expect(await EmailCampaign.countDocuments()).toBe(ds.emailCampaigns.length);
      expect(await AnalyticsEvent.countDocuments()).toBe(ds.analyticsEvents.length);
    });

    it('leaves documents that are not seed documents alone', async () => {
      const foreign = await Lead.create(foreignLead);
      await seedDemoDataset(ds, { reset: false });
      await seedDemoDataset(ds, { reset: true });
      expect(await Lead.findById(foreign._id).lean()).toMatchObject({ businessName: 'Real Customer' });
      expect(await Lead.countDocuments()).toBe(ds.leads.length + 1);
    });

    it('a unique clash rolls the whole seed back', async () => {
      const foreign = await Lead.create(foreignLead);
      await EmailCampaign.create({ ...campaignFields(1), leadId: foreign._id, trackingToken: ds.emailCampaigns[0]!.trackingToken });
      await expect(seedDemoDataset(ds, { reset: false })).rejects.toThrow(/E11000|duplicate/);
      expect(await Lead.countDocuments({ _id: { $in: ds.leads.map((l) => l._id) } })).toBe(0);
      expect(await Audit.countDocuments()).toBe(0);
    });
  });

  describe('approveOutreachWithCampaign and revertOutreachApproval (REV-203)', () => {
    const leadFields = { businessName: 'Approve Co', originalUrl: 'https://approve.test', domain: 'approve.test', niche: 'other', contactEmail: 'owner@approve.test' };
    const approved = (n: number) => ({
      status: 'SCHEDULED',
      senderEmail: 'sender@revamp.test',
      recipientEmail: 'owner@approve.test',
      subject: `Subject ${n}`,
      bodyHtml: '<p>Hi</p>',
      bodyPlainText: 'Hi',
      trackingToken: `approve-token-${n}-${new Types.ObjectId().toString()}`,
      requiresManualReview: false,
      approvedBy: 'operator',
      approvedAt: new Date(),
      scheduledAt: new Date(),
    });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri);
      await Promise.all([Lead.init(), EmailCampaign.init()]);
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      vi.restoreAllMocks();
      await Promise.all([Lead.deleteMany({}), EmailCampaign.deleteMany({})]);
    });

    it('moves the lead to SCHEDULED and writes its campaign together', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      const result = await approveOutreachWithCampaign(String(lead._id), approved(1));
      expect(result?.lead.status).toBe('SCHEDULED');
      expect(String(result?.campaign.leadId)).toBe(String(lead._id));
      expect((await EmailCampaign.findOne({ leadId: lead._id }).lean())?.status).toBe('SCHEDULED');
    });

    it('leaves the lead in review and no campaign when the campaign write fails', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      vi.spyOn(EmailCampaign, 'findOneAndUpdate').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      await expect(approveOutreachWithCampaign(String(lead._id), approved(2))).rejects.toThrow('boom');
      expect((await Lead.findById(lead._id).lean())?.status).toBe('NEEDS_APPROVAL');
      expect(await EmailCampaign.countDocuments()).toBe(0);
    });

    it('writes nothing for a lead that is not awaiting approval', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'AUDITED' });
      expect(await approveOutreachWithCampaign(String(lead._id), approved(3))).toBeNull();
      expect((await Lead.findById(lead._id).lean())?.status).toBe('AUDITED');
      expect(await EmailCampaign.countDocuments()).toBe(0);
    });

    it('reverts an approval: the lead back to review, the campaign back to NEEDS_APPROVAL without its approval stamps', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      await approveOutreachWithCampaign(String(lead._id), approved(4));
      expect(await revertOutreachApproval(String(lead._id))).toBe(true);
      expect((await Lead.findById(lead._id).lean())?.status).toBe('NEEDS_APPROVAL');
      const campaign = await EmailCampaign.findOne({ leadId: lead._id }).lean();
      expect(campaign?.status).toBe('NEEDS_APPROVAL');
      expect(campaign?.approvedAt).toBeUndefined();
      expect(campaign?.approvedBy).toBeUndefined();
      expect(campaign?.scheduledAt).toBeUndefined();
    });

    it.each(['SENDING', 'DELIVERED'])('does not revert a lead whose campaign the worker already took (%s, review I1)', async (status) => {
      const lead = await Lead.create({ ...leadFields, status: 'SCHEDULED' });
      await EmailCampaign.create({ ...approved(6), status, leadId: lead._id });
      expect(await revertOutreachApproval(String(lead._id))).toBe(false);
      expect((await Lead.findById(lead._id).lean())?.status).toBe('SCHEDULED');
      expect((await EmailCampaign.findOne({ leadId: lead._id }).lean())?.status).toBe(status);
    });

    it('lets exactly one of two concurrent approvals through, with one campaign (review I2)', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      const results = await Promise.all([
        approveOutreachWithCampaign(String(lead._id), approved(7)),
        approveOutreachWithCampaign(String(lead._id), approved(8)),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await EmailCampaign.countDocuments({ leadId: lead._id })).toBe(1);
      expect((await Lead.findById(lead._id).lean())?.status).toBe('SCHEDULED');
    });

    it('approves again after a revert, with the new token (review I2)', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      await approveOutreachWithCampaign(String(lead._id), approved(9));
      await revertOutreachApproval(String(lead._id));
      const again = approved(10);
      const result = await approveOutreachWithCampaign(String(lead._id), again);
      expect(result?.lead.status).toBe('SCHEDULED');
      const campaign = await EmailCampaign.findOne({ leadId: lead._id }).lean();
      expect(campaign?.status).toBe('SCHEDULED');
      expect(campaign?.trackingToken).toBe(again.trackingToken);
      expect(await EmailCampaign.countDocuments({ leadId: lead._id })).toBe(1);
    });

    it('leaves a lead the worker already sent alone', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'SENT' });
      await EmailCampaign.create({ ...approved(5), status: 'DELIVERED', leadId: lead._id });
      expect(await revertOutreachApproval(String(lead._id))).toBe(false);
      expect((await Lead.findById(lead._id).lean())?.status).toBe('SENT');
      expect((await EmailCampaign.findOne({ leadId: lead._id }).lean())?.status).toBe('DELIVERED');
    });
  });
  // REV-206: registration writes the organization, the user and the owner membership together
  describe('createOrganizationWithOwner (REV-206)', () => {
    const owner = (n: number, email = `owner${n}@studio.test`) => ({
      email,
      passwordHash: 'scrypt$salt$hash',
      organizationName: `Studio ${n}`,
      name: `Owner ${n}`,
    });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-org-test' });
      await Promise.all([Organization.init(), User.init(), Membership.init()]);
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      await Promise.all([Organization.deleteMany({}), User.deleteMany({}), Membership.deleteMany({})]);
    });

    it('writes the organization, the user and an owner membership that link to each other', async () => {
      const result = await createOrganizationWithOwner(owner(1));
      expect(result.membership.role).toBe('owner');
      expect(String(result.membership.userId)).toBe(String(result.user._id));
      expect(String(result.membership.organizationId)).toBe(String(result.organization._id));
      expect(result.organization.name).toBe('Studio 1');
      expect(await Promise.all([Organization.countDocuments(), User.countDocuments(), Membership.countDocuments()])).toEqual([1, 1, 1]);
    });

    it('leaves no user and no organization when the membership insert fails', async () => {
      vi.spyOn(Membership, 'create').mockRejectedValueOnce(new Error('membership insert failed'));
      await expect(createOrganizationWithOwner(owner(2))).rejects.toThrow('membership insert failed');
      expect(await Promise.all([Organization.countDocuments(), User.countDocuments(), Membership.countDocuments()])).toEqual([0, 0, 0]);
      vi.restoreAllMocks();
    });

    it('rejects a second registration of the same email, in any letter case, with E11000 and writes nothing for it', async () => {
      await createOrganizationWithOwner(owner(3, 'same@studio.test'));
      const second = createOrganizationWithOwner(owner(4, 'SAME@Studio.Test'));
      await expect(second).rejects.toMatchObject({ code: 11000 });
      expect(await Promise.all([Organization.countDocuments(), User.countDocuments(), Membership.countDocuments()])).toEqual([1, 1, 1]);
    });

    it('keeps one user, one organization and one membership when 20 registrations of one email race', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => createOrganizationWithOwner(owner(i, 'race@studio.test'))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await Promise.all([Organization.countDocuments(), User.countDocuments(), Membership.countDocuments()])).toEqual([1, 1, 1]);
    });

    it('allows one user a membership in two organizations but not two in the same one', async () => {
      const first = await createOrganizationWithOwner(owner(5));
      const other = await Organization.create({ name: 'Other' });
      await Membership.create({ userId: first.user._id, organizationId: other._id, role: 'owner' });
      await expect(
        Membership.create({ userId: first.user._id, organizationId: other._id, role: 'owner' }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });
  // REV-207: invitations and members, on a real MongoDB (transactions, unique indexes, write conflicts)
  describe('invitations and members (REV-207)', () => {
    const NOW = new Date('2026-11-22T12:00:00.000Z');
    const owner = (n: number) => ({
      email: `owner${n}@studio.test`,
      passwordHash: 'scrypt$salt$hash',
      organizationName: `Studio ${n}`,
    });
    const newUser = (email: string) => User.create({ email, passwordHash: 'scrypt$salt$hash' });
    const roleOf = async (userId: unknown, organizationId: unknown) =>
      (await Membership.findOne({ userId, organizationId }).lean())?.role;
    const code = (promise: Promise<unknown>) => promise.then(() => undefined, (e: { code?: unknown }) => e.code);

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-invitation-test' });
      await Promise.all([Organization.init(), User.init(), Membership.init(), Invitation.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Organization.deleteMany({}), User.deleteMany({}), Membership.deleteMany({}), Invitation.deleteMany({})]);
    });

    describe('createInvitation', () => {
      it('returns a one-time token and stores only its hash', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(1));
        const { invitation, token } = await createInvitation({ organizationId: organization._id, email: 'Ann@Studio.Test', role: 'operator', invitedBy: user._id, now: NOW });
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const stored = await Invitation.findById(invitation.id).lean();
        expect(stored?.tokenHash).toBe(hashInvitationToken(token));
        expect(JSON.stringify(stored)).not.toContain(token);
        expect(stored).toMatchObject({ email: 'ann@studio.test', role: 'operator' });
        expect(stored!.expiresAt.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
      });

      it('replaces the pending invitation for the same email: the older token stops working', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(2));
        const first = await createInvitation({ organizationId: organization._id, email: 'a@b.co', role: 'viewer', invitedBy: user._id, now: NOW });
        const second = await createInvitation({ organizationId: organization._id, email: 'a@b.co', role: 'operator', invitedBy: user._id, now: NOW });
        expect(await code(findInvitation(first.token, NOW))).toBe('INVITATION_EXPIRED');
        expect((await findInvitation(second.token, NOW)).role).toBe('operator');
        expect(await Invitation.countDocuments({ revokedAt: null })).toBe(1);
      });

      it('refuses an email that already belongs to a member with ALREADY_MEMBER', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(3));
        expect(await code(createInvitation({ organizationId: organization._id, email: 'OWNER3@studio.test', role: 'viewer', invitedBy: user._id, now: NOW }))).toBe('ALREADY_MEMBER');
        expect(await Invitation.countDocuments()).toBe(0);
      });
    });

    describe('findInvitation', () => {
      it('is INVITATION_NOT_FOUND for an unknown token, and INVITATION_EXPIRED for an expired, used or revoked one', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(4));
        expect(await code(findInvitation('nope', NOW))).toBe('INVITATION_NOT_FOUND');
        const { invitation, token } = await createInvitation({ organizationId: organization._id, email: 'a@b.co', role: 'viewer', invitedBy: user._id, now: NOW });
        expect((await findInvitation(token, NOW)).organizationName).toBe('Studio 4');
        expect(await code(findInvitation(token, new Date(NOW.getTime() + 7 * 86_400_000)))).toBe('INVITATION_EXPIRED');
        await Invitation.updateOne({ _id: invitation.id }, { acceptedAt: NOW });
        expect(await code(findInvitation(token, NOW))).toBe('INVITATION_EXPIRED');
        await Invitation.updateOne({ _id: invitation.id }, { acceptedAt: null, revokedAt: NOW });
        expect(await code(findInvitation(token, NOW))).toBe('INVITATION_EXPIRED');
      });
    });

    describe('acceptInvitationAsMember', () => {
      it('adds a membership with the invited role and uses the invitation up', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(5));
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'operator', invitedBy: user._id, now: NOW });
        const ann = await newUser('ann@studio.test');
        const result = await acceptInvitationAsMember({ token, userId: ann._id, userEmail: ann.email, now: NOW });
        expect(result.membership.role).toBe('operator');
        expect(String(result.organization._id)).toBe(String(organization._id));
        expect(await code(acceptInvitationAsMember({ token, userId: ann._id, userEmail: ann.email, now: NOW }))).toBe('INVITATION_EXPIRED');
        expect(await Membership.countDocuments({ organizationId: organization._id })).toBe(2);
      });

      it('refuses another email with INVITATION_EMAIL_MISMATCH and leaves the invitation usable', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(6));
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        const bob = await newUser('bob@studio.test');
        expect(await code(acceptInvitationAsMember({ token, userId: bob._id, userEmail: bob.email, now: NOW }))).toBe('INVITATION_EMAIL_MISMATCH');
        expect((await findInvitation(token, NOW)).email).toBe('ann@studio.test');
        expect(await Membership.countDocuments({ organizationId: organization._id })).toBe(1);
      });

      it('rolls the acceptance back when the user is already a member (ALREADY_MEMBER), keeping the invitation usable', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(7));
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        const ann = await newUser('ann@studio.test');
        await Membership.create({ userId: ann._id, organizationId: organization._id, role: 'owner' });
        expect(await code(acceptInvitationAsMember({ token, userId: ann._id, userEmail: ann.email, now: NOW }))).toBe('ALREADY_MEMBER');
        expect(await Invitation.countDocuments({ acceptedAt: { $ne: null } })).toBe(0);
        expect(await roleOf(ann._id, organization._id)).toBe('owner');
      });

      it('lets exactly one of 20 racing accepts through', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(8));
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        const ann = await newUser('ann@studio.test');
        const results = await Promise.allSettled(Array.from({ length: 20 }, () => acceptInvitationAsMember({ token, userId: ann._id, userEmail: ann.email, now: NOW })));
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(await Membership.countDocuments({ userId: ann._id })).toBe(1);
      });
    });

    describe('a removed member (REV-207 review)', () => {
      it('can be invited again and rejoin with the same account', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(60));
        const ann = await newUser('ann@studio.test');
        await Membership.create({ userId: ann._id, organizationId: organization._id, role: 'operator' });
        await removeMember({ organizationId: organization._id, userId: ann._id });
        expect(await roleOf(ann._id, organization._id)).toBeUndefined();
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        const result = await acceptInvitationAsMember({ token, userId: ann._id, userEmail: ann.email, now: NOW });
        expect(result.membership.role).toBe('viewer');
        expect(await User.countDocuments({ email: 'ann@studio.test' })).toBe(1);
      });
    });

    describe('concurrent invitations for one address', () => {
      it('leave exactly one pending: only the newest link works', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(61));
        const created = await Promise.all(
          Array.from({ length: 10 }, () => createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW })),
        );
        expect(await Invitation.countDocuments({ organizationId: organization._id, acceptedAt: null, revokedAt: null })).toBe(1);
        const usable = await Promise.all(created.map((c) => findInvitation(c.token, NOW).then(() => true, () => false)));
        expect(usable.filter(Boolean)).toHaveLength(1);
      });
    });

    describe('registerWithInvitation', () => {
      it('creates the user and the membership with the invited role in one go, and uses the invitation up', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(9));
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        const result = await registerWithInvitation({ token, email: 'ann@studio.test', passwordHash: 'scrypt$s$h', name: 'Ann', now: NOW });
        expect(result.membership.role).toBe('viewer');
        expect(result.user.name).toBe('Ann');
        expect(await code(registerWithInvitation({ token, email: 'ann@studio.test', passwordHash: 'scrypt$s$h', now: NOW }))).toBe('INVITATION_EXPIRED');
        expect(await User.countDocuments({ email: 'ann@studio.test' })).toBe(1);
      });

      it('refuses another email, and leaves no user and a usable invitation when the email is taken', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(10));
        const { token } = await createInvitation({ organizationId: organization._id, email: 'ann@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        expect(await code(registerWithInvitation({ token, email: 'bob@studio.test', passwordHash: 'x', now: NOW }))).toBe('INVITATION_EMAIL_MISMATCH');
        await newUser('ann@studio.test');
        expect(await code(registerWithInvitation({ token, email: 'ann@studio.test', passwordHash: 'x', now: NOW }))).toBe(11000);
        expect(await Invitation.countDocuments({ acceptedAt: { $ne: null } })).toBe(0);
        expect(await Membership.countDocuments({ organizationId: organization._id })).toBe(1);
      });
    });

    describe('changeMemberRole and removeMember', () => {
      const withTwoOwners = async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(20));
        const second = await newUser('second@studio.test');
        await Membership.create({ userId: second._id, organizationId: organization._id, role: 'owner' });
        return { organization, first: user, second };
      };

      it('changes a role and reports a missing member as MEMBER_NOT_FOUND', async () => {
        const { organization, first, second } = await withTwoOwners();
        await changeMemberRole({ organizationId: organization._id, userId: second._id, role: 'viewer' });
        expect(await roleOf(second._id, organization._id)).toBe('viewer');
        expect(await roleOf(first._id, organization._id)).toBe('owner');
        expect(await code(changeMemberRole({ organizationId: organization._id, userId: new Types.ObjectId(), role: 'viewer' }))).toBe('MEMBER_NOT_FOUND');
      });

      it('refuses to demote or remove the last owner with LAST_OWNER', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(21));
        expect(await code(changeMemberRole({ organizationId: organization._id, userId: user._id, role: 'operator' }))).toBe('LAST_OWNER');
        expect(await code(removeMember({ organizationId: organization._id, userId: user._id }))).toBe('LAST_OWNER');
        expect(await roleOf(user._id, organization._id)).toBe('owner');
      });

      it('lets an owner be demoted or removed while another owner exists, and keeps the user account', async () => {
        const { organization, first, second } = await withTwoOwners();
        await removeMember({ organizationId: organization._id, userId: second._id });
        expect(await roleOf(second._id, organization._id)).toBeUndefined();
        expect(await User.findById(second._id).lean()).not.toBeNull();
        expect(await code(removeMember({ organizationId: organization._id, userId: first._id }))).toBe('LAST_OWNER');
      });

      it('never leaves an organization without an owner when two owners demote each other at once', async () => {
        for (let round = 0; round < 5; round++) {
          const { organization, user: a } = await createOrganizationWithOwner(owner(30 + round));
          const b = await newUser(`b${round}@studio.test`);
          await Membership.create({ userId: b._id, organizationId: organization._id, role: 'owner' });
          await Promise.allSettled([
            changeMemberRole({ organizationId: organization._id, userId: a._id, role: 'viewer' }),
            changeMemberRole({ organizationId: organization._id, userId: b._id, role: 'viewer' }),
          ]);
          expect(await Membership.countDocuments({ organizationId: organization._id, role: 'owner' })).toBe(1);
        }
      });

      it('never leaves an organization without an owner when two owners remove each other at once', async () => {
        const { organization, user: a } = await createOrganizationWithOwner(owner(40));
        const b = await newUser('b40@studio.test');
        await Membership.create({ userId: b._id, organizationId: organization._id, role: 'owner' });
        await Promise.allSettled([
          removeMember({ organizationId: organization._id, userId: a._id }),
          removeMember({ organizationId: organization._id, userId: b._id }),
        ]);
        expect(await Membership.countDocuments({ organizationId: organization._id, role: 'owner' })).toBe(1);
      });

      it('does not touch another organization with the same user', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(41));
        const other = await createOrganizationWithOwner({ ...owner(42), email: 'other42@studio.test' });
        await Membership.create({ userId: user._id, organizationId: other.organization._id, role: 'viewer' });
        await removeMember({ organizationId: other.organization._id, userId: user._id }).catch(() => undefined);
        expect(await roleOf(user._id, organization._id)).toBe('owner');
      });
    });

    describe('listOrganizationMembers', () => {
      it('lists members with their user and only pending invitations', async () => {
        const { organization, user } = await createOrganizationWithOwner(owner(50));
        const pending = await createInvitation({ organizationId: organization._id, email: 'p@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        const used = await createInvitation({ organizationId: organization._id, email: 'u@studio.test', role: 'viewer', invitedBy: user._id, now: NOW });
        await Invitation.updateOne({ _id: used.invitation.id }, { acceptedAt: NOW });
        const expired = await createInvitation({ organizationId: organization._id, email: 'e@studio.test', role: 'viewer', invitedBy: user._id, now: new Date(NOW.getTime() - 8 * 86_400_000) });
        const list = await listOrganizationMembers(organization._id, NOW);
        expect(list.members).toEqual([expect.objectContaining({ email: 'owner50@studio.test', role: 'owner' })]);
        expect(list.invitations.map((i) => i.email)).toEqual(['p@studio.test']);
        expect(JSON.stringify(list)).not.toContain('passwordHash');
        expect(JSON.stringify(list)).not.toContain(pending.token);
        expect(expired.invitation).toBeDefined();
      });
    });
  });
  // REV-208: the shared business and the tenant-owned lead
  describe('business and lead indexes (REV-208)', () => {
    const lead = (n: number, extra: Record<string, unknown> = {}) => ({
      businessName: `Clinic ${n}`,
      originalUrl: `https://clinic${n}.example`,
      domain: `clinic${n}.example`,
      niche: 'dental',
      status: 'QUEUED',
      ...extra,
    });
    const code = (promise: Promise<unknown>) => promise.then(() => undefined, (e: { code?: unknown }) => e.code);

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-business-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({})]);
    });

    it('keeps one business per domain', async () => {
      await Business.create({ domain: 'clinic1.example', originalUrl: 'https://clinic1.example', businessName: 'Clinic', niche: 'dental' });
      expect(await code(Business.create({ domain: 'clinic1.example', originalUrl: 'https://www.clinic1.example', businessName: 'Again', niche: 'dental' }))).toBe(11000);
      expect(await Business.countDocuments()).toBe(1);
    });

    it('lowercases the domain and requires it', async () => {
      const business = await Business.create({ domain: 'Clinic2.Example', originalUrl: 'https://clinic2.example', businessName: 'C', niche: 'dental' });
      expect(business.domain).toBe('clinic2.example');
      await expect(Business.create({ originalUrl: 'https://x.example', businessName: 'C', niche: 'dental' })).rejects.toThrow(/domain/i);
    });

    it('lets one studio have one lead per business, and two studios share a business', async () => {
      const business = await Business.create({ domain: 'clinic3.example', originalUrl: 'https://clinic3.example', businessName: 'C', niche: 'dental' });
      const studioA = new Types.ObjectId();
      const studioB = new Types.ObjectId();
      await Lead.create(lead(3, { tenantId: studioA, businessId: business._id }));
      expect(await code(Lead.create(lead(3, { tenantId: studioA, businessId: business._id })))).toBe(11000);
      await Lead.create(lead(3, { tenantId: studioB, businessId: business._id }));
      const other = await Business.create({ domain: 'clinic4.example', originalUrl: 'https://clinic4.example', businessName: 'D', niche: 'dental' });
      await Lead.create(lead(4, { tenantId: studioA, businessId: other._id }));
      expect(await Lead.countDocuments()).toBe(3);
    });

    it('does not restrict leads made before the split: any number without a tenant or a business', async () => {
      const studio = new Types.ObjectId();
      const business = await Business.create({ domain: 'clinic5.example', originalUrl: 'https://clinic5.example', businessName: 'C', niche: 'dental' });
      await Lead.create([lead(5), lead(5), lead(5, { businessId: business._id }), lead(5, { businessId: business._id }), lead(5, { tenantId: studio }), lead(5, { tenantId: studio })]);
      expect(await Lead.countDocuments()).toBe(6);
    });

    it('stores the business of an audit', async () => {
      const business = await Business.create({ domain: 'clinic6.example', originalUrl: 'https://clinic6.example', businessName: 'C', niche: 'dental' });
      const audit = await Audit.create({ leadId: new Types.ObjectId(), businessId: business._id, status: 'COMPLETED' });
      expect(String((await Audit.findById(audit._id).lean())?.businessId)).toBe(String(business._id));
    });
  });
});
