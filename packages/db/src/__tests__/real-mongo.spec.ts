import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { LeadAlreadyExistsError, addLeadToBusiness } from '../add-lead-to-business.js';
import { auditBelongsToLead, findAuditForLead } from '../audit-for-lead.js';
import { MIGRATE_BUSINESSES_COMMAND, checkBusinessLinks, migrateBusinesses } from '../business-migration.js';
import { Organization } from '../models/Organization.model.js';
import { User } from '../models/User.model.js';
import { Membership } from '../models/Membership.model.js';
import { MIGRATE_TENANTS_COMMAND, TenantMigrationError, checkTenantLinks, migrateTenants } from '../tenant-migration.js';
import { ContactRight } from '../models/ContactRight.model.js';
import { SuppressedAddress } from '../models/SuppressedAddress.model.js';
import { hashAddress } from '../address-hash.js';
import { ContactRightRefusedError, endContactRight, findActiveContactRight, grantContactRight } from '../contact-rights.js';
import { contactAvailabilityByDomain } from '../contact-availability.js';
import { MIGRATE_CONTACT_RIGHTS_COMMAND, checkContactRights, migrateContactRights } from '../contact-rights-migration.js';
import { isAddressSuppressed, isBusinessOptedOut, recordBusinessOptOut } from '../opt-out.js';
import { Lot } from '../models/Lot.model.js';
import { LotError, PLATFORM_AUDIT_STALE_MS, createLot, createPlatformAudit, transitionLot } from '../lots.js';
import { startMongoReplSet } from '../testing/mongo-memory.js';
import { skippedDemoLeadFilter, stalledAuditedLeadFilter } from '../stalled-lead-recovery.js';

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

  // REV-202: adding a lead is atomic (now `addLeadToBusiness`, REV-208)
  describe('addLeadToBusiness is atomic (REV-202)', () => {
    const leadFields = {
      businessName: 'Demo Dental',
      originalUrl: 'https://demo-dental.example.com',
      domain: 'demo-dental.example.com',
      niche: 'other',
      status: 'QUEUED',
    };
    const add = (lead: Record<string, unknown>) => addLeadToBusiness({ lead, deriveFromAudit: () => ({ set: {}, clearsEmailGuess: false }) });
    const counts = () => Promise.all([Business.countDocuments(), Lead.countDocuments(), Audit.countDocuments()]);

    beforeAll(async () => {
      await mongoose.connect(mongo.uri);
      await Promise.all([Business.init(), Lead.init(), Audit.init()]);
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      vi.restoreAllMocks();
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({})]);
    });

    it('creates the lead and its queued audit together', async () => {
      const { lead, audit } = await add(leadFields);
      expect(lead.status).toBe('QUEUED');
      expect(audit!.status).toBe('QUEUED');
      expect(String(audit!.leadId)).toBe(String(lead._id));
      expect(await counts()).toEqual([1, 1, 1]);
    });

    it('leaves no lead and no business when the audit insert fails', async () => {
      vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('boom'));
      await expect(add(leadFields)).rejects.toThrow('boom');
      expect(await counts()).toEqual([0, 0, 0]);
    });

    it('leaves nothing when the lead itself is invalid', async () => {
      await expect(add({ ...leadFields, businessName: undefined })).rejects.toThrow(/Business name/);
      expect(await counts()).toEqual([0, 0, 0]);
    });
  });

  describe('seedDemoDataset (REV-199)', () => {
    const ds = buildDemoDataset(new Date('2026-11-21T12:00:00.000Z'));
    const models = [Lead, Audit, MvpProject, EmailCampaign, AnalyticsEvent, Organization, User, Membership, Business, ContactRight, SuppressedAddress] as const;
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
      // REV-208: every demo lead has its business, and the unique {tenant, business} index accepted all of them
      expect(await Business.countDocuments()).toBe(ds.leads.length);
      expect(await Lead.countDocuments({ tenantId: { $exists: true }, businessId: { $exists: true } })).toBe(ds.leads.length);
    });

    it('seeds the contact registry: a right and hold per business, the florist opted out (REV-224)', async () => {
      await seedDemoDataset(ds, { reset: false });
      expect(await ContactRight.countDocuments()).toBe(ds.contactRights.length);
      expect(await SuppressedAddress.countDocuments()).toBe(1);
      expect(await Business.countDocuments({ contactHold: { $exists: true } })).toBe(ds.contactRights.length);
      expect(await Business.countDocuments({ optedOutAt: { $exists: true } })).toBe(1);
      const again = await seedDemoDataset(ds, { reset: false });
      expect(again.contactRights).toEqual({ inserted: 0, kept: ds.contactRights.length });
      expect(again.suppressedAddresses).toEqual({ inserted: 0, kept: 1 });
      expect(await ContactRight.countDocuments()).toBe(ds.contactRights.length);
      await seedDemoDataset(ds, { reset: true });
      expect(await ContactRight.countDocuments()).toBe(ds.contactRights.length);
      expect(await SuppressedAddress.countDocuments()).toBe(1);
    });

    it('reset replaces a right and a suppressed hash the migration made for a demo lead (REV-224)', async () => {
      await seedDemoDataset(ds, { reset: false });
      const right = ds.contactRights[0]!;
      await ContactRight.deleteOne({ _id: right._id });
      await ContactRight.create({ tenantId: right.tenantId, businessId: right.businessId, leadId: right.leadId, source: 'MIGRATION', grantedAt: right.grantedAt, expiresAt: right.expiresAt, cooldownUntil: right.cooldownUntil });
      const hash = ds.suppressedAddresses[0]!.hash;
      await SuppressedAddress.deleteOne({ hash });
      await SuppressedAddress.create({ hash });
      await seedDemoDataset(ds, { reset: true });
      expect(await ContactRight.countDocuments()).toBe(ds.contactRights.length);
      expect(await ContactRight.countDocuments({ _id: right._id })).toBe(1);
      expect(await SuppressedAddress.countDocuments({ hash, _id: ds.suppressedAddresses[0]!._id })).toBe(1);
    });

    it('a plain run adds no second right to a business the migration already claimed (REV-224)', async () => {
      await seedDemoDataset(ds, { reset: false });
      await Promise.all([ContactRight.deleteMany({}), SuppressedAddress.deleteMany({}), Business.updateMany({}, { $unset: { contactHold: 1, optedOutAt: 1 } })]);
      await migrateContactRights({ apply: true, durations: { rightDays: 14, cooldownDays: 30 }, now: new Date('2026-11-21T12:00:00.000Z') });
      const claimed = await ContactRight.find().lean();
      expect(claimed.length).toBeGreaterThan(0);
      const report = await seedDemoDataset(ds, { reset: false });
      expect(report.suppressedAddresses.inserted).toBe(0);
      // A business the migration left free (its only lead is closed) may get the seed's right; none gets two
      const perBusiness = await ContactRight.aggregate([{ $group: { _id: '$businessId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
      expect(perBusiness).toEqual([]);
      for (const right of claimed) expect(await ContactRight.countDocuments({ _id: right._id })).toBe(1);
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

  describe('stalledAuditedLeadFilter (REV-204)', () => {
    const ds = buildDemoDataset(new Date('2026-11-22T12:00:00.000Z'));
    const audited = (name: string, tags: string[]) => ({
      businessName: name,
      originalUrl: `https://${name.toLowerCase().replace(/\s+/g, '-')}.example.org`,
      domain: `${name.toLowerCase().replace(/\s+/g, '-')}.example.org`,
      niche: 'other',
      status: 'AUDITED',
      tags,
    });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri);
      await Promise.all([Lead, Audit, MvpProject, EmailCampaign, AnalyticsEvent].map((m) => (m as typeof Lead).init()));
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      await Promise.all([Lead, Audit, MvpProject, EmailCampaign, AnalyticsEvent].map((m) => (m as typeof Lead).deleteMany({})));
    });

    it('matches ordinary AUDITED leads and never a seeded demo lead', async () => {
      await seedDemoDataset(ds, { reset: false });
      // the seed really holds AUDITED leads, so the exclusion is what keeps them out
      expect(await Lead.countDocuments({ status: 'AUDITED', _id: { $in: ds.leads.map((l) => l._id) } })).toBeGreaterThan(0);
      const plain = await Lead.create(audited('Plain Customer', []));
      const tagged = await Lead.create(audited('Tagged Customer', ['vip']));
      await Lead.create(audited('Mixed Demo', ['vip', 'demo-seed']));
      await Lead.create({ ...audited('Queued Customer', []), status: 'QUEUED' });
      // a lead written without the field at all (before it had a default, or raw) is still recovered
      const { insertedId: untagged } = await Lead.collection.insertOne({ ...audited('Untagged Customer', []), tags: undefined });
      await Lead.collection.updateOne({ _id: untagged }, { $unset: { tags: '' } });

      const found = await Lead.find(stalledAuditedLeadFilter()).lean();
      expect(found.map((l) => String(l._id)).sort()).toEqual([String(plain._id), String(tagged._id), String(untagged)].sort());
      const seededAudited = ds.leads.filter((l) => l.status === 'AUDITED').length;
      expect(await Lead.countDocuments(skippedDemoLeadFilter())).toBe(seededAudited + 1);
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

    it("writes the campaign with the lead's studio, also onto a campaign that already exists without one (REV-209)", async () => {
      const studio = new Types.ObjectId();
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL', tenantId: studio });
      await EmailCampaign.collection.insertOne({ leadId: lead._id, status: 'NEEDS_APPROVAL', trackingToken: 'old-draft' });
      const result = await approveOutreachWithCampaign(String(lead._id), approved(9));
      expect(String(result?.campaign.tenantId)).toBe(String(studio));
      expect(String((await EmailCampaign.findOne({ leadId: lead._id }).lean())?.tenantId)).toBe(String(studio));
    });

    it('leaves the studio off the campaign of a lead that has none (before the migration)', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      const result = await approveOutreachWithCampaign(String(lead._id), approved(10));
      expect(result?.campaign.tenantId).toBeUndefined();
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

    it('revertOutreachApproval stores outreachError on the lead, and approving again clears it (REV-226)', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      await approveOutreachWithCampaign(String(lead._id), approved(11));
      const outreachError = { code: 'CONTACT_RIGHT_EXPIRED' as const, message: 'Ended before sending', at: new Date() };
      expect(await revertOutreachApproval(String(lead._id), { outreachError })).toBe(true);
      const reverted = await Lead.findById(lead._id).lean();
      expect(reverted?.status).toBe('NEEDS_APPROVAL');
      expect(reverted?.outreachError?.code).toBe('CONTACT_RIGHT_EXPIRED');
      expect(reverted?.outreachError?.message).toBe('Ended before sending');
      await approveOutreachWithCampaign(String(lead._id), approved(12));
      expect((await Lead.findById(lead._id).lean())?.outreachError).toBeUndefined();
    });

    it('an invalid outreachError throws before anything is written (REV-226)', async () => {
      const lead = await Lead.create({ ...leadFields, status: 'NEEDS_APPROVAL' });
      await approveOutreachWithCampaign(String(lead._id), approved(13));
      await expect(
        revertOutreachApproval(String(lead._id), { outreachError: { code: 'NOPE', message: 'x', at: new Date() } as never }),
      ).rejects.toThrow();
      expect((await Lead.findById(lead._id).lean())?.status).toBe('SCHEDULED');
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
  describe('addLeadToBusiness (REV-208)', () => {
    const studioA = new Types.ObjectId();
    const studioB = new Types.ObjectId();
    const leadOf = (domain: string, extra: Record<string, unknown> = {}) => ({
      businessName: 'Harbor Dental',
      originalUrl: `https://${domain}`,
      domain,
      niche: 'dental',
      city: 'Gdansk',
      status: 'QUEUED',
      ...extra,
    });
    /** What the API passes in: the lead fields an audit decides */
    const derive = (audit: { scores?: { total?: number }; siteComplexity?: unknown }) => ({
      set: { totalScore: audit.scores?.total, onePageBrochure: false },
      clearsEmailGuess: false,
    });
    const add = (domain: string, tenantId: Types.ObjectId | undefined, extra: Record<string, unknown> = {}) =>
      addLeadToBusiness({ tenantId, lead: leadOf(domain, extra), deriveFromAudit: derive as never });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-addlead-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({})]);
    });

    it('the first add creates the business, the lead and its audit together, and the lead waits for the audit', async () => {
      const result = await add('harbor.example', studioA);
      expect(result.reused).toBe(false);
      expect(result.lead.status).toBe('QUEUED');
      expect(String(result.lead.tenantId)).toBe(String(studioA));
      expect(String(result.lead.businessId)).toBe(String(result.business._id));
      expect(result.audit).toMatchObject({ status: 'QUEUED' });
      expect(String(result.audit!.leadId)).toBe(String(result.lead._id));
      expect(String(result.audit!.businessId)).toBe(String(result.business._id));
      expect(await Promise.all([Business.countDocuments(), Lead.countDocuments(), Audit.countDocuments()])).toEqual([1, 1, 1]);
    });

    it('leaves nothing behind when the audit insert fails', async () => {
      vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('audit insert failed'));
      await expect(add('harbor.example', studioA)).rejects.toThrow('audit insert failed');
      expect(await Promise.all([Business.countDocuments(), Lead.countDocuments(), Audit.countDocuments()])).toEqual([0, 0, 0]);
      vi.restoreAllMocks();
    });

    it('a second studio adding a site with a completed audit gets an AUDITED lead from it, and no new audit', async () => {
      const first = await add('harbor.example', studioA);
      await Audit.updateOne({ _id: first.audit!._id }, { status: 'COMPLETED', 'scores.total': 71 });
      const second = await add('harbor.example', studioB);
      expect(second.reused).toBe(true);
      expect(second.audit).toBeUndefined();
      expect(second.lead.status).toBe('AUDITED');
      expect(second.lead.totalScore).toBe(71);
      expect(String(second.business._id)).toBe(String(first.business._id));
      expect(String(second.lead.tenantId)).toBe(String(studioB));
      expect(await Promise.all([Business.countDocuments(), Lead.countDocuments(), Audit.countDocuments()])).toEqual([1, 2, 1]);
    });

    it.each(['QUEUED', 'PROCESSING', 'FAILED'])('a business whose audit is %s gives the second studio a normal QUEUED lead with its own audit', async (status) => {
      const first = await add('harbor.example', studioA);
      await Audit.updateOne({ _id: first.audit!._id }, { status });
      const second = await add('harbor.example', studioB);
      expect(second.reused).toBe(false);
      expect(second.lead.status).toBe('QUEUED');
      expect(String(second.audit!.leadId)).toBe(String(second.lead._id));
      expect(await Audit.countDocuments()).toBe(2);
    });

    it('takes the newest completed audit of the business', async () => {
      const first = await add('harbor.example', studioA);
      // `createdAt` is immutable through Mongoose, so the dates are written straight to the collection
      await Audit.collection.updateOne({ _id: first.audit!._id }, { $set: { status: 'COMPLETED', 'scores.total': 40, createdAt: new Date('2026-01-01') } });
      const newer = await Audit.create({ leadId: first.lead._id, businessId: first.business._id, status: 'COMPLETED', scores: { total: 88 } });
      await Audit.collection.updateOne({ _id: newer._id }, { $set: { createdAt: new Date('2026-06-01') } });
      expect((await add('harbor.example', studioB)).lead.totalScore).toBe(88);
    });

    it('refuses a second lead of one studio on one site with LEAD_ALREADY_EXISTS and the id of the first', async () => {
      const first = await add('harbor.example', studioA);
      const error = await add('harbor.example', studioA).catch((e) => e);
      expect(error).toBeInstanceOf(LeadAlreadyExistsError);
      expect(error).toMatchObject({ code: 'LEAD_ALREADY_EXISTS', leadId: String(first.lead._id) });
      expect(await Promise.all([Lead.countDocuments(), Audit.countDocuments()])).toEqual([1, 1]);
    });

    it('looks the business up by the domain in any letter case (the caller normalizes www and ports with `normalizeDomain`)', async () => {
      const first = await add('harbor.example', studioA);
      const again = await add('HARBOR.example', studioB);
      expect(String(again.business._id)).toBe(String(first.business._id));
    });

    it('lets a lead without a tenant (a script, a legacy path) be added; the same site twice is not restricted', async () => {
      await add('harbor.example', undefined);
      await add('harbor.example', undefined);
      expect(await Promise.all([Business.countDocuments(), Lead.countDocuments()])).toEqual([1, 2]);
    });

    it('keeps one business and one lead per studio when two studios race 20 adds of a new site', async () => {
      const studios = Array.from({ length: 4 }, () => new Types.ObjectId());
      const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => add('race.example', studios[i % 4])));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
      for (const r of results.filter((r) => r.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LeadAlreadyExistsError);
      }
      expect(await Promise.all([Business.countDocuments(), Lead.countDocuments()])).toEqual([1, 4]);
    });

    it('applies the audit-derived fields and drops the guessed-email tag when told to', async () => {
      const first = await add('harbor.example', studioA);
      await Audit.updateOne({ _id: first.audit!._id }, { status: 'COMPLETED', 'scores.total': 55 });
      const result = await addLeadToBusiness({
        tenantId: studioB,
        lead: leadOf('harbor.example', { contactEmail: 'info@harbor.example', tags: ['email-guessed', 'manual'] }),
        deriveFromAudit: () => ({ set: { contactEmail: 'hello@harbor.example' }, clearsEmailGuess: true }),
      });
      expect(result.lead.contactEmail).toBe('hello@harbor.example');
      expect(result.lead.tags).toEqual(['manual']);
    });
  });
  describe('addLeadToBusiness claims the contact right (REV-225)', () => {
    const durations = { rightDays: 14, cooldownDays: 30 };
    const day = 24 * 60 * 60 * 1000;
    const t0 = new Date('2026-11-01T00:00:00Z');
    const studioA = new Types.ObjectId();
    const studioB = new Types.ObjectId();
    const derive = (audit: { scores?: { total?: number } }) => ({ set: { totalScore: audit.scores?.total }, clearsEmailGuess: false });
    const add = (domain: string, tenantId: Types.ObjectId | undefined, opts: { claim?: boolean; now?: Date; email?: string } = {}) =>
      addLeadToBusiness({
        tenantId,
        lead: {
          businessName: 'Claim Dental',
          originalUrl: `https://${domain}`,
          domain,
          niche: 'dental',
          status: 'QUEUED',
          ...(opts.email ? { contactEmail: opts.email } : {}),
        },
        deriveFromAudit: derive as never,
        ...(opts.claim === false ? {} : { contactRight: { durations, source: 'ADD_LEAD' as const, now: opts.now ?? t0 } }),
      });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-addlead-right-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init(), ContactRight.init(), SuppressedAddress.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({}), ContactRight.deleteMany({}), SuppressedAddress.deleteMany({})]);
    });

    it('a free business gives the studio a right for rightDays, copied into the hold', async () => {
      const result = await add('free.example', studioA);
      expect(result.contactRight?.expiresAt).toEqual(new Date(t0.getTime() + 14 * day));
      expect(String(result.contactRight?.leadId)).toBe(String(result.lead._id));
      const business = await Business.findOne({ domain: 'free.example' }).lean();
      expect(String(business?.contactHold?.rightId)).toBe(String(result.contactRight?._id));
      expect(await ContactRight.countDocuments()).toBe(1);
    });

    it('the reused-audit path claims the right too', async () => {
      const first = await add('reuse.example', studioA, { claim: false });
      await Audit.updateOne({ _id: first.audit!._id }, { status: 'COMPLETED', 'scores.total': 70 });
      const result = await add('reuse.example', studioB);
      expect(result.reused).toBe(true);
      expect(result.contactRight?.expiresAt).toEqual(new Date(t0.getTime() + 14 * day));
      expect(String(result.contactRight?.tenantId)).toBe(String(studioB));
    });

    it('a business held by studio A refuses studio B with held and the expiry; no lead, no audit', async () => {
      const first = await add('held.example', studioA);
      const error = await add('held.example', studioB).catch((e) => e);
      expect(error).toBeInstanceOf(ContactRightRefusedError);
      expect(error.reason).toBe('held');
      expect(error.until).toEqual(first.contactRight!.expiresAt);
      expect(await Lead.countDocuments({ tenantId: studioB })).toBe(0);
      expect(await Audit.countDocuments()).toBe(1);
    });

    it('a business in cooldown refuses with the date it is available', async () => {
      const first = await add('cool.example', studioA);
      const later = new Date(first.contactRight!.expiresAt.getTime() + day);
      const error = await add('cool.example', studioB, { now: later }).catch((e) => e);
      expect(error).toBeInstanceOf(ContactRightRefusedError);
      expect(error.reason).toBe('cooldown');
      expect(error.until).toEqual(first.contactRight!.cooldownUntil);
    });

    it('an opted-out business refuses with opted_out', async () => {
      await Business.create({ domain: 'out.example', originalUrl: 'https://out.example', businessName: 'Out', optedOutAt: t0 });
      const error = await add('out.example', studioA).catch((e) => e);
      expect(error).toBeInstanceOf(ContactRightRefusedError);
      expect(error.reason).toBe('opted_out');
      expect(error.until).toBeUndefined();
    });

    it('a refused add leaves no lead, no audit and no new business', async () => {
      await SuppressedAddress.create({ hash: hashAddress('stop@fresh.example') });
      const error = await add('fresh.example', studioA, { email: 'stop@fresh.example' }).catch((e) => e);
      expect(error).toBeInstanceOf(ContactRightRefusedError);
      expect(error.reason).toBe('opted_out');
      expect(await Business.countDocuments({ domain: 'fresh.example' })).toBe(0);
      expect(await Promise.all([Lead.countDocuments(), Audit.countDocuments(), ContactRight.countDocuments()])).toEqual([0, 0, 0]);
    });

    it('two studios adding one new site at once: one lead, one right, one CONTACT_RIGHT_HELD', async () => {
      const results = await Promise.allSettled([add('both.example', studioA), add('both.example', studioB)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.reason).toBeInstanceOf(ContactRightRefusedError);
      expect(refused[0]!.reason.reason).toBe('held');
      expect(await Promise.all([Lead.countDocuments(), ContactRight.countDocuments(), Business.countDocuments()])).toEqual([1, 1, 1]);
    });

    it('without contactRight (a script) no right is written', async () => {
      const result = await add('script.example', studioA, { claim: false });
      expect(result.contactRight).toBeUndefined();
      expect(await ContactRight.countDocuments()).toBe(0);
      expect((await Business.findOne({ domain: 'script.example' }).lean())?.contactHold).toBeUndefined();
    });
  });
  describe('contactAvailabilityByDomain (REV-225)', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = new Date('2026-11-10T00:00:00Z');
    const hold = (expiresAt: Date, cooldownUntil: Date) => ({ rightId: new Types.ObjectId(), tenantId: new Types.ObjectId(), expiresAt, cooldownUntil });
    const make = (domain: string, extra: Record<string, unknown> = {}) =>
      Business.create({ domain, originalUrl: `https://${domain}`, businessName: domain, ...extra });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-availability-test' });
      await Promise.all([Business.init(), SuppressedAddress.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), SuppressedAddress.deleteMany({})]);
    });

    it('marks held, cooldown and opted-out domains with their reason and date; free and unknown ones are absent', async () => {
      const expires = new Date(now.getTime() + 3 * day);
      const cooldownEnd = new Date(now.getTime() + 20 * day);
      await make('held.test', { contactHold: hold(expires, cooldownEnd) });
      await make('cool.test', { contactHold: hold(new Date(now.getTime() - day), cooldownEnd) });
      await make('flag.test', { optedOutAt: now });
      await make('free.test');
      await make('over.test', { contactHold: hold(new Date(now.getTime() - 40 * day), new Date(now.getTime() - 10 * day)) });
      await make('mail.test');
      await SuppressedAddress.create({ hash: hashAddress('Stop@mail.test') });

      const map = await contactAvailabilityByDomain(
        [{ domain: 'held.test' }, { domain: 'cool.test' }, { domain: 'flag.test' }, { domain: 'free.test' }, { domain: 'over.test' }, { domain: 'unknown.test' }, { domain: 'mail.test', email: 'stop@mail.test' }],
        now,
      );
      expect(map.get('held.test')).toEqual({ reason: 'held', until: expires });
      expect(map.get('cool.test')).toEqual({ reason: 'cooldown', until: cooldownEnd });
      expect(map.get('flag.test')).toEqual({ reason: 'opted_out' });
      expect(map.get('mail.test')).toEqual({ reason: 'opted_out' });
      expect([...map.keys()].sort()).toEqual(['cool.test', 'flag.test', 'held.test', 'mail.test']);
    });

    it('an opt-out wins over a hold, and an empty list reads nothing', async () => {
      await make('both.test', { optedOutAt: now, contactHold: hold(new Date(now.getTime() + day), new Date(now.getTime() + 9 * day)) });
      expect((await contactAvailabilityByDomain([{ domain: 'both.test' }], now)).get('both.test')).toEqual({ reason: 'opted_out' });
      expect((await contactAvailabilityByDomain([], now)).size).toBe(0);
    });
  });
  describe('findAuditForLead (REV-208)', () => {
    const studioA = new Types.ObjectId();
    const studioB = new Types.ObjectId();
    const domain = 'lookup.example';
    const derive = () => ({ set: {}, clearsEmailGuess: false });
    const add = (tenantId: Types.ObjectId) =>
      addLeadToBusiness({ tenantId, lead: { businessName: 'Lookup', originalUrl: `https://${domain}`, domain, niche: 'dental', status: 'QUEUED' }, deriveFromAudit: derive as never });
    const finish = (id: unknown, total: number) => Audit.updateOne({ _id: id }, { status: 'COMPLETED', 'scores.total': total });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-lookup-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({})]);
    });

    it("gives a lead its own newest audit, whatever its status, before the business's", async () => {
      const a = await add(studioA);
      expect(String((await findAuditForLead(a.lead))!._id)).toBe(String(a.audit!._id));
      await finish(a.audit!._id, 70);
      const retry = await Audit.create({ leadId: a.lead._id, businessId: a.business._id, status: 'FAILED' });
      expect(String((await findAuditForLead(a.lead))!._id)).toBe(String(retry._id));
    });

    it('gives a lead that reused an audit the completed audit of its business', async () => {
      const a = await add(studioA);
      await finish(a.audit!._id, 70);
      const b = await add(studioB);
      expect(b.audit).toBeUndefined();
      expect(String((await findAuditForLead(b.lead))!._id)).toBe(String(a.audit!._id));
    });

    it("does not let studio A's retry or failure change what studio B sees", async () => {
      const a = await add(studioA);
      await finish(a.audit!._id, 70);
      const b = await add(studioB);
      await Audit.create({ leadId: a.lead._id, businessId: a.business._id, status: 'FAILED' });
      await Audit.create({ leadId: a.lead._id, businessId: a.business._id, status: 'PROCESSING' });
      expect(String((await findAuditForLead(b.lead))!._id)).toBe(String(a.audit!._id));
      expect((await findAuditForLead(b.lead, { completedOnly: true }))!.status).toBe('COMPLETED');
    });

    it('with completedOnly skips the lead own unfinished audits, then falls back to the business', async () => {
      const a = await add(studioA);
      await finish(a.audit!._id, 70);
      const b = await add(studioB);
      await Audit.create({ leadId: b.lead._id, businessId: b.business._id, status: 'QUEUED' });
      expect(String((await findAuditForLead(b.lead, { completedOnly: true }))!._id)).toBe(String(a.audit!._id));
      expect((await findAuditForLead(b.lead))!.status).toBe('QUEUED');
    });

    it('finds nothing for a lead with no audit and no completed one in its business', async () => {
      const a = await add(studioA);
      await Audit.deleteMany({});
      expect(await findAuditForLead(a.lead)).toBeNull();
    });

    it('treats a lead made before the split (no business) as before: its own audits only', async () => {
      const legacy = await Lead.create({ businessName: 'Old', originalUrl: 'https://old.example', domain: 'old.example', niche: 'dental' });
      expect(await findAuditForLead(legacy)).toBeNull();
      const own = await Audit.create({ leadId: legacy._id, status: 'COMPLETED' });
      expect(String((await findAuditForLead(legacy, { completedOnly: true }))!._id)).toBe(String(own._id));
      const other = await Audit.create({ leadId: new Types.ObjectId(), businessId: new Types.ObjectId(), status: 'COMPLETED' });
      expect(String((await findAuditForLead(legacy, { completedOnly: true }))!._id)).not.toBe(String(other._id));
    });

    it('auditBelongsToLead: own audit and an audit of its business yes, another business no', async () => {
      const a = await add(studioA);
      await finish(a.audit!._id, 70);
      const b = await add(studioB);
      expect(await auditBelongsToLead(a.audit!._id, a.lead)).toBe(true);
      expect(await auditBelongsToLead(a.audit!._id, b.lead)).toBe(true);
      const stranger = await Audit.create({ leadId: new Types.ObjectId(), businessId: new Types.ObjectId(), status: 'COMPLETED' });
      expect(await auditBelongsToLead(stranger._id, b.lead)).toBe(false);
      expect(await auditBelongsToLead(new Types.ObjectId(), b.lead)).toBe(false);
    });
  });
  describe('migrateBusinesses (REV-208)', () => {
    const legacyLead = (domain: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
      businessName: `Clinic ${domain}`,
      originalUrl: `https://${domain}`,
      domain,
      niche: 'dental',
      city: 'Gdansk',
      status: 'AUDITED',
      createdAt: new Date(createdAt),
      ...extra,
    });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-business-migration-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({})]);
    });

    const seedLegacy = async () => {
      // Written to the collection directly: leads made before the split have neither field
      const docs = [
        legacyLead('a.example', '2026-01-01'),
        legacyLead('a.example', '2026-02-01', { businessName: 'Second copy' }),
        legacyLead('b.example', '2026-03-01'),
      ];
      const inserted = await Lead.collection.insertMany(docs.map((d) => ({ ...d, updatedAt: d.createdAt })));
      const ids = Object.values(inserted.insertedIds);
      await Audit.collection.insertMany([
        { leadId: ids[0], status: 'COMPLETED', createdAt: new Date(), updatedAt: new Date() },
        { leadId: ids[0], status: 'FAILED', createdAt: new Date(), updatedAt: new Date() },
        { leadId: ids[2], status: 'COMPLETED', createdAt: new Date(), updatedAt: new Date() },
      ]);
      return ids;
    };

    it('a dry run reports what it would do and writes nothing', async () => {
      await seedLegacy();
      const report = await migrateBusinesses({ apply: false });
      expect(report).toMatchObject({ applied: false, leadsToLink: 3, businessesToCreate: 2, auditsToLink: 3 });
      expect(await Promise.all([Business.countDocuments(), Lead.countDocuments({ businessId: { $exists: true } }), Audit.countDocuments({ businessId: { $exists: true } })])).toEqual([0, 0, 0]);
    });

    it('applying gives leads that share a domain one business, from the oldest lead, and links the audits', async () => {
      const ids = await seedLegacy();
      const report = await migrateBusinesses({ apply: true });
      expect(report).toMatchObject({ applied: true, leadsToLink: 3, businessesToCreate: 2, auditsToLink: 3 });
      const businesses = await Business.find().sort({ domain: 1 }).lean();
      expect(businesses.map((b) => b.domain)).toEqual(['a.example', 'b.example']);
      expect(businesses[0]).toMatchObject({ businessName: 'Clinic a.example', originalUrl: 'https://a.example', niche: 'dental', city: 'Gdansk' });
      const leads = await Lead.find({ _id: { $in: ids } }).lean();
      const businessOf = (id: unknown) => String(leads.find((l) => String(l._id) === String(id))!.businessId);
      expect(businessOf(ids[0])).toBe(String(businesses[0]!._id));
      expect(businessOf(ids[1])).toBe(String(businesses[0]!._id));
      expect(businessOf(ids[2])).toBe(String(businesses[1]!._id));
      expect(await Audit.countDocuments({ businessId: { $exists: false } })).toBe(0);
      expect(await Audit.countDocuments({ leadId: ids[0], businessId: businesses[0]!._id })).toBe(2);
      // No tenant is assigned here: that is REV-210
      expect(await Lead.countDocuments({ tenantId: { $exists: true } })).toBe(0);
    });

    it('is idempotent: a second run changes nothing', async () => {
      await seedLegacy();
      await migrateBusinesses({ apply: true });
      const before = await Business.find().lean();
      const report = await migrateBusinesses({ apply: true });
      expect(report).toMatchObject({ leadsToLink: 0, businessesToCreate: 0, auditsToLink: 0 });
      expect(await Business.find().lean()).toEqual(before);
    });

    it('reuses a business that already exists for the domain and leaves already linked leads and audits alone', async () => {
      const existing = await Business.create({ domain: 'a.example', originalUrl: 'https://a.example', businessName: 'Kept', niche: 'dental' });
      const linked = await Lead.create({ ...legacyLead('a.example', '2026-01-01'), businessId: existing._id });
      await Audit.create({ leadId: linked._id, businessId: existing._id, status: 'COMPLETED' });
      await Lead.collection.insertOne({ ...legacyLead('a.example', '2026-04-01'), updatedAt: new Date() });
      const report = await migrateBusinesses({ apply: true });
      expect(report).toMatchObject({ leadsToLink: 1, businessesToCreate: 0, auditsToLink: 0 });
      expect(await Business.countDocuments()).toBe(1);
      expect((await Business.findOne().lean())!.businessName).toBe('Kept');
    });

    it('checkBusinessLinks warns while a lead has no business, with the command to run, and is quiet after', async () => {
      await seedLegacy();
      const warnings = await checkBusinessLinks(mongoose.connection);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('3 lead(s)');
      expect(warnings[0]).toContain(MIGRATE_BUSINESSES_COMMAND);
      await migrateBusinesses({ apply: true });
      expect(await checkBusinessLinks(mongoose.connection)).toEqual([]);
    });

    it('links an audit that has no business although its lead is linked (an old API during a rolling deploy)', async () => {
      const business = await Business.create({ domain: 'a.example', originalUrl: 'https://a.example', businessName: 'A', niche: 'dental' });
      const lead = await Lead.create({ ...legacyLead('a.example', '2026-01-01'), businessId: business._id });
      await Audit.collection.insertOne({ leadId: lead._id, status: 'COMPLETED', createdAt: new Date(), updatedAt: new Date() });
      const warnings = await checkBusinessLinks(mongoose.connection);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('1 audit(s)');
      const report = await migrateBusinesses({ apply: true });
      expect(report).toMatchObject({ leadsToLink: 0, businessesToCreate: 0, auditsToLink: 1 });
      expect(String((await Audit.findOne({ leadId: lead._id }).lean())!.businessId)).toBe(String(business._id));
      expect(await checkBusinessLinks(mongoose.connection)).toEqual([]);
    });

    it('does not fail when the API creates the business of a domain while the backfill does', async () => {
      await seedLegacy();
      const original = Business.findOneAndUpdate.bind(Business);
      let raced = false;
      vi.spyOn(Business, 'findOneAndUpdate').mockImplementation(((...args: Parameters<typeof original>) => {
        if (!raced) {
          raced = true;
          // Another process wins the unique domain between the lookup and the upsert
          return { lean: () => Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 })) } as never;
        }
        return original(...args);
      }) as never);
      const report = await migrateBusinesses({ apply: true });
      vi.restoreAllMocks();
      expect(report.leadsToLink).toBe(3);
      expect(await Lead.countDocuments({ businessId: { $exists: false } })).toBe(0);
    });

    it('checkBusinessLinks is quiet on an empty database', async () => {
      expect(await checkBusinessLinks(mongoose.connection)).toEqual([]);
    });
  });
  describe('review fixes (REV-208)', () => {
    const studio = new Types.ObjectId();
    const derive = () => ({ set: {}, clearsEmailGuess: false });

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-review-fixes-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init(), Organization.init(), User.init(), Membership.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({}), Organization.deleteMany({}), User.deleteMany({}), Membership.deleteMany({})]);
    });

    it('audits are indexed by business, status and date: the lookups of a shared audit do not scan every completed audit', async () => {
      const indexes = await Audit.collection.indexes();
      expect(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ businessId: 1, status: 1, createdAt: -1 }))).toBe(true);
    });

    it('a studio with other leads still gets LEAD_ALREADY_EXISTS (not a raw duplicate-key error) when its adds of one new site race', async () => {
      // The studio already has leads of other sites: a fallback that picks "any lead of the studio" would pick one of those
      for (const domain of ['one.example', 'two.example', 'three.example']) {
        await addLeadToBusiness({ tenantId: studio, deriveFromAudit: derive as never, lead: { businessName: domain, originalUrl: `https://${domain}`, domain, niche: 'dental', status: 'QUEUED' } });
      }
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          addLeadToBusiness({ tenantId: studio, deriveFromAudit: derive as never, lead: { businessName: 'New', originalUrl: 'https://new.example', domain: 'new.example', niche: 'dental', status: 'QUEUED' } }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((r) => r.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LeadAlreadyExistsError);
      }
      expect(await Lead.countDocuments({ tenantId: studio, domain: 'new.example' })).toBe(1);
    });

    describe('seeding a database that was seeded before the split and then backfilled', () => {
      const ds = buildDemoDataset(new Date('2026-11-21T12:00:00.000Z'));

      /** The state the README describes: seeded long ago, no businesses, then `migrate:businesses --apply` ran */
      const preSplitThenBackfilled = async () => {
        await seedDemoDataset(ds, { reset: false });
        await Business.deleteMany({});
        await Lead.updateMany({}, { $unset: { businessId: 1, tenantId: 1 } });
        await Audit.updateMany({}, { $unset: { businessId: 1 } });
        await migrateBusinesses({ apply: true });
        expect(await Business.countDocuments({ _id: { $in: ds.businesses.map((b) => b._id) } })).toBe(0);
      };

      it('a plain run keeps the backfilled businesses, and a demo lead it has to insert points at them', async () => {
        await preSplitThenBackfilled();
        const gone = ds.leads[0]!;
        await Lead.deleteOne({ _id: gone._id });
        await Audit.deleteMany({ leadId: gone._id });
        const report = await seedDemoDataset(ds, { reset: false });
        expect(report.businesses).toEqual({ inserted: 0, kept: ds.businesses.length });
        expect(await Business.countDocuments()).toBe(ds.leads.length);
        const reinserted = await Lead.findById(gone._id).lean();
        const business = await Business.findOne({ domain: gone.domain }).lean();
        expect(String(reinserted!.businessId)).toBe(String(business!._id));
        expect(String((await Audit.findOne({ leadId: gone._id }).lean())!.businessId)).toBe(String(business!._id));
      });

      it('a reset replaces the backfilled businesses of the demo domains with the seed ones, leaving none behind', async () => {
        await preSplitThenBackfilled();
        await seedDemoDataset(ds, { reset: true });
        const seedIds = new Set(ds.businesses.map((b) => String(b._id)));
        const businesses = await Business.find().lean();
        expect(businesses).toHaveLength(ds.leads.length);
        expect(businesses.every((b) => seedIds.has(String(b._id)))).toBe(true);
        const leads = await Lead.find().lean();
        expect(leads.every((l) => seedIds.has(String(l.businessId)))).toBe(true);
      });

      it('a reset leaves the business and the lead of a real studio alone', async () => {
        await preSplitThenBackfilled();
        const real = await Lead.create({ businessName: 'Real', originalUrl: 'https://real.example', domain: 'real.example', niche: 'dental' });
        const realBusiness = await Business.create({ domain: 'real.example', originalUrl: 'https://real.example', businessName: 'Real', niche: 'dental' });
        await Lead.updateOne({ _id: real._id }, { businessId: realBusiness._id });
        await seedDemoDataset(ds, { reset: true });
        expect(await Business.findById(realBusiness._id).lean()).not.toBeNull();
        expect(await Lead.findById(real._id).lean()).not.toBeNull();
      });
    });
  });
  describe('tenant indexes (REV-209)', () => {
    const SORT = { onePageBrochure: -1, createdAt: -1 } as const;
    const keyOf = (indexes: { key: Record<string, number> }[], key: Record<string, number>) =>
      indexes.some((i) => JSON.stringify(i.key) === JSON.stringify(key));

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-tenant-index-test' });
      await Promise.all([Lead.init(), MvpProject.init(), EmailCampaign.init(), AnalyticsEvent.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Lead.deleteMany({});
    });

    it("has the studio's list and status indexes on leads and a studio index on each child collection", async () => {
      const leads = await Lead.collection.indexes();
      expect(keyOf(leads, { tenantId: 1, onePageBrochure: -1, createdAt: -1 })).toBe(true);
      expect(keyOf(leads, { tenantId: 1, status: 1 })).toBe(true);
      for (const model of [MvpProject, EmailCampaign, AnalyticsEvent]) {
        expect(keyOf(await model.collection.indexes(), { tenantId: 1 }), model.modelName).toBe(true);
      }
    });

    it("answers a studio's lead list and status filter from an index, with no in-memory sort", async () => {
      const studioA = new Types.ObjectId();
      const studioB = new Types.ObjectId();
      await Lead.insertMany(
        Array.from({ length: 60 }, (_, i) => ({
          businessName: `Lead ${i}`,
          originalUrl: `https://l${i}.example`,
          domain: `l${i}.example`,
          niche: 'dental',
          tenantId: i % 2 ? studioA : studioB,
          status: i % 3 ? 'QUEUED' : 'AUDITED',
          onePageBrochure: i % 5 === 0,
        })),
      );
      // Only the winning plan counts: the planner also lists the plans it rejected
      const plan = async (query: ReturnType<typeof Lead.find>) =>
        JSON.stringify(((await query.explain('queryPlanner')) as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan);
      const list = await plan(Lead.find({ tenantId: studioA }).sort(SORT).limit(20));
      expect(list).toContain('tenantId_1_onePageBrochure_-1_createdAt_-1');
      expect(list).not.toContain('"stage":"SORT"');
      const filtered = await plan(Lead.find({ tenantId: studioA, status: 'QUEUED' }));
      expect(filtered).toContain('IXSCAN');
      expect(filtered).not.toContain('COLLSCAN');
    });
  });
  describe('migrateTenants and checkTenantLinks (REV-209)', () => {
    let older: Types.ObjectId;
    let newer: Types.ObjectId;

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-tenant-migration-test' });
      await Promise.all([Lead.init(), MvpProject.init(), EmailCampaign.init(), AnalyticsEvent.init(), Organization.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Lead.deleteMany({}), MvpProject.deleteMany({}), EmailCampaign.deleteMany({}), AnalyticsEvent.deleteMany({}), Organization.deleteMany({})]);
      // createdAt is immutable through Mongoose updates: the age is written through the collection
      older = new Types.ObjectId();
      newer = new Types.ObjectId();
      await Organization.collection.insertMany([
        { _id: newer, name: 'Newer Studio', createdAt: new Date('2026-06-01'), updatedAt: new Date('2026-06-01') },
        { _id: older, name: 'Older Studio', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
      ]);
    });

    const leadDoc = (domain: string, extra: Record<string, unknown> = {}) => ({
      businessName: `Clinic ${domain}`,
      originalUrl: `https://${domain}`,
      domain,
      niche: 'dental',
      status: 'AUDITED',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });

    /** Records as they were before the tenants: none has a studio */
    const seedLegacy = async () => {
      const [a, b] = Object.values((await Lead.collection.insertMany([leadDoc('a.example'), leadDoc('b.example')])).insertedIds);
      await MvpProject.collection.insertMany([{ leadId: a, ...mvpFields(1) }, { leadId: b, ...mvpFields(2) }]);
      await EmailCampaign.collection.insertOne({ leadId: a, ...campaignFields(1) });
      await AnalyticsEvent.collection.insertMany([
        { leadId: a, eventType: 'open', timestamp: new Date() },
        { eventType: 'open', timestamp: new Date() },
      ]);
      return { a: a!, b: b! };
    };

    it('a dry run reports what it would do and writes nothing', async () => {
      await seedLegacy();
      const report = await migrateTenants({ apply: false });
      expect(report).toMatchObject({ applied: false, conflicts: [], organizationId: String(older), leadsToAssign: 2, mvpsToAssign: 2, campaignsToAssign: 1, eventsToAssign: 1 });
      expect(await Promise.all([Lead, MvpProject, EmailCampaign, AnalyticsEvent].map((m) => m.countDocuments({ tenantId: { $exists: true } })))).toEqual([0, 0, 0, 0]);
    });

    it('gives the leads to the oldest organization by default, and each child the studio of its lead', async () => {
      const { a, b } = await seedLegacy();
      await Lead.collection.updateOne({ _id: b }, { $set: { tenantId: newer } });
      const report = await migrateTenants({ apply: true });
      expect(report).toMatchObject({ applied: true, leadsToAssign: 1 });
      expect(String((await Lead.findById(a).lean())?.tenantId)).toBe(String(older));
      // b kept the studio it had; its MVP follows it, not the chosen organization
      expect(String((await Lead.findById(b).lean())?.tenantId)).toBe(String(newer));
      expect(String((await MvpProject.findOne({ leadId: a }).lean())?.tenantId)).toBe(String(older));
      expect(String((await MvpProject.findOne({ leadId: b }).lean())?.tenantId)).toBe(String(newer));
      expect(String((await EmailCampaign.findOne({ leadId: a }).lean())?.tenantId)).toBe(String(older));
      expect(String((await AnalyticsEvent.findOne({ leadId: a }).lean())?.tenantId)).toBe(String(older));
    });

    it('uses the organization it is given', async () => {
      const { a } = await seedLegacy();
      await migrateTenants({ apply: true, organizationId: String(newer) });
      expect(String((await Lead.findById(a).lean())?.tenantId)).toBe(String(newer));
    });

    it('leaves an event that names no lead in no studio, and gives an MVP whose lead is gone to the chosen organization', async () => {
      await seedLegacy();
      await MvpProject.collection.insertOne({ leadId: new Types.ObjectId(), ...mvpFields(3) });
      await migrateTenants({ apply: true });
      expect(await AnalyticsEvent.countDocuments({ leadId: { $exists: false }, tenantId: { $exists: true } })).toBe(0);
      expect(await MvpProject.countDocuments({ tenantId: { $exists: false } })).toBe(0);
    });

    it('is idempotent: a second run changes nothing', async () => {
      await seedLegacy();
      await migrateTenants({ apply: true });
      const before = await Promise.all([Lead, MvpProject, EmailCampaign, AnalyticsEvent].map((m) => m.find().lean()));
      const report = await migrateTenants({ apply: true });
      expect(report).toMatchObject({ leadsToAssign: 0, mvpsToAssign: 0, campaignsToAssign: 0, eventsToAssign: 0 });
      expect(await Promise.all([Lead, MvpProject, EmailCampaign, AnalyticsEvent].map((m) => m.find().lean()))).toEqual(before);
    });

    it('reports two leads on one business as a conflict and refuses to apply, writing nothing (the unique { tenantId, businessId } index)', async () => {
      const business = new Types.ObjectId();
      const [x, y] = Object.values((await Lead.collection.insertMany([leadDoc('dup.example', { businessId: business }), leadDoc('dup.example', { businessId: business })])).insertedIds);
      const report = await migrateTenants({ apply: false });
      expect(report.conflicts).toEqual([{ businessId: String(business), leadIds: [String(x), String(y)] }]);
      await expect(migrateTenants({ apply: true })).rejects.toBeInstanceOf(TenantMigrationError);
      expect(await Lead.countDocuments({ tenantId: { $exists: true } })).toBe(0);
    });

    it('also finds a conflict with a lead the target organization already has', async () => {
      const business = new Types.ObjectId();
      await Lead.collection.insertOne(leadDoc('own.example', { businessId: business, tenantId: older }));
      await Lead.collection.insertOne(leadDoc('own.example', { businessId: business }));
      const report = await migrateTenants({ apply: false });
      expect(report.conflicts).toHaveLength(1);
      // Another organization as the target has no conflict
      expect((await migrateTenants({ apply: false, organizationId: String(newer) })).conflicts).toEqual([]);
    });

    it('refuses an unknown organization, an invalid id, and a database with no organization, writing nothing', async () => {
      await seedLegacy();
      await expect(migrateTenants({ apply: true, organizationId: String(new Types.ObjectId()) })).rejects.toBeInstanceOf(TenantMigrationError);
      await expect(migrateTenants({ apply: true, organizationId: 'nope' })).rejects.toBeInstanceOf(TenantMigrationError);
      expect(await Lead.countDocuments({ tenantId: { $exists: true } })).toBe(0);
      await Organization.deleteMany({});
      await expect(migrateTenants({ apply: true })).rejects.toThrow('No organization exists');
    });

    it('checkTenantLinks warns with the command while a record has no studio, and is quiet after the migration', async () => {
      expect(await checkTenantLinks(mongoose.connection)).toEqual([]);
      await seedLegacy();
      const [warning] = await checkTenantLinks(mongoose.connection);
      expect(warning).toContain('2 lead(s), 2 MVP(s), 1 campaign(s), 1 event(s)');
      expect(warning).toContain(MIGRATE_TENANTS_COMMAND);
      await migrateTenants({ apply: true });
      expect(await checkTenantLinks(mongoose.connection)).toEqual([]);
    });
  });
  describe('tenant filters the workers use (REV-210)', () => {
    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-worker-tenant-test' });
      await Lead.init();
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Lead.deleteMany({});
    });

    const fields = { businessName: 'W', originalUrl: 'https://w.test', domain: 'w.test', niche: 'other' };

    it("a status update filtered by the job's studio, given as a string, leaves another studio's lead and a lead with no studio alone", async () => {
      const a = new Types.ObjectId();
      const b = new Types.ObjectId();
      const own = await Lead.create({ ...fields, tenantId: a, status: 'AUDITING' });
      const foreign = await Lead.create({ ...fields, domain: 'x.test', tenantId: b, status: 'AUDITING' });
      const legacy = await Lead.create({ ...fields, domain: 'y.test', status: 'AUDITING' });
      for (const lead of [own, foreign, legacy]) {
        // The failure handlers pass the job's tenantId as the string it travels as
        await Lead.findOneAndUpdate({ _id: lead._id, status: 'AUDITING', tenantId: String(a) }, { $set: { status: 'AUDIT_FAILED' } });
      }
      expect((await Lead.findById(own._id).lean())?.status).toBe('AUDIT_FAILED');
      expect((await Lead.findById(foreign._id).lean())?.status).toBe('AUDITING');
      expect((await Lead.findById(legacy._id).lean())?.status).toBe('AUDITING');
    });

    it('the audit worker\'s foreign-lead probe { tenantId: { $ne } } finds another studio\'s lead and a lead with no studio, not its own', async () => {
      const a = new Types.ObjectId();
      const own = await Lead.create({ ...fields, tenantId: a });
      const foreign = await Lead.create({ ...fields, domain: 'x.test', tenantId: new Types.ObjectId() });
      const legacy = await Lead.create({ ...fields, domain: 'y.test' });
      const probe = (id: Types.ObjectId) => Lead.exists({ _id: id, tenantId: { $ne: a } });
      expect(await probe(own._id)).toBeNull();
      expect(await probe(foreign._id)).not.toBeNull();
      expect(await probe(legacy._id)).not.toBeNull();
    });
  });
  describe('contact registry (REV-224)', () => {
    const durations = { rightDays: 14, cooldownDays: 30 };
    const day = 24 * 60 * 60 * 1000;
    const t0 = at('2026-11-01T00:00:00Z');
    const expires = new Date(t0.getTime() + 14 * day);
    const cooldownEnd = new Date(expires.getTime() + 30 * day);

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-contact-registry-test' });
      await Promise.all([Business.init(), ContactRight.init(), SuppressedAddress.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), ContactRight.deleteMany({}), SuppressedAddress.deleteMany({})]);
    });

    const makeBusiness = (n = 1, extra: Record<string, unknown> = {}) =>
      Business.create({ domain: `b${n}.test`, originalUrl: `https://b${n}.test`, businessName: `B${n}`, ...extra });
    const grant = (businessId: Types.ObjectId, extra: Partial<Parameters<typeof grantContactRight>[0]> = {}) =>
      grantContactRight({
        tenantId: new Types.ObjectId(),
        businessId,
        leadId: new Types.ObjectId(),
        source: 'ADD_LEAD',
        durations,
        now: t0,
        ...extra,
      });

    it('grants a free business and writes the hold', async () => {
      const business = await makeBusiness();
      const result = await grant(business._id);
      expect(result.granted).toBe(true);
      if (!result.granted) return;
      expect(result.right.expiresAt).toEqual(expires);
      expect(result.right.cooldownUntil).toEqual(cooldownEnd);
      const stored = await Business.findById(business._id).lean();
      expect(String(stored?.contactHold?.rightId)).toBe(String(result.right._id));
      expect(String(stored?.contactHold?.tenantId)).toBe(String(result.right.tenantId));
      expect(stored?.contactHold?.expiresAt).toEqual(expires);
      expect(await ContactRight.countDocuments()).toBe(1);
    });

    it('refuses another studio while held, with expiresAt, writing nothing', async () => {
      const business = await makeBusiness();
      await grant(business._id);
      const refused = await grant(business._id, { now: new Date(t0.getTime() + day) });
      expect(refused).toEqual({ granted: false, reason: 'held', expiresAt: expires });
      expect(await ContactRight.countDocuments()).toBe(1);
    });

    it('refuses the same studio while held', async () => {
      const business = await makeBusiness();
      const tenantId = new Types.ObjectId();
      await grant(business._id, { tenantId });
      const refused = await grant(business._id, { tenantId, now: new Date(t0.getTime() + day) });
      expect(refused).toMatchObject({ granted: false, reason: 'held' });
    });

    it('at expiresAt it is cooldown with availableAt, and at cooldownUntil a new grant succeeds', async () => {
      const business = await makeBusiness();
      const first = await grant(business._id);
      expect(first.granted).toBe(true);
      expect(await grant(business._id, { now: new Date(expires.getTime() - 1) })).toMatchObject({ granted: false, reason: 'held' });
      expect(await grant(business._id, { now: expires })).toEqual({ granted: false, reason: 'cooldown', availableAt: cooldownEnd });
      expect(await grant(business._id, { now: new Date(cooldownEnd.getTime() - 1) })).toMatchObject({ granted: false, reason: 'cooldown' });
      const next = await grant(business._id, { now: cooldownEnd });
      expect(next.granted).toBe(true);
      if (!next.granted) return;
      const stored = await Business.findById(business._id).lean();
      expect(String(stored?.contactHold?.rightId)).toBe(String(next.right._id));
      expect(await ContactRight.countDocuments()).toBe(2);
    });

    it('the cooldown blocks the former holder too', async () => {
      const business = await makeBusiness();
      const tenantId = new Types.ObjectId();
      await grant(business._id, { tenantId });
      expect(await grant(business._id, { tenantId, now: new Date(expires.getTime() + day) })).toMatchObject({ granted: false, reason: 'cooldown' });
    });

    it('refuses an opted-out business', async () => {
      const business = await makeBusiness(1, { optedOutAt: t0 });
      expect(await grant(business._id)).toEqual({ granted: false, reason: 'opted_out' });
      expect(await ContactRight.countDocuments()).toBe(0);
      expect((await Business.findById(business._id).lean())?.contactHold).toBeUndefined();
    });

    it('opted_out wins over held', async () => {
      const business = await makeBusiness();
      await grant(business._id);
      await Business.updateOne({ _id: business._id }, { $set: { optedOutAt: t0 } });
      expect(await grant(business._id, { now: new Date(t0.getTime() + day) })).toEqual({ granted: false, reason: 'opted_out' });
    });

    it('refuses a lead whose contact email is suppressed under another business', async () => {
      const other = await makeBusiness(1);
      const business = await makeBusiness(2);
      await SuppressedAddress.create({ hash: hashAddress('Owner@Example.com') });
      expect(other.optedOutAt).toBeUndefined();
      const refused = await grant(business._id, { contactEmail: ' owner@example.COM ' });
      expect(refused).toEqual({ granted: false, reason: 'opted_out' });
      expect(await ContactRight.countDocuments()).toBe(0);
      expect((await Business.findById(business._id).lean())?.contactHold).toBeUndefined();
      expect((await grant(business._id, { contactEmail: 'someone@else.test' })).granted).toBe(true);
    });

    it('throws for a business that does not exist', async () => {
      await expect(grant(new Types.ObjectId())).rejects.toThrow('not found');
    });

    it('20 concurrent grants leave exactly one right', async () => {
      const business = await makeBusiness();
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          mongoose.connection.transaction((session) => grant(business._id, { session })),
        ),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const values = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof grant>>>).value);
      expect(values.filter((v) => v.granted)).toHaveLength(1);
      expect(values.filter((v) => !v.granted && v.reason === 'held')).toHaveLength(19);
      expect(await ContactRight.countDocuments({ businessId: business._id })).toBe(1);
      const stored = await Business.findById(business._id).lean();
      const right = await ContactRight.findOne({ businessId: business._id }).lean();
      expect(String(stored?.contactHold?.rightId)).toBe(String(right?._id));
    });

    it('20 concurrent grants without a session also leave exactly one right', async () => {
      const business = await makeBusiness();
      const results = await Promise.all(Array.from({ length: 20 }, () => grant(business._id)));
      expect(results.filter((r) => r.granted)).toHaveLength(1);
      expect(await ContactRight.countDocuments({ businessId: business._id })).toBe(1);
    });

    it('a grant in a transaction that aborts leaves no hold and no right', async () => {
      const business = await makeBusiness();
      await expect(
        mongoose.connection.transaction(async (session) => {
          expect((await grant(business._id, { session })).granted).toBe(true);
          throw new Error('enqueue failed');
        }),
      ).rejects.toThrow('enqueue failed');
      expect(await ContactRight.countDocuments()).toBe(0);
      expect((await Business.findById(business._id).lean())?.contactHold).toBeUndefined();
      expect((await grant(business._id)).granted).toBe(true);
    });

    it('findActiveContactRight finds the right by studio and business and by lead while active', async () => {
      const business = await makeBusiness();
      const tenantId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const result = await grant(business._id, { tenantId, leadId });
      if (!result.granted) throw new Error('expected a grant');
      const during = new Date(t0.getTime() + day);
      expect(String((await findActiveContactRight({ tenantId, businessId: business._id }, during))?._id)).toBe(String(result.right._id));
      expect(String((await findActiveContactRight({ leadId }, during))?._id)).toBe(String(result.right._id));
      expect(await findActiveContactRight({ tenantId: new Types.ObjectId(), businessId: business._id }, during)).toBeNull();
      expect(await findActiveContactRight({ leadId }, new Date(t0.getTime() - 1))).toBeNull();
      expect(await findActiveContactRight({ leadId }, expires)).toBeNull();
      expect(await findActiveContactRight({ leadId }, new Date(expires.getTime() + day))).toBeNull();
    });

    it('findActiveContactRight returns null after endContactRight, and the cooldown starts at the end time', async () => {
      const business = await makeBusiness();
      const leadId = new Types.ObjectId();
      const result = await grant(business._id, { leadId });
      if (!result.granted) throw new Error('expected a grant');
      const end = new Date(t0.getTime() + 3 * day);
      await endContactRight(result.right._id, { at: end, reason: 'opted_out' });
      expect(await findActiveContactRight({ leadId }, new Date(end.getTime() - 1))).toBeNull();
      const stored = await ContactRight.findById(result.right._id).lean();
      expect(stored?.endedAt).toEqual(end);
      expect(stored?.endReason).toBe('opted_out');
      const hold = (await Business.findById(business._id).lean())?.contactHold;
      expect(hold?.expiresAt).toEqual(end);
      expect(hold?.cooldownUntil).toEqual(new Date(end.getTime() + 30 * day));
      expect(await grant(business._id, { now: end })).toMatchObject({ granted: false, reason: 'cooldown' });
    });
  });
  describe('migrateContactRights and checkContactRights (REV-224)', () => {
    const durations = { rightDays: 14, cooldownDays: 30 };
    const day = 24 * 60 * 60 * 1000;
    const now = at('2026-11-10T00:00:00Z');

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-contact-migration-test' });
      await Promise.all([Business.init(), ContactRight.init(), SuppressedAddress.init(), Lead.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), ContactRight.deleteMany({}), SuppressedAddress.deleteMany({}), Lead.deleteMany({})]);
    });

    const studioA = new Types.ObjectId();
    const studioB = new Types.ObjectId();
    const business = (n: number) => Business.create({ domain: `m${n}.test`, originalUrl: `https://m${n}.test`, businessName: `M${n}` });
    const lead = (b: { _id: Types.ObjectId }, tenantId: Types.ObjectId | undefined, extra: Record<string, unknown> = {}) =>
      Lead.create({
        businessName: 'L',
        originalUrl: 'https://l.test',
        domain: `l-${new Types.ObjectId().toString()}.test`,
        businessId: b._id,
        ...(tenantId ? { tenantId } : {}),
        ...extra,
      });

    async function seedWorld() {
      const shared = await business(1);
      const older = await lead(shared, studioA, { createdAt: at('2026-10-01T00:00:00Z') });
      const newer = await lead(shared, studioB, { createdAt: at('2026-10-05T00:00:00Z') });
      const solo = await business(2);
      const soloLead = await lead(solo, studioA, { createdAt: at('2026-10-02T00:00:00Z') });
      const gone = await business(3);
      const goneLead = await lead(gone, studioB, {
        status: 'UNSUBSCRIBED',
        contactEmail: 'Boss@Gone.test',
        createdAt: at('2026-10-03T00:00:00Z'),
      });
      // Mongoose stamps updatedAt on create; set it directly
      await Lead.collection.updateOne({ _id: goneLead._id }, { $set: { updatedAt: at('2026-10-20T00:00:00Z') } });
      const legacy = await business(4);
      await lead(legacy, undefined);
      return { shared, older, newer, solo, soloLead, gone, goneLead, legacy };
    }

    it('a dry run reports and writes nothing', async () => {
      await seedWorld();
      const report = await migrateContactRights({ apply: false, durations, now });
      expect(report).toMatchObject({ applied: false, rightsToGrant: 2, businessesToOptOut: 1, addressesToSuppress: 1 });
      expect(await ContactRight.countDocuments()).toBe(0);
      expect(await SuppressedAddress.countDocuments()).toBe(0);
      expect(await Business.countDocuments({ $or: [{ contactHold: { $exists: true } }, { optedOutAt: { $exists: true } }] })).toBe(0);
    });

    it('an apply grants the oldest studio lead of each business and lists the other studio lead as a conflict', async () => {
      const w = await seedWorld();
      const report = await migrateContactRights({ apply: true, durations, now });
      expect(report.applied).toBe(true);
      expect(report.conflicts).toEqual([{ businessId: String(w.shared._id), keptLeadId: String(w.older._id), otherLeadIds: [String(w.newer._id)] }]);
      const rights = await ContactRight.find().lean();
      expect(rights).toHaveLength(2);
      const sharedRight = rights.find((r) => String(r.businessId) === String(w.shared._id))!;
      expect(String(sharedRight.leadId)).toBe(String(w.older._id));
      expect(String(sharedRight.tenantId)).toBe(String(studioA));
      expect(sharedRight.source).toBe('MIGRATION');
      expect(sharedRight.grantedAt).toEqual(now);
      expect(sharedRight.expiresAt).toEqual(new Date(now.getTime() + 14 * day));
      expect(String(rights.find((r) => String(r.businessId) === String(w.solo._id))?.leadId)).toBe(String(w.soloLead._id));
      expect((await Business.findById(w.shared._id).lean())?.contactHold?.rightId).toEqual(sharedRight._id);
      // a lead without a studio is skipped
      expect((await Business.findById(w.legacy._id).lean())?.contactHold).toBeUndefined();
    });

    it('a business with an UNSUBSCRIBED lead gets optedOutAt and a suppressed hash, and no right', async () => {
      const w = await seedWorld();
      await migrateContactRights({ apply: true, durations, now });
      const stored = await Business.findById(w.gone._id).lean();
      expect(stored?.optedOutAt).toEqual(at('2026-10-20T00:00:00Z'));
      expect(stored?.contactHold).toBeUndefined();
      expect(await ContactRight.countDocuments({ businessId: w.gone._id })).toBe(0);
      const hashes = (await SuppressedAddress.find().lean()).map((a) => a.hash);
      expect(hashes).toEqual([hashAddress('boss@gone.test')]);
    });

    it('a second apply changes nothing', async () => {
      await seedWorld();
      await migrateContactRights({ apply: true, durations, now });
      const before = {
        rights: await ContactRight.find().sort({ _id: 1 }).lean(),
        businesses: await Business.find().sort({ _id: 1 }).lean(),
        hashes: await SuppressedAddress.find().sort({ _id: 1 }).lean(),
      };
      const later = new Date(now.getTime() + day);
      const report = await migrateContactRights({ apply: true, durations, now: later });
      expect(report).toMatchObject({ rightsToGrant: 0, businessesToOptOut: 0, addressesToSuppress: 0, conflicts: [] });
      expect({
        rights: await ContactRight.find().sort({ _id: 1 }).lean(),
        businesses: await Business.find().sort({ _id: 1 }).lean(),
        hashes: await SuppressedAddress.find().sort({ _id: 1 }).lean(),
      }).toEqual(before);
    });

    it('does not touch a business a studio already holds through the normal path', async () => {
      const held = await business(5);
      const mine = await lead(held, studioA);
      await lead(held, studioB);
      const granted = await grantContactRight({ tenantId: studioB, businessId: held._id, leadId: mine._id, source: 'ADD_LEAD', durations, now });
      expect(granted.granted).toBe(true);
      const report = await migrateContactRights({ apply: true, durations, now });
      expect(report).toMatchObject({ rightsToGrant: 0, conflicts: [] });
      expect(await ContactRight.countDocuments()).toBe(1);
    });

    it('never gives the right to a closed lead: a newer live lead of another studio holds it, with no conflict', async () => {
      const x = await business(6);
      const studioC = new Types.ObjectId();
      await lead(x, studioA, { status: 'REJECTED', createdAt: at('2026-10-01T00:00:00Z') });
      const live = await lead(x, studioC, { status: 'NEEDS_APPROVAL', createdAt: at('2026-10-05T00:00:00Z') });
      const report = await migrateContactRights({ apply: true, durations, now });
      expect(report.conflicts).toEqual([]);
      const right = await ContactRight.findOne({ businessId: x._id }).lean();
      expect(String(right?.leadId)).toBe(String(live._id));
      expect(String(right?.tenantId)).toBe(String(studioC));
    });

    it('a business whose only lead is closed gets no right, and checkContactRights does not warn about it', async () => {
      const x = await business(7);
      await lead(x, studioA, { status: 'AUDIT_FAILED' });
      expect(await checkContactRights(mongoose.connection)).toEqual([]);
      const report = await migrateContactRights({ apply: true, durations, now });
      expect(report).toMatchObject({ rightsToGrant: 0, conflicts: [] });
      expect(await ContactRight.countDocuments()).toBe(0);
      expect((await Business.findById(x._id).lean())?.contactHold).toBeUndefined();
    });

    it('checkContactRights warns with the command before the migration and returns [] after it', async () => {
      expect(await checkContactRights(mongoose.connection)).toEqual([]);
      await seedWorld();
      const [warning, ...rest] = await checkContactRights(mongoose.connection);
      expect(rest).toEqual([]);
      expect(warning).toContain(MIGRATE_CONTACT_RIGHTS_COMMAND);
      expect(warning).toContain('3 business(es)');
      await migrateContactRights({ apply: true, durations, now });
      expect(await checkContactRights(mongoose.connection)).toEqual([]);
    });
  });

  describe('recordBusinessOptOut (REV-227)', () => {
    const durations = { rightDays: 14, cooldownDays: 30 };
    const day = 24 * 60 * 60 * 1000;
    const t0 = at('2026-11-01T00:00:00Z');
    const optOutAt = at('2026-11-03T00:00:00Z');
    const statuses = ['QUEUED', 'AUDITING', 'AUDITED', 'GENERATING', 'NEEDS_APPROVAL', 'SCHEDULED', 'SENT', 'OPENED', 'CLICKED', 'ENGAGED'] as const;
    const studioA = new Types.ObjectId();
    const studioC = new Types.ObjectId();
    const studioD = new Types.ObjectId();

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-optout-test' });
      await Promise.all([Business.init(), Lead.init(), EmailCampaign.init(), ContactRight.init(), SuppressedAddress.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([
        Business.deleteMany({}),
        Lead.deleteMany({}),
        EmailCampaign.deleteMany({}),
        ContactRight.deleteMany({}),
        SuppressedAddress.deleteMany({}),
      ]);
    });

    const makeBusiness = (n: number) => Business.create({ domain: `x${n}.test`, originalUrl: `https://x${n}.test`, businessName: `X${n}` });
    const makeLead = (business: { _id: Types.ObjectId }, tenantId: Types.ObjectId, status: string) =>
      Lead.create({
        businessName: 'X',
        originalUrl: 'https://x.test',
        domain: `x-${new Types.ObjectId().toString()}.test`,
        businessId: business._id,
        tenantId,
        status,
      });
    const makeCampaign = (lead: { _id: Types.ObjectId }, tenantId: Types.ObjectId, status: string, n: number) =>
      EmailCampaign.create({ ...campaignFields(n), leadId: lead._id, tenantId, status });

    it("an opt-out closes every studio's lead and open campaign of the business", async () => {
      const x = await makeBusiness(1);
      const other = await makeBusiness(2);
      const leadA = await makeLead(x, studioA, 'SENT');
      const leadC = await makeLead(x, studioC, 'SCHEDULED');
      const leadD = await makeLead(x, studioD, 'AUDITED');
      const leadOther = await makeLead(other, studioA, 'SCHEDULED');
      const campaignA = await makeCampaign(leadA, studioA, 'DELIVERED', 1);
      const campaignC = await makeCampaign(leadC, studioC, 'SCHEDULED', 2);
      const campaignOther = await makeCampaign(leadOther, studioA, 'SCHEDULED', 3);

      const result = await recordBusinessOptOut({
        businessId: x._id,
        recipientEmail: 'owner@example.com',
        unsubscribableStatuses: statuses,
        now: optOutAt,
      });

      expect(result).toMatchObject({ newlyOptedOut: true, leadsUnsubscribed: 3, campaignsClosed: 1, addressSuppressed: true });
      expect((await Business.findById(x._id).lean())?.optedOutAt).toEqual(optOutAt);
      for (const lead of [leadA, leadC, leadD]) {
        const stored = await Lead.findById(lead._id).lean();
        expect(stored?.status).toBe('UNSUBSCRIBED');
        expect(stored?.tags).toContain('unsubscribed');
      }
      const closed = await EmailCampaign.findById(campaignC._id).lean();
      expect(closed?.status).toBe('UNSUBSCRIBED');
      expect(closed?.unsubscribedAt).toEqual(optOutAt);
      expect((await EmailCampaign.findById(campaignA._id).lean())?.status).toBe('DELIVERED');
      // another business is untouched
      expect((await Lead.findById(leadOther._id).lean())?.status).toBe('SCHEDULED');
      expect((await EmailCampaign.findById(campaignOther._id).lean())?.status).toBe('SCHEDULED');
    });

    it('ends the active right and starts its cooldown at the opt-out', async () => {
      const x = await makeBusiness(1);
      const lead = await makeLead(x, studioA, 'SCHEDULED');
      const granted = await grantContactRight({
        tenantId: studioA,
        businessId: x._id,
        leadId: lead._id,
        source: 'ADD_LEAD',
        durations,
        now: t0,
      });
      expect(granted.granted).toBe(true);

      const result = await recordBusinessOptOut({ businessId: x._id, recipientEmail: 'o@example.com', unsubscribableStatuses: statuses, now: optOutAt });

      expect(result.rightEnded).toBe(true);
      const hold = (await Business.findById(x._id).lean())?.contactHold;
      expect(hold?.expiresAt).toEqual(optOutAt);
      expect(hold?.cooldownUntil).toEqual(new Date(optOutAt.getTime() + 30 * day));
      expect(await findActiveContactRight({ leadId: lead._id }, optOutAt)).toBeNull();
      // the opt-out outlasts the cooldown
      const later = new Date(optOutAt.getTime() + 60 * day);
      expect(await grantContactRight({ tenantId: studioC, businessId: x._id, leadId: new Types.ObjectId(), source: 'ADD_LEAD', durations, now: later })).toEqual({
        granted: false,
        reason: 'opted_out',
      });
    });

    it('stores only the hash of the address', async () => {
      const x = await makeBusiness(1);
      await recordBusinessOptOut({ businessId: x._id, recipientEmail: 'Owner@Example.com ', unsubscribableStatuses: statuses, now: optOutAt });
      const docs = await SuppressedAddress.find({}).lean();
      expect(docs).toHaveLength(1);
      expect(docs[0]?.hash).toBe(hashAddress('owner@example.com'));
      const serialized = JSON.stringify(docs).toLowerCase();
      expect(serialized).not.toContain('owner@example.com');
      expect(serialized).not.toContain('example.com');
    });

    it('a second call changes nothing', async () => {
      const x = await makeBusiness(1);
      const lead = await makeLead(x, studioC, 'SCHEDULED');
      await makeCampaign(lead, studioC, 'SCHEDULED', 1);
      const input = { businessId: x._id, recipientEmail: 'owner@example.com', unsubscribableStatuses: statuses };
      await recordBusinessOptOut({ ...input, now: optOutAt });
      const again = await recordBusinessOptOut({ ...input, now: new Date(optOutAt.getTime() + day) });
      expect(again).toEqual({ newlyOptedOut: false, rightEnded: false, leadsUnsubscribed: 0, campaignsClosed: 0, addressSuppressed: false });
      expect((await Business.findById(x._id).lean())?.optedOutAt).toEqual(optOutAt);
      expect(await SuppressedAddress.countDocuments()).toBe(1);
    });

    it('isAddressSuppressed normalizes the address, and is false without one', async () => {
      const x = await makeBusiness(1);
      await recordBusinessOptOut({ businessId: x._id, recipientEmail: 'owner@example.com', unsubscribableStatuses: statuses, now: optOutAt });
      expect(await isAddressSuppressed(' Owner@Example.COM ')).toBe(true);
      expect(await isAddressSuppressed('other@example.com')).toBe(false);
      expect(await isAddressSuppressed(undefined)).toBe(false);
      expect(await isAddressSuppressed('')).toBe(false);
      expect(await isBusinessOptedOut(x._id)).toBe(true);
      expect(await isBusinessOptedOut(undefined)).toBe(false);
      expect(await isBusinessOptedOut((await makeBusiness(2))._id)).toBe(false);
    });

    it('without a businessId only the address is suppressed', async () => {
      const x = await makeBusiness(1);
      const lead = await makeLead(x, studioA, 'SCHEDULED');
      const result = await recordBusinessOptOut({ recipientEmail: 'legacy@example.com', unsubscribableStatuses: statuses, now: optOutAt });
      expect(result).toEqual({ newlyOptedOut: false, rightEnded: false, leadsUnsubscribed: 0, campaignsClosed: 0, addressSuppressed: true });
      expect(await isAddressSuppressed('legacy@example.com')).toBe(true);
      expect((await Lead.findById(lead._id).lean())?.status).toBe('SCHEDULED');
      expect((await Business.findById(x._id).lean())?.optedOutAt).toBeUndefined();
    });
  });

  describe('lots and platform audits (REV-232)', () => {
    const durations = { rightDays: 14, cooldownDays: 30 };
    const day = 24 * 60 * 60 * 1000;
    const t0 = at('2026-11-01T00:00:00Z');
    const studioA = new Types.ObjectId();
    const price = { amountCents: 5000, currency: 'EUR', need: 0.6, band: 'B' as const, signals: [{ signal: 'siteEra', value: 4, need: 0.6, weight: 1 }] };
    const platform = (domain: string, city = 'Vilnius') =>
      createPlatformAudit({ domain, originalUrl: `https://${domain}`, businessName: 'Lot Co', niche: 'dental', city });
    const derive = (audit: { scores?: { total?: number } }) => ({ set: { totalScore: audit.scores?.total }, clearsEmailGuess: false });
    const addAsStudio = (domain: string, tenantId: Types.ObjectId, now = t0) =>
      addLeadToBusiness({
        tenantId,
        lead: { businessName: 'Lot Co', originalUrl: `https://${domain}`, domain, niche: 'dental', status: 'QUEUED' },
        deriveFromAudit: derive as never,
        contactRight: { durations, source: 'ADD_LEAD', now },
        withdrawLots: { statuses: ['DRAFT', 'OPEN'], now },
      });
    const completedBusiness = async (domain: string) => {
      const { business, audit } = await platform(domain);
      await Audit.updateOne({ _id: audit._id }, { status: 'COMPLETED', 'scores.total': 60 });
      return { business, audit };
    };
    const lotFor = async (domain: string, status?: 'OPEN') => {
      const { business, audit } = await completedBusiness(domain);
      const lot = await createLot({ businessId: business._id, auditId: audit._id, price });
      if (status === 'OPEN') await transitionLot(lot._id, 'OPEN', { allowedFrom: ['DRAFT'] });
      return { business, audit, lot };
    };

    beforeAll(async () => {
      await mongoose.connect(mongo.uri, { dbName: 'revamp-lots-test' });
      await Promise.all([Business.init(), Lead.init(), Audit.init(), ContactRight.init(), SuppressedAddress.init(), Lot.init()]);
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });
    beforeEach(async () => {
      await Promise.all([Business.deleteMany({}), Lead.deleteMany({}), Audit.deleteMany({}), ContactRight.deleteMany({}), SuppressedAddress.deleteMany({}), Lot.deleteMany({})]);
    });

    describe('createPlatformAudit', () => {
      it('creates a business and a QUEUED audit with no leadId', async () => {
        const r = await platform('new.example');
        expect(r.queued).toBe(true);
        expect(r.audit.status).toBe('QUEUED');
        expect(r.audit.leadId).toBeUndefined();
        expect(String(r.audit.businessId)).toBe(String(r.business._id));
        expect(r.business.city).toBe('Vilnius');
        expect(await Audit.countDocuments({ leadId: { $exists: true } })).toBe(0);
      });

      it('a second call returns the same audit and queues nothing', async () => {
        const first = await platform('twice.example');
        const second = await platform('twice.example');
        expect(second.queued).toBe(false);
        expect(String(second.audit._id)).toBe(String(first.audit._id));
        expect(await Audit.countDocuments()).toBe(1);
        expect(await Business.countDocuments()).toBe(1);
      });

      it('returns a COMPLETED audit with queued false', async () => {
        const first = await platform('done.example');
        await Audit.updateOne({ _id: first.audit._id }, { status: 'COMPLETED' });
        const again = await platform('done.example');
        expect(again.queued).toBe(false);
        expect(again.audit.status).toBe('COMPLETED');
        expect(await Audit.countDocuments()).toBe(1);
      });

      it('does not reuse a QUEUED audit of a studio lead, and keeps an existing city', async () => {
        const lead = await addLeadToBusiness({
          tenantId: studioA,
          lead: { businessName: 'Lot Co', originalUrl: 'https://own.example', domain: 'own.example', niche: 'dental', status: 'QUEUED', city: 'Kaunas' },
          deriveFromAudit: derive as never,
        });
        const r = await platform('own.example', 'Vilnius');
        expect(r.queued).toBe(true);
        expect(String(r.audit._id)).not.toBe(String(lead.audit!._id));
        expect((await Business.findById(lead.business._id).lean())?.city).toBe('Kaunas');
        expect(await Audit.countDocuments()).toBe(2);
      });

      it('a QUEUED or PROCESSING audit older than the stale limit is failed and a new one is queued', async () => {
        for (const status of ['QUEUED', 'PROCESSING'] as const) {
          const domain = `stale-${status.toLowerCase()}.example`;
          const first = await platform(domain);
          await Audit.updateOne({ _id: first.audit._id }, { status });
          const later = new Date(Date.now() + PLATFORM_AUDIT_STALE_MS + 60_000);
          const again = await createPlatformAudit({ domain, originalUrl: `https://${domain}`, businessName: 'Lot Co', niche: 'dental', city: 'Vilnius', now: later });
          expect(again.queued).toBe(true);
          expect(String(again.audit._id)).not.toBe(String(first.audit._id));
          expect(again.audit.status).toBe('QUEUED');
          const old = await Audit.findById(first.audit._id).lean();
          expect(old).toMatchObject({ status: 'FAILED', errorMessage: 'The platform audit did not finish in time; a new one was queued' });
        }
      });

      it('a fresh running audit is still returned with queued false', async () => {
        const first = await platform('fresh.example');
        const soon = new Date(Date.now() + PLATFORM_AUDIT_STALE_MS - 60_000);
        const again = await createPlatformAudit({ domain: 'fresh.example', originalUrl: 'https://fresh.example', businessName: 'Lot Co', niche: 'dental', city: 'Vilnius', now: soon });
        expect(again.queued).toBe(false);
        expect(String(again.audit._id)).toBe(String(first.audit._id));
        expect((await Audit.findById(first.audit._id).lean())?.status).toBe('QUEUED');
      });

      it('sets the city on a business that has none', async () => {
        await Business.create({ domain: 'nocity.example', originalUrl: 'https://nocity.example', businessName: 'N' });
        await platform('nocity.example', 'Riga');
        expect((await Business.findOne({ domain: 'nocity.example' }).lean())?.city).toBe('Riga');
      });
    });

    describe('createLot', () => {
      it('creates a DRAFT lot with the price, niche and city', async () => {
        const { lot, business, audit } = await lotFor('lot.example');
        expect(lot.status).toBe('DRAFT');
        expect(lot.priceCents).toBe(5000);
        expect(lot.band).toBe('B');
        expect(lot.city).toBe('Vilnius');
        expect(lot.niche).toBe('dental');
        expect(lot.live).toBe(true);
        expect(String(lot.businessId)).toBe(String(business._id));
        expect(String(lot.auditId)).toBe(String(audit._id));
      });

      it.each([
        ['opted out', { optedOutAt: t0 }],
        ['held', { contactHold: { rightId: new Types.ObjectId(), tenantId: studioA, expiresAt: new Date(t0.getTime() + day), cooldownUntil: new Date(t0.getTime() + 31 * day) } }],
        ['in cooldown', { contactHold: { rightId: new Types.ObjectId(), tenantId: studioA, expiresAt: new Date(t0.getTime() - day), cooldownUntil: new Date(t0.getTime() + day) } }],
      ])('refuses a business that is %s', async (_name, patch) => {
        const { business, audit } = await completedBusiness('refused.example');
        await Business.updateOne({ _id: business._id }, { $set: patch });
        const error = await createLot({ businessId: business._id, auditId: audit._id, price, now: t0 }).catch((e) => e);
        expect(error).toBeInstanceOf(LotError);
        expect(error.code).toBe('LOT_NOT_ELIGIBLE');
        expect(await Lot.countDocuments()).toBe(0);
      });

      it('accepts a business whose cooldown passed', async () => {
        const { business, audit } = await completedBusiness('after.example');
        await Business.updateOne({ _id: business._id }, { $set: { contactHold: { rightId: new Types.ObjectId(), tenantId: studioA, expiresAt: new Date(t0.getTime() - 40 * day), cooldownUntil: new Date(t0.getTime() - day) } } });
        const lot = await createLot({ businessId: business._id, auditId: audit._id, price, now: t0 });
        expect(lot.status).toBe('DRAFT');
      });

      it('refuses a business without a city and a missing business', async () => {
        const business = await Business.create({ domain: 'nocity2.example', originalUrl: 'https://nocity2.example', businessName: 'N' });
        const e1 = await createLot({ businessId: business._id, auditId: new Types.ObjectId(), price }).catch((e) => e);
        expect(e1.code).toBe('LOT_NOT_ELIGIBLE');
        const e2 = await createLot({ businessId: new Types.ObjectId(), auditId: new Types.ObjectId(), price }).catch((e) => e);
        expect(e2.code).toBe('LOT_NOT_ELIGIBLE');
      });

      it('five concurrent creates for one business: one winner, the rest LOT_ALREADY_LIVE', async () => {
        const { business, audit } = await completedBusiness('race.example');
        const results = await Promise.allSettled(
          Array.from({ length: 5 }, () => createLot({ businessId: business._id, auditId: audit._id, price })),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
        expect(rejected).toHaveLength(4);
        for (const r of rejected) expect((r.reason as LotError).code).toBe('LOT_ALREADY_LIVE');
        expect(await Lot.countDocuments({ businessId: business._id })).toBe(1);
      });

      it('createLot racing an add that claims the contact right never leaves a live lot on a held business', async () => {
        const holdsRight = async (businessId: Types.ObjectId) => {
          const b = await Business.findById(businessId).lean();
          return Boolean(b?.contactHold && b.contactHold.cooldownUntil.getTime() > Date.now());
        };
        for (let round = 0; round < 15; round++) {
          const domain = `race-claim-${round}.example`;
          const { business, audit } = await completedBusiness(domain);
          const now = new Date();
          await Promise.allSettled([
            createLot({ businessId: business._id, auditId: audit._id, price, now }),
            addLeadToBusiness({
              tenantId: studioA,
              lead: { businessName: 'Lot Co', originalUrl: `https://${domain}`, domain, niche: 'dental', status: 'QUEUED' },
              deriveFromAudit: derive as never,
              contactRight: { durations, source: 'ADD_LEAD', now },
              withdrawLots: { statuses: ['DRAFT', 'OPEN'], now },
            }),
          ]);
          expect(await holdsRight(business._id), `round ${round}: the add must win the hold`).toBe(true);
          expect(await Lot.countDocuments({ businessId: business._id, live: true }), `round ${round}: live lot on a held business`).toBe(0);
        }
      });

      it('a WITHDRAWN lot does not block a new one', async () => {
        const { business, audit, lot } = await lotFor('again.example');
        await transitionLot(lot._id, 'WITHDRAWN', { allowedFrom: ['DRAFT', 'OPEN', 'RESERVED'], set: { withdrawReason: 'admin' } });
        const next = await createLot({ businessId: business._id, auditId: audit._id, price });
        expect(String(next._id)).not.toBe(String(lot._id));
        expect(await Lot.countDocuments({ businessId: business._id })).toBe(2);
      });
    });

    describe('an opt-out withdraws the lots of the business (REV-232)', () => {
      it('withdraws DRAFT, OPEN and RESERVED lots with reason opted_out and leaves another business alone', async () => {
        const a = await lotFor('optout-a.example');
        const b = await lotFor('optout-b.example', 'OPEN');
        const c = await lotFor('optout-c.example', 'OPEN');
        await Lot.updateOne({ _id: c.lot._id }, { status: 'RESERVED' });
        const other = await lotFor('optout-other.example', 'OPEN');
        const now = at('2026-12-03T00:00:00Z');
        for (const x of [a, b, c]) {
          await recordBusinessOptOut({ businessId: x.business._id, unsubscribableStatuses: ['QUEUED'], withdrawLotStatuses: ['DRAFT', 'OPEN', 'RESERVED'], now });
          const lot = await Lot.findById(x.lot._id).lean();
          expect(lot).toMatchObject({ status: 'WITHDRAWN', withdrawReason: 'opted_out', withdrawnAt: now });
          expect(lot?.live).toBeUndefined();
        }
        const untouched = await Lot.findById(other.lot._id).lean();
        expect(untouched?.status).toBe('OPEN');
        expect(untouched?.live).toBe(true);
      });

      it('without withdrawLotStatuses the lots stay (existing callers)', async () => {
        const a = await lotFor('optout-keep.example', 'OPEN');
        await recordBusinessOptOut({ businessId: a.business._id, unsubscribableStatuses: ['QUEUED'] });
        expect((await Lot.findById(a.lot._id).lean())?.status).toBe('OPEN');
      });
    });

    describe('transitionLot', () => {
      it('DRAFT to OPEN sets releaseAt', async () => {
        const { lot } = await lotFor('open.example');
        const releaseAt = at('2026-12-01T10:00:00Z');
        const opened = await transitionLot(lot._id, 'OPEN', { allowedFrom: ['DRAFT'], set: { releaseAt } });
        expect(opened?.status).toBe('OPEN');
        expect(opened?.releaseAt).toEqual(releaseAt);
        expect(opened?.live).toBe(true);
      });

      it('OPEN to WITHDRAWN unsets live and records the reason', async () => {
        const { lot } = await lotFor('wd.example', 'OPEN');
        const now = at('2026-12-02T00:00:00Z');
        const out = await transitionLot(lot._id, 'WITHDRAWN', { allowedFrom: ['DRAFT', 'OPEN', 'RESERVED'], set: { withdrawReason: 'admin' }, now });
        expect(out?.status).toBe('WITHDRAWN');
        expect(out?.live).toBeUndefined();
        expect(out?.withdrawReason).toBe('admin');
        expect(out?.withdrawnAt).toEqual(now);
      });

      it('a wrong allowedFrom returns null and writes nothing', async () => {
        const { lot } = await lotFor('wrong.example', 'OPEN');
        expect(await transitionLot(lot._id, 'OPEN', { allowedFrom: ['DRAFT'] })).toBeNull();
        expect(await transitionLot(new Types.ObjectId(), 'OPEN', { allowedFrom: ['DRAFT'] })).toBeNull();
        const fresh = await Lot.findById(lot._id).lean();
        expect(fresh?.status).toBe('OPEN');
        expect(fresh?.live).toBe(true);
      });
    });

    describe('addLeadToBusiness withdraws a lot of the business', () => {
      it('an OPEN lot is withdrawn, the lead reuses the platform audit and no audit is added', async () => {
        const { lot, audit } = await lotFor('claim.example', 'OPEN');
        const result = await addAsStudio('claim.example', studioA);
        expect(result.withdrawnLots).toBe(1);
        expect(result.reused).toBe(true);
        expect(result.audit).toBeUndefined();
        expect(String(result.sourceAudit?._id)).toBe(String(audit._id));
        expect(result.lead.status).toBe('AUDITED');
        expect(await Audit.countDocuments()).toBe(1);
        const after = await Lot.findById(lot._id).lean();
        expect(after?.status).toBe('WITHDRAWN');
        expect(after?.withdrawReason).toBe('claimed_by_studio');
        expect(after?.live).toBeUndefined();
        expect(after?.withdrawnAt).toEqual(t0);
      });

      it('a DRAFT lot is withdrawn too', async () => {
        const { lot } = await lotFor('draft.example');
        const result = await addAsStudio('draft.example', studioA);
        expect(result.withdrawnLots).toBe(1);
        expect((await Lot.findById(lot._id).lean())?.status).toBe('WITHDRAWN');
      });

      it('a RESERVED lot is not touched', async () => {
        const { lot } = await lotFor('reserved.example', 'OPEN');
        await Lot.updateOne({ _id: lot._id }, { status: 'RESERVED' });
        const result = await addAsStudio('reserved.example', studioA);
        expect(result.withdrawnLots).toBe(0);
        expect((await Lot.findById(lot._id).lean())?.status).toBe('RESERVED');
      });

      it('a refused right leaves the lot OPEN', async () => {
        const { business, lot } = await lotFor('refused2.example', 'OPEN');
        await Business.updateOne({ _id: business._id }, { $set: { optedOutAt: t0 } });
        const error = await addAsStudio('refused2.example', studioA).catch((e) => e);
        expect(error).toBeInstanceOf(ContactRightRefusedError);
        const after = await Lot.findById(lot._id).lean();
        expect(after?.status).toBe('OPEN');
        expect(after?.live).toBe(true);
        expect(await Lead.countDocuments()).toBe(0);
      });

      it('without withdrawLots the lot stays, and a business without a lot reports 0', async () => {
        const { lot } = await lotFor('keep.example', 'OPEN');
        const result = await addLeadToBusiness({
          tenantId: studioA,
          lead: { businessName: 'Lot Co', originalUrl: 'https://keep.example', domain: 'keep.example', niche: 'dental', status: 'QUEUED' },
          deriveFromAudit: derive as never,
          contactRight: { durations, source: 'ADD_LEAD', now: t0 },
        });
        expect(result.withdrawnLots).toBe(0);
        expect((await Lot.findById(lot._id).lean())?.status).toBe('OPEN');
        const plain = await addAsStudio('nolot.example', studioA);
        expect(plain.withdrawnLots).toBe(0);
      });

      it('an add on the own-audit branch (no completed audit) also withdraws', async () => {
        const { business } = await platform('own2.example');
        // a lot needs a completed audit: make one from another business, then point the lot at this business
        const other = await completedBusiness('other2.example');
        await Lot.create({
          businessId: business._id, auditId: other.audit._id, niche: 'dental', city: 'Vilnius', priceCents: 1500,
          currency: 'EUR', band: 'D', need: 0.1, status: 'OPEN', live: true,
        });
        const result = await addAsStudio('own2.example', studioA);
        expect(result.reused).toBe(false);
        expect(result.withdrawnLots).toBe(1);
      });
    });
  });
});
