import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Business, ContactRight, Lot, Organization, SuppressedAddress, createOrganizationWithOwner, hashAddress } from '@revamp/db';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { signSessionToken } from '../../services/token.js';
import { AnalyticsEvent } from '../../models/AnalyticsEvent.model.js';
import { Audit } from '../../models/Audit.model.js';
import { EmailCampaign } from '../../models/EmailCampaign.model.js';
import { Lead } from '../../models/Lead.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { addAiGenerationJob } from '../../queues/ai.queue.js';
import { addAuditJob } from '../../queues/audit.queue.js';
import { addEmailDispatchJob } from '../../queues/email.queue.js';
import { sendTestEmailJob } from '../../queues/email-test.queue.js';
import { runMvpPageJob } from '../../queues/mvp-page.queue.js';
import { addDiscoveryJob, getDiscoveryJob } from '../../queues/discovery.queue.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';
import { listApiRoutes } from './route-table.js';

// REV-209: the real app on a real MongoDB with two studios. One request per guarded route from the wrong studio must
// answer the endpoint's 404 and change and queue nothing; the same request from the right studio must work. The queues
// are mocked: nothing here reaches Redis, a worker or a provider.
vi.mock('../../queues/audit.queue.js', () => ({ addAuditJob: vi.fn().mockResolvedValue({ id: 'audit-job' }), auditQueue: {} }));
vi.mock('../../queues/ai.queue.js', () => ({ addAiGenerationJob: vi.fn().mockResolvedValue({ id: 'ai-job' }), aiGenerationQueue: {} }));
vi.mock('../../queues/deploy.queue.js', () => ({ deployQueue: {} }));
vi.mock('../../queues/email.queue.js', () => ({
  addEmailDispatchJob: vi.fn().mockResolvedValue({ id: 'email-job' }),
  calculateDispatchDelay: vi.fn().mockReturnValue(1000),
  emailQueue: {},
}));
vi.mock('../../queues/email-test.queue.js', () => ({ sendTestEmailJob: vi.fn() }));
vi.mock('../../queues/mvp-page.queue.js', () => ({
  runMvpPageJob: vi.fn(),
  MVP_PAGE_CHANGE_WAIT_MS: 420_000,
  MVP_PAGE_PUBLISH_WAIT_MS: 120_000,
}));
vi.mock('../../queues/discovery.queue.js', () => ({ addDiscoveryJob: vi.fn(), getDiscoveryJob: vi.fn(), discoveryQueue: {} }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: { status: 'ready', get: vi.fn(), disconnect: vi.fn() } }));

const PREFIX = env.API_PREFIX;

interface Studio {
  tenantId: string;
  token: string;
  leadId: string;
  mvpId: string;
  slug: string;
  auditId: string;
  campaignToken: string;
}

let mongo: MongoMemoryReplSet;
let server: Server;
let routes: string[];
let A: Studio;
let B: Studio;
let emailCounter = 0;

/** A studio with one lead awaiting approval, its audit, MVP and campaign */
async function seedStudio(name: string, extra: { businessId?: Types.ObjectId } = {}): Promise<Studio> {
  const { organization, user } = await createOrganizationWithOwner({
    email: `owner-${++emailCounter}@${name.toLowerCase()}.test`,
    passwordHash: 'x',
    organizationName: name,
  });
  const tenantId = String(organization._id);
  const domain = `${name.toLowerCase()}-site.example`;
  const business = extra.businessId
    ? { _id: extra.businessId }
    : await Business.create({ domain, originalUrl: `https://${domain}`, businessName: name, niche: 'dental' });
  const lead = await Lead.create({
    tenantId: organization._id,
    businessId: business._id,
    businessName: `${name} Clinic`,
    originalUrl: `https://${domain}`,
    domain,
    niche: 'dental',
    contactEmail: `hello@${domain}`,
    status: 'NEEDS_APPROVAL',
  });
  const audit = await Audit.create({ leadId: lead._id, businessId: business._id, status: 'COMPLETED' });
  const slug = `slug-${name.toLowerCase()}-${new Types.ObjectId().toString()}`;
  const mvp = await MvpProject.create({
    tenantId: organization._id,
    leadId: lead._id,
    auditId: audit._id,
    previewSlug: slug,
    fullPreviewUrl: `http://localhost/v/${slug}/index.html`,
    storageHtmlPath: `v/${slug}/index.html`,
  });
  const campaignToken = `token-${name.toLowerCase()}-${new Types.ObjectId().toString()}`;
  await EmailCampaign.create({
    tenantId: organization._id,
    leadId: lead._id,
    mvpProjectId: mvp._id,
    status: 'NEEDS_APPROVAL',
    senderEmail: 'sender@revamp.test',
    recipientEmail: `hello@${domain}`,
    subject: 'Hi',
    bodyHtml: '<p>Hi</p>',
    bodyPlainText: 'Hi',
    trackingToken: campaignToken,
  });
  return {
    tenantId,
    token: signSessionToken({ userId: String(user._id), organizationId: tenantId, role: 'owner' }),
    leadId: String(lead._id),
    mvpId: String(mvp._id),
    slug,
    auditId: String(audit._id),
    campaignToken,
  };
}

const as = (studio: Studio) => {
  const agent = request(server);
  return {
    get: (url: string) => agent.get(`${PREFIX}${url}`).set('Authorization', `Bearer ${studio.token}`),
    post: (url: string) => agent.post(`${PREFIX}${url}`).set('Authorization', `Bearer ${studio.token}`),
    patch: (url: string) => agent.patch(`${PREFIX}${url}`).set('Authorization', `Bearer ${studio.token}`),
  };
};
const anonymous = () => ({
  get: (url: string) => request(server).get(`${PREFIX}${url}`),
  post: (url: string) => request(server).post(`${PREFIX}${url}`),
});

const statusOf = async (id: string) => (await Lead.findById(id).lean())?.status;
const noSideEffects = () => {
  expect(addAuditJob).not.toHaveBeenCalled();
  expect(addAiGenerationJob).not.toHaveBeenCalled();
  expect(addEmailDispatchJob).not.toHaveBeenCalled();
  expect(sendTestEmailJob).not.toHaveBeenCalled();
  expect(runMvpPageJob).not.toHaveBeenCalled();
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongo.getUri('revamp-tenant-isolation-test'));
  await Promise.all([Lead.init(), MvpProject.init(), EmailCampaign.init(), Audit.init(), Business.init(), ContactRight.init(), SuppressedAddress.init()]);
  const app = createApp();
  routes = listApiRoutes(app);
  server = await listenOnLoopback(app);
}, 120_000);

afterAll(async () => {
  await closeServer(server);
  await mongoose.disconnect();
  await mongo.stop();
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await mongoose.connection.dropDatabase();
  A = await seedStudio('Alpha');
  B = await seedStudio('Bravo');
  vi.mocked(addAuditJob).mockResolvedValue({ id: 'audit-job' } as never);
  vi.mocked(addAiGenerationJob).mockResolvedValue({ id: 'ai-job' } as never);
  vi.mocked(addEmailDispatchJob).mockResolvedValue({ id: 'email-job' } as never);
});

describe('a studio sees only its own records (REV-209)', () => {
  it('lists and counts only its own leads', async () => {
    const list = await as(B).get('/leads');
    expect(list.status).toBe(200);
    expect(list.body.data.map((lead: { id: string }) => lead.id)).toEqual([B.leadId]);
    expect(list.body.pagination.total).toBe(1);
    expect((await as(B).get('/leads/stats')).body.data).toMatchObject({ total: 1, byStatus: { NEEDS_APPROVAL: 1 } });
    // Search and filters cannot reach across: A's business name finds nothing for B
    expect((await as(B).get('/leads?search=Alpha')).body.data).toEqual([]);
    expect((await as(A).get('/leads?search=Alpha')).body.data).toHaveLength(1);
  });

  it('lists only its own drafts awaiting approval', async () => {
    const pending = await as(B).get('/outreach/pending');
    expect(pending.body.data.map((lead: { id: string }) => lead.id)).toEqual([B.leadId]);
    expect(pending.body.total).toBe(1);
  });
});

describe('a record of another studio answers 404 and nothing changes (REV-209)', () => {
  const missing = { LEAD: 'LEAD_NOT_FOUND', MVP: 'MVP_NOT_FOUND', AUDIT: 'AUDIT_NOT_FOUND' };

  it('GET /leads/:id', async () => {
    const res = await as(B).get(`/leads/${A.leadId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(missing.LEAD);
    expect((await as(A).get(`/leads/${A.leadId}`)).status).toBe(200);
  });

  it('is the same answer as for an id that does not exist at all', async () => {
    const other = await as(B).get(`/leads/${A.leadId}`);
    const absent = await as(B).get(`/leads/${new Types.ObjectId()}`);
    expect(other.status).toBe(absent.status);
    expect(other.body.error.code).toBe(absent.body.error.code);
  });

  it('POST /audits/trigger queues nothing and creates no audit', async () => {
    await Lead.updateOne({ _id: A.leadId }, { $set: { status: 'AUDIT_FAILED' } });
    const before = await Audit.countDocuments();
    const res = await as(B).post('/audits/trigger').send({ leadId: A.leadId });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(missing.LEAD);
    expect(await Audit.countDocuments()).toBe(before);
    expect(await statusOf(A.leadId)).toBe('AUDIT_FAILED');
    noSideEffects();
    const own = await as(A).post('/audits/trigger').send({ leadId: A.leadId });
    expect(own.status).toBe(202);
    expect(addAuditJob).toHaveBeenCalledTimes(1);
  });

  it("GET /audits/:id by audit id or lead id", async () => {
    for (const id of [A.auditId, A.leadId]) {
      const res = await as(B).get(`/audits/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(missing.AUDIT);
    }
    expect((await as(A).get(`/audits/${A.auditId}`)).status).toBe(200);
    expect((await as(A).get(`/audits/${A.leadId}`)).status).toBe(200);
  });

  it('POST /mvp/generate, whether it names the audit, the lead or both', async () => {
    for (const body of [{ auditId: A.auditId }, { auditId: A.leadId }, { auditId: A.auditId, leadId: A.leadId }]) {
      const res = await as(B).post('/mvp/generate').send(body);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NO_COMPLETED_AUDIT');
    }
    expect(await statusOf(A.leadId)).toBe('NEEDS_APPROVAL');
    noSideEffects();
  });

  it('GET /mvp/:id by project id, lead id or slug', async () => {
    for (const id of [A.mvpId, A.leadId, A.slug]) {
      const res = await as(B).get(`/mvp/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(missing.MVP);
      expect((await as(A).get(`/mvp/${id}`)).status).toBe(200);
    }
  });

  it('POST /mvp/:id/edit, PATCH /mvp/:id/tokens and POST /mvp/:id/versions/:n/restore run no page job', async () => {
    const edit = await as(B).post(`/mvp/${A.mvpId}/edit`).send({ instruction: 'Make the heading bigger' });
    const tokens = await as(B).patch(`/mvp/${A.mvpId}/tokens`).send({ fonts: null });
    const restore = await as(B).post(`/mvp/${A.mvpId}/versions/1/restore`).send({});
    for (const res of [edit, tokens, restore]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(missing.MVP);
    }
    noSideEffects();
  });

  it('POST /outreach/:id/approve queues no email and leaves lead and campaign as they were', async () => {
    const res = await as(B)
      .post(`/outreach/${A.leadId}/approve`)
      .send({ subject: 'Hello', body: 'Hi there', approvedBy: 'mallory' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    expect(await statusOf(A.leadId)).toBe('NEEDS_APPROVAL');
    expect((await EmailCampaign.findOne({ leadId: A.leadId }).lean())?.status).toBe('NEEDS_APPROVAL');
    noSideEffects();
  });

  it('POST /outreach/:id/reject', async () => {
    const res = await as(B).post(`/outreach/${A.leadId}/reject`).send({ reason: 'not for you' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    expect(await statusOf(A.leadId)).toBe('NEEDS_APPROVAL');
    expect((await EmailCampaign.findOne({ leadId: A.leadId }).lean())?.status).toBe('NEEDS_APPROVAL');
    const own = await as(A).post(`/outreach/${A.leadId}/reject`).send({ reason: 'no thanks' });
    expect(own.status).toBe(200);
    expect(await statusOf(A.leadId)).toBe('REJECTED');
    expect(await statusOf(B.leadId)).toBe('NEEDS_APPROVAL');
  });

  it("GET /outreach/:id/outbox never shows another studio's email (REV-221)", async () => {
    await EmailCampaign.updateOne(
      { leadId: A.leadId },
      {
        $set: {
          status: 'DELIVERED',
          deliveryMode: 'SIMULATED',
          sentAt: new Date(),
          outbox: { from: '"Alpha" <a@alpha.test>', to: 'x@y.test', subject: 'S', html: '<p>secret</p>', text: 'secret', headers: {} },
        },
      },
    );
    const res = await as(B).get(`/outreach/${A.leadId}/outbox`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const own = await as(A).get(`/outreach/${A.leadId}/outbox`);
    expect(own.status).toBe(200);
    expect(own.body.data.html).toBe('<p>secret</p>');
    // B's own lead has no outbox yet
    expect((await as(B).get(`/outreach/${B.leadId}/outbox`)).body.error.code).toBe('OUTBOX_NOT_FOUND');
  });

  it("GET /outreach/sender never shows another studio's sender (REV-221)", async () => {
    await Organization.updateOne({ _id: A.tenantId }, { $set: { sender: { name: 'Alpha', address: 'a@alpha.test' } } });
    expect((await as(B).get('/outreach/sender')).body.data).toEqual({ configured: false });
    expect((await as(A).get('/outreach/sender')).body.data).toEqual({ configured: true, name: 'Alpha', address: 'a@alpha.test' });
  });

  it('POST /outreach/:id/test sends nothing', async () => {
    const res = await as(B).post(`/outreach/${A.leadId}/test`).send({ testEmail: 'me@revamp.test', subject: 'S', body: 'B' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    noSideEffects();
  });

  describe('discovery searches belong to the studio that started them', () => {
    const job = (tenantId?: string) => ({
      id: 'disc-1',
      data: { provider: 'osm', niche: 'dental', location: 'Gdansk', limit: 5, ...(tenantId ? { tenantId } : {}) },
      returnvalue: { found: 0, candidates: [] },
      attemptsMade: 1,
      timestamp: Date.now(),
      getState: vi.fn().mockResolvedValue('completed'),
    });

    it('status and import answer DISCOVERY_JOB_NOT_FOUND to another studio, and to a search with no owner', async () => {
      for (const owner of [A.tenantId, undefined]) {
        vi.mocked(getDiscoveryJob).mockResolvedValue(job(owner) as never);
        const status = await as(B).get('/discovery/disc-1');
        const imported = await as(B).post('/discovery/disc-1/import').send({ externalIds: ['osm:node/1'] });
        for (const res of [status, imported]) {
          expect(res.status).toBe(404);
          expect(res.body.error.code).toBe('DISCOVERY_JOB_NOT_FOUND');
        }
      }
      vi.mocked(getDiscoveryJob).mockResolvedValue(job(A.tenantId) as never);
      const own = await as(A).get('/discovery/disc-1');
      expect(own.status).toBe(200);
      // The owner is not echoed back
      expect(own.body.data.params).not.toHaveProperty('tenantId');
    });

    it("starting a search records the caller's studio on the job", async () => {
      vi.mocked(addDiscoveryJob).mockResolvedValue({ id: 'disc-2', data: {} } as never);
      const res = await as(B).post('/discovery').send({ provider: 'osm', niche: 'dental', location: 'Gdansk', limit: 5 });
      expect(res.status).toBe(202);
      expect(vi.mocked(addDiscoveryJob).mock.calls[0]![0]).toMatchObject({ tenantId: B.tenantId });
    });
  });
});

describe('adding a lead claims the contact right or is refused (REV-225)', () => {
  const body = { businessName: 'Bravo Dental', originalUrl: 'https://shared.example', niche: 'dental' };

  it('studio B adding the site studio A holds gets CONTACT_RIGHT_HELD with the expiry and no hint of A; no lead, no job', async () => {
    const first = await as(A).post('/leads').send({ ...body, businessName: 'Alpha Dental' });
    expect(first.status).toBe(201);
    const right = await ContactRight.findOne({ tenantId: A.tenantId }).lean();
    expect(first.body.data.contactRight.expiresAt).toBe(right!.expiresAt.toISOString());
    vi.mocked(addAuditJob).mockClear();

    const res = await as(B).post('/leads').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONTACT_RIGHT_HELD');
    expect(res.body.error.details).toEqual({ expiresAt: right!.expiresAt.toISOString() });
    const text = JSON.stringify(res.body);
    for (const secret of [A.tenantId, A.leadId, 'Alpha']) expect(text).not.toContain(secret);
    expect(await Lead.countDocuments({ tenantId: B.tenantId, domain: 'shared.example' })).toBe(0);
    expect(addAuditJob).not.toHaveBeenCalled();
    expect(addAiGenerationJob).not.toHaveBeenCalled();
  });

  it('the cooldown and the opt-out each answer their own code with the date where there is one', async () => {
    expect((await as(A).post('/leads').send(body)).status).toBe(201);
    const business = await Business.findOne({ domain: 'shared.example' }).lean();
    const hold = business!.contactHold!;
    // The right has ended; the cooldown runs on
    await Business.updateOne({ _id: business!._id }, { $set: { 'contactHold.expiresAt': new Date(Date.now() - 1000) } });
    const cooldown = await as(B).post('/leads').send(body);
    expect(cooldown.status).toBe(409);
    expect(cooldown.body.error.code).toBe('BUSINESS_IN_COOLDOWN');
    expect(cooldown.body.error.details).toEqual({ availableAt: hold.cooldownUntil.toISOString() });

    await Business.updateOne({ _id: business!._id }, { $set: { optedOutAt: new Date() } });
    const optedOut = await as(B).post('/leads').send(body);
    expect(optedOut.status).toBe(409);
    expect(optedOut.body.error.code).toBe('BUSINESS_OPTED_OUT');
    expect(optedOut.body.error.details).toBeUndefined();
    expect(await Lead.countDocuments({ tenantId: B.tenantId, domain: 'shared.example' })).toBe(0);
  });

  it('a suppressed contact email refuses a brand-new site and leaves no business behind', async () => {
    await SuppressedAddress.create({ hash: hashAddress('stop@fresh-site.example') });
    const res = await as(B).post('/leads').send({ ...body, originalUrl: 'https://fresh-site.example', contactEmail: 'stop@fresh-site.example' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUSINESS_OPTED_OUT');
    expect(await Business.countDocuments({ domain: 'fresh-site.example' })).toBe(0);
  });
});

describe('approving outreach needs the studio\'s active contact right (REV-226)', () => {
  const draft = { subject: 'Hello', body: 'Hi there', approvedBy: 'owner' };
  const day = 24 * 60 * 60 * 1000;

  async function grant(studio: Studio, offsets: { grantedDaysAgo: number; expiresInDays: number }) {
    const lead = await Lead.findById(studio.leadId).lean();
    const now = Date.now();
    await ContactRight.create({
      tenantId: new Types.ObjectId(studio.tenantId),
      businessId: lead!.businessId,
      leadId: lead!._id,
      source: 'ADD_LEAD',
      grantedAt: new Date(now - offsets.grantedDaysAgo * day),
      expiresAt: new Date(now + offsets.expiresInDays * day),
      cooldownUntil: new Date(now + (offsets.expiresInDays + 30) * day),
    });
  }
  const withSender = (studio: Studio) =>
    Organization.updateOne({ _id: studio.tenantId }, { $set: { sender: { name: 'Studio', address: `studio-${studio.tenantId}@studio.test` } } });

  beforeEach(async () => {
    await Promise.all([withSender(A), withSender(B)]);
  });

  it('approves with an active right and queues the send', async () => {
    await grant(A, { grantedDaysAgo: 1, expiresInDays: 30 });
    const res = await as(A).post(`/outreach/${A.leadId}/approve`).send(draft);
    expect(res.status).toBe(200);
    expect(await statusOf(A.leadId)).toBe('SCHEDULED');
    expect(addEmailDispatchJob).toHaveBeenCalledTimes(1);
  });

  it('refuses with CONTACT_RIGHT_REQUIRED and the expiry date once the right has expired', async () => {
    await grant(A, { grantedDaysAgo: 60, expiresInDays: -1 });
    const res = await as(A).post(`/outreach/${A.leadId}/approve`).send(draft);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONTACT_RIGHT_REQUIRED');
    expect(typeof res.body.error.details.expiredAt).toBe('string');
    expect(await statusOf(A.leadId)).toBe('NEEDS_APPROVAL');
    expect((await EmailCampaign.findOne({ leadId: A.leadId }).lean())?.status).toBe('NEEDS_APPROVAL');
    noSideEffects();
  });

  it('refuses a lead whose business the studio never held, without details', async () => {
    const res = await as(A).post(`/outreach/${A.leadId}/approve`).send(draft);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONTACT_RIGHT_REQUIRED');
    expect(res.body.error.details).toBeUndefined();
    noSideEffects();
  });

  it('a studio without the right cannot approve its conflicting lead, while the holder can', async () => {
    await grant(A, { grantedDaysAgo: 1, expiresInDays: 30 });
    const aLead = await Lead.findById(A.leadId).lean();
    const C = await seedStudio('Charlie', { businessId: aLead!.businessId! });
    await withSender(C);
    const refused = await as(C).post(`/outreach/${C.leadId}/approve`).send(draft);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CONTACT_RIGHT_REQUIRED');
    expect(await statusOf(C.leadId)).toBe('NEEDS_APPROVAL');
    noSideEffects();
    const ok = await as(A).post(`/outreach/${A.leadId}/approve`).send(draft);
    expect(ok.status).toBe(200);
  });
});

describe('an opt-out blocks every studio (REV-227)', () => {
  const draft = { subject: 'Hello', body: 'Hi there', approvedBy: 'owner' };
  const withSender = (studio: Studio) =>
    Organization.updateOne({ _id: studio.tenantId }, { $set: { sender: { name: 'Studio', address: `studio-${studio.tenantId}@studio.test` } } });

  /** C's lead of A's business is SCHEDULED with an open campaign; A's was sent */
  async function businessWithTwoStudios() {
    const aLead = await Lead.findById(A.leadId).lean();
    const C = await seedStudio('Charlie', { businessId: aLead!.businessId as Types.ObjectId });
    await Lead.updateOne({ _id: A.leadId }, { $set: { status: 'SENT' } });
    await Lead.updateOne({ _id: C.leadId }, { $set: { status: 'SCHEDULED' } });
    await EmailCampaign.updateOne({ leadId: A.leadId }, { $set: { status: 'DELIVERED' } });
    await EmailCampaign.updateOne({ leadId: C.leadId }, { $set: { status: 'SCHEDULED' } });
    return { C, businessId: aLead!.businessId as Types.ObjectId };
  }

  it("an unsubscribe from studio A's email closes studio C's lead of the same business", async () => {
    const { C, businessId } = await businessWithTwoStudios();
    // The body of the answer is what it was before the opt-out reached other studios
    const res = await anonymous().post(`/track/unsubscribe/${A.campaignToken}`);
    expect(res.status).toBe(200);
    expect(await statusOf(A.leadId)).toBe('UNSUBSCRIBED');
    expect(await statusOf(C.leadId)).toBe('UNSUBSCRIBED');
    expect((await EmailCampaign.findOne({ leadId: C.leadId }).lean())?.status).toBe('UNSUBSCRIBED');
    expect((await Business.findById(businessId).lean())?.optedOutAt).toBeInstanceOf(Date);
    // Nothing of studio C reaches the response
    expect(JSON.stringify(res.body) + res.text).not.toContain(C.leadId);
    // Another business is untouched
    expect(await statusOf(B.leadId)).toBe('NEEDS_APPROVAL');
  });

  it('the suppression list holds only hashes', async () => {
    await businessWithTwoStudios();
    await anonymous().post(`/track/unsubscribe/${A.campaignToken}`).expect(200);
    const docs = await SuppressedAddress.find({}).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.hash).toBe(hashAddress('hello@alpha-site.example'));
    expect(JSON.stringify(docs)).not.toContain('alpha-site');
  });

  it('a repeated unsubscribe completes an interrupted opt-out and answers the same', async () => {
    const { C, businessId } = await businessWithTwoStudios();
    // The first call wrote A's campaign and then crashed: nothing else was written
    await EmailCampaign.updateOne({ leadId: A.leadId }, { $set: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() } });
    const first = await anonymous().post(`/track/unsubscribe/${A.campaignToken}`);
    expect(first.status).toBe(200);
    expect(await statusOf(C.leadId)).toBe('UNSUBSCRIBED');
    expect((await Business.findById(businessId).lean())?.optedOutAt).toBeInstanceOf(Date);
    const optedOutAt = (await Business.findById(businessId).lean())?.optedOutAt;

    const again = await anonymous().post(`/track/unsubscribe/${A.campaignToken}`);
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    expect(again.text).toBe(first.text);
    expect((await Business.findById(businessId).lean())?.optedOutAt).toEqual(optedOutAt);
    expect(await SuppressedAddress.countDocuments()).toBe(1);
  });

  it("the opted-out address under another studio's business is refused at approval, whatever its case", async () => {
    await withSender(B);
    await businessWithTwoStudios();
    await anonymous().post(`/track/unsubscribe/${A.campaignToken}`).expect(200);
    // B's business is a different one whose contact is the address that opted out, written differently
    await Lead.updateOne({ _id: B.leadId }, { $set: { contactEmail: ' Hello@Alpha-Site.example ' } });
    const res = await as(B).post(`/outreach/${B.leadId}/approve`).send(draft);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUSINESS_OPTED_OUT');
    expect(await statusOf(B.leadId)).toBe('NEEDS_APPROVAL');
    noSideEffects();
  });

  it('approval of a lead of an opted-out business answers BUSINESS_OPTED_OUT before the right check', async () => {
    await withSender(B);
    await Business.updateOne({ _id: (await Lead.findById(B.leadId).lean())!.businessId }, { $set: { optedOutAt: new Date() } });
    const res = await as(B).post(`/outreach/${B.leadId}/approve`).send(draft);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUSINESS_OPTED_OUT');
    noSideEffects();
  });
});

describe('audits are shared between studios and reached through leads (REV-209)', () => {
  it('a studio that has its own lead for the same business reads that business\'s audit; a third studio does not', async () => {
    const alpha = await Lead.findById(A.leadId).lean();
    const C = await seedStudio('Charlie', { businessId: alpha!.businessId as Types.ObjectId });
    // C's lead reuses A's business, so A's completed audit is readable by C's lead
    expect((await as(C).get(`/audits/${A.auditId}`)).status).toBe(200);
    // B has a different business: A's audit is not its to read
    expect((await as(B).get(`/audits/${A.auditId}`)).status).toBe(404);
  });
});

describe('a platform audit is read only through a lead of its business (REV-232)', () => {
  it('a studio with a lead of the business reads it; a studio without one gets 404, not every lead of its own', async () => {
    const alpha = await Lead.findById(A.leadId).lean();
    // No leadId: the shared-audit lookup must not put `{ _id: undefined }` in its $or, which Mongoose drops and which then matches every lead
    const platform = await Audit.create({ businessId: alpha!.businessId, status: 'COMPLETED' });
    expect(platform.leadId).toBeUndefined();
    expect((await as(A).get(`/audits/${platform._id}`)).status).toBe(200);
    const denied = await as(B).get(`/audits/${platform._id}`);
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('AUDIT_NOT_FOUND');
  });
});

describe('a studio adding a business that has a lot wins (REV-232)', () => {
  const body = { businessName: 'Lot Dental', originalUrl: 'https://lot-site.example', niche: 'dental' };
  const makeLot = async (status: 'DRAFT' | 'OPEN' | 'RESERVED') => {
    const business = await Business.create({ domain: 'lot-site.example', originalUrl: 'https://lot-site.example', businessName: 'Lot Dental', niche: 'dental', city: 'Vilnius' });
    const audit = await Audit.create({ businessId: business._id, status: 'COMPLETED', scores: { total: 40, standards: 0 } });
    const lot = await Lot.create({ businessId: business._id, auditId: audit._id, niche: 'dental', city: 'Vilnius', priceCents: 5000, currency: 'EUR', band: 'B', need: 0.6, status, live: true });
    return { business, audit, lot };
  };

  it.each(['DRAFT', 'OPEN'] as const)('the add answers 201 as for any business, withdraws the %s lot and reuses the platform audit', async (status) => {
    const { lot, audit } = await makeLot(status);
    const res = await as(B).post('/leads').send(body);
    expect(res.status).toBe(201);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(String(lot._id));
    expect(Object.keys(res.body.data).join()).not.toMatch(/lot/i);
    expect(text).not.toMatch(/claimed_by_studio|WITHDRAWN/);
    const after = await Lot.findById(lot._id).lean();
    expect(after).toMatchObject({ status: 'WITHDRAWN', withdrawReason: 'claimed_by_studio' });
    expect(after?.live).toBeUndefined();
    expect(String((await Lead.findOne({ tenantId: B.tenantId, domain: 'lot-site.example' }).lean())?.status)).toBe('AUDITED');
    expect(await Audit.countDocuments({ businessId: audit.businessId })).toBe(1);
    expect(addAuditJob).not.toHaveBeenCalled();
  });

  it('a RESERVED lot is left alone', async () => {
    const { lot } = await makeLot('RESERVED');
    expect((await as(B).post('/leads').send(body)).status).toBe(201);
    expect((await Lot.findById(lot._id).lean())?.status).toBe('RESERVED');
  });

  it('a refused add (the business is held by another studio) leaves the lot OPEN', async () => {
    const { business, lot } = await makeLot('OPEN');
    await Lot.updateOne({ _id: lot._id }, { status: 'OPEN' });
    await Business.updateOne({ _id: business._id }, { $set: { optedOutAt: new Date() } });
    const res = await as(B).post('/leads').send(body);
    expect(res.status).toBe(409);
    expect((await Lot.findById(lot._id).lean())?.status).toBe('OPEN');
  });
});

describe('public routes take the studio from their secret (REV-209)', () => {
  const setStatus = (status: string) => Lead.updateMany({ _id: { $in: [A.leadId, B.leadId] } }, { $set: { status } });

  // Both studios' leads are in a state the recipient's click or visit could move: an attack that is not scoped would
  // change the other studio's lead, and these tests would see it
  beforeEach(() => setStatus('SENT'));

  it("an open moves only the campaign's own lead and stamps the event with its studio", async () => {
    const res = await anonymous().get(`/track/open/${A.campaignToken}.gif`);
    expect(res.status).toBe(200);
    expect(await statusOf(A.leadId)).toBe('OPENED');
    expect(await statusOf(B.leadId)).toBe('SENT');
    const event = await AnalyticsEvent.findOne({ trackingToken: A.campaignToken }).lean();
    expect(String(event?.tenantId)).toBe(A.tenantId);
    expect(String(event?.leadId)).toBe(A.leadId);
  });

  it("a click resolves the MVP of the campaign, never another studio's", async () => {
    const res = await anonymous().get(`/track/click/${A.campaignToken}`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(A.slug);
    expect(res.headers['location']).not.toContain(B.slug);
    expect(await statusOf(A.leadId)).toBe('CLICKED');
    expect(await statusOf(B.leadId)).toBe('SENT');
  });

  it("a forged lead id in an event never reaches another studio's lead", async () => {
    await setStatus('OPENED');
    // With A's token and B's lead id: the event is A's, B's lead is not touched
    await anonymous().post('/track/mvp-event').send({ token: A.campaignToken, leadId: B.leadId, eventType: 'cta_click' }).expect(200);
    expect(await statusOf(B.leadId)).toBe('OPENED');
    expect(await statusOf(A.leadId)).toBe('ENGAGED');
    // With A's MVP id and B's lead id, and no token
    await setStatus('OPENED');
    await anonymous().post('/track/mvp-event').send({ mvpProjectId: A.mvpId, leadId: B.leadId, eventType: 'cta_click' }).expect(200);
    expect(await statusOf(B.leadId)).toBe('OPENED');
    expect(await statusOf(A.leadId)).toBe('ENGAGED');
    // With B's lead id and nothing that names a studio: nothing moves and the event names no lead
    await anonymous().post('/track/mvp-event').send({ leadId: B.leadId, eventType: 'cta_click' }).expect(200);
    expect(await statusOf(B.leadId)).toBe('OPENED');
    expect(await AnalyticsEvent.countDocuments({ leadId: new Types.ObjectId(B.leadId) })).toBe(0);
    const events = await AnalyticsEvent.find({ eventType: 'cta_click' }).lean();
    expect(events.filter((e) => e.tenantId).every((e) => String(e.tenantId) === A.tenantId)).toBe(true);
  });

  it("an unsubscribe opts out only the campaign's own lead", async () => {
    const page = await anonymous().get(`/track/unsubscribe/${A.campaignToken}`);
    expect(page.status).toBe(200);
    expect(await statusOf(A.leadId)).toBe('SENT');
    expect((await anonymous().post(`/track/unsubscribe/${A.campaignToken}`)).status).toBe(200);
    expect(await statusOf(A.leadId)).toBe('UNSUBSCRIBED');
    expect(await statusOf(B.leadId)).toBe('SENT');
    expect((await EmailCampaign.findOne({ leadId: B.leadId }).lean())?.status).toBe('NEEDS_APPROVAL');
    expect((await anonymous().post('/track/unsubscribe/no-such-token')).status).toBe(404);
  });

  it('the preview redirects by slug without a session', async () => {
    const res = await anonymous().get(`/mvp/preview/${A.slug}`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(A.slug);
  });
});

describe('records without a studio (before the migration) stay out of every studio (REV-209)', () => {
  it('are invisible to signed-in studios and reachable only through their public secret', async () => {
    const legacy = await Lead.collection.insertOne({
      businessName: 'Legacy Clinic',
      originalUrl: 'https://legacy.example',
      domain: 'legacy.example',
      niche: 'dental',
      status: 'SENT',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await EmailCampaign.collection.insertOne({
      leadId: legacy.insertedId,
      status: 'DELIVERED',
      trackingToken: 'legacy-token',
      senderEmail: 'a@b.test',
      recipientEmail: 'c@d.test',
      subject: 's',
      bodyHtml: 'b',
      bodyPlainText: 'b',
    });
    for (const studio of [A, B]) {
      expect((await as(studio).get('/leads')).body.data.map((l: { id: string }) => l.id)).not.toContain(String(legacy.insertedId));
      expect((await as(studio).get(`/leads/${legacy.insertedId}`)).status).toBe(404);
    }
    // The recipient's link still works: the lead moves, in its own (legacy) bucket
    expect((await anonymous().get('/track/open/legacy-token.gif')).status).toBe(200);
    expect((await Lead.findById(legacy.insertedId).lean())?.status).toBe('OPENED');
    expect(await AnalyticsEvent.countDocuments({ trackingToken: 'legacy-token', tenantId: { $exists: false } })).toBe(1);
  });
});

/**
 * Every route of the API is classified here. A route added without a place in one of these lists fails the last test,
 * so nobody ships a route that reads tenant-owned data without deciding how it is scoped (REV-209).
 */
const TENANT_OWNED = [
  // Covered above: each is requested from the wrong studio and from the right one
  'GET /leads',
  'POST /leads',
  'GET /leads/stats',
  'GET /leads/:id',
  'POST /audits/trigger',
  'GET /audits/:id',
  'POST /mvp/generate',
  'GET /mvp/:id',
  'POST /mvp/:id/edit',
  'PATCH /mvp/:id/tokens',
  'POST /mvp/:id/versions/:n/restore',
  'GET /outreach/pending',
  'POST /outreach/:id/approve',
  'POST /outreach/:id/reject',
  'POST /outreach/:id/test',
  'GET /outreach/:id/outbox',
  'POST /discovery',
  'GET /discovery/:jobId',
  'POST /discovery/:jobId/import',
];
const PUBLIC_BY_SECRET = [
  'GET /track/open/:token.gif',
  'GET /track/open/:token',
  'GET /track/click/:token',
  'POST /track/mvp-event',
  'GET /track/unsubscribe/:token',
  'POST /track/unsubscribe/:token',
  'GET /mvp/preview/:slug',
];
/** Touch no tenant-owned record: sessions, members, invitations, static files and provider lookups */
const NO_TENANT_DATA = [
  'GET /health',
  'POST /auth/register',
  'POST /auth/login',
  'GET /auth/me',
  'GET /invitations/:token',
  'POST /invitations/:token/join',
  'POST /invitations/:token/accept',
  'GET /track/revamp-tracker.js',
  'GET /mvp/providers',
  'GET /discovery/reverse-geocode',
  // REV-221: reads the caller's own organization, never a tenant-owned record
  'GET /outreach/sender',
  // REV-232: platform-owned lots and audits; admin only (`PLATFORM_ADMIN_EMAILS`), never a studio's records
  'POST /admin/platform-audits',
  'GET /admin/platform-audits/:id',
  'POST /admin/lots',
  'GET /admin/lots',
  'POST /admin/lots/:id/open',
  'POST /admin/lots/:id/withdraw',
];

describe('every route is classified (REV-209)', () => {
  it('has no route outside the three lists, and no listed route that does not exist', () => {
    const classified = [...TENANT_OWNED, ...PUBLIC_BY_SECRET, ...NO_TENANT_DATA];
    const unclassified = routes.filter((route) => !classified.includes(route) && !route.startsWith('GET /organization') && !route.includes('/organization/'));
    expect(unclassified, 'Classify these routes: how do they scope tenant-owned data?').toEqual([]);
    const gone = classified.filter((route) => !routes.includes(route));
    expect(gone).toEqual([]);
  });
});

describe('leads carry only the studio\'s own contact right (REV-228)', () => {
  const day = 24 * 60 * 60 * 1000;

  it('the holder sees its right on the list and the detail; a studio on the same business sees none', async () => {
    const aLead = await Lead.findById(A.leadId).lean();
    const now = Date.now();
    await ContactRight.create({
      tenantId: new Types.ObjectId(A.tenantId),
      businessId: aLead!.businessId,
      leadId: aLead!._id,
      source: 'ADD_LEAD',
      grantedAt: new Date(now - day),
      expiresAt: new Date(now + 10 * day),
      cooldownUntil: new Date(now + 40 * day),
    });
    const C = await seedStudio('Charlie', { businessId: aLead!.businessId! });

    const aList = await as(A).get('/leads');
    expect(aList.body.data).toHaveLength(1);
    expect(aList.body.data[0].contactRight).toMatchObject({ active: true });
    const aDetail = await as(A).get(`/leads/${A.leadId}`);
    expect(aDetail.body.data.lead.contactRight).toMatchObject({ active: true });

    const cList = await as(C).get('/leads');
    expect(cList.body.data[0].contactRight).toBeNull();
    const cDetail = await as(C).get(`/leads/${C.leadId}`);
    expect(cDetail.body.data.lead.contactRight).toBeNull();
    expect(JSON.stringify(cList.body)).not.toContain(A.tenantId);

    // B holds nothing and has its own business
    expect((await as(B).get('/leads')).body.data[0].contactRight).toBeNull();
  });
});
