import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Business, Lot, createOrganizationWithOwner } from '@revamp/db';
import { priceFromAudit } from '@revamp/validation';

// REV-232 review focus 5: the list is read from the environment once, so it is set before the app loads. Case and
// surrounding spaces must not matter.
vi.hoisted(() => {
  process.env['PLATFORM_ADMIN_EMAILS'] = ' Admin@Platform.test , other-admin@platform.test ';
});

import { createApp } from '../../app.js';
import { env, lotPriceSettings } from '../../config/env.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { addPlatformAuditJob } from '../../queues/audit.queue.js';
import { signSessionToken } from '../../services/token.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';

vi.mock('../../queues/audit.queue.js', () => ({ addAuditJob: vi.fn(), addPlatformAuditJob: vi.fn(), auditQueue: {} }));
vi.mock('../../queues/ai.queue.js', () => ({ addAiGenerationJob: vi.fn(), aiGenerationQueue: {} }));
vi.mock('../../queues/deploy.queue.js', () => ({ deployQueue: {} }));
vi.mock('../../queues/email.queue.js', () => ({ addEmailDispatchJob: vi.fn(), calculateDispatchDelay: vi.fn(), emailQueue: {} }));
vi.mock('../../queues/email-test.queue.js', () => ({ sendTestEmailJob: vi.fn() }));
vi.mock('../../queues/mvp-page.queue.js', () => ({ runMvpPageJob: vi.fn(), MVP_PAGE_CHANGE_WAIT_MS: 1, MVP_PAGE_PUBLISH_WAIT_MS: 1 }));
vi.mock('../../queues/discovery.queue.js', () => ({ addDiscoveryJob: vi.fn(), getDiscoveryJob: vi.fn(), discoveryQueue: {} }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: { status: 'ready', get: vi.fn(), disconnect: vi.fn() } }));

const PREFIX = env.API_PREFIX;
let mongo: MongoMemoryReplSet;
let server: Server;
let admin: { token: string };
let owner: { token: string };
let n = 0;

async function account(email: string, name: string) {
  const { organization, user } = await createOrganizationWithOwner({ email, passwordHash: 'x', organizationName: name });
  return { token: signSessionToken({ userId: String(user._id), organizationId: String(organization._id), role: 'owner' }) };
}
const as = (who: { token: string }) => ({
  get: (url: string) => request(server).get(`${PREFIX}${url}`).set('Authorization', `Bearer ${who.token}`),
  post: (url: string) => request(server).post(`${PREFIX}${url}`).set('Authorization', `Bearer ${who.token}`),
});

const auditBody = { url: 'https://Example-Admin.test/home', businessName: 'Example', niche: 'dental', city: 'Vilnius' };
const WORST = { scores: { standards: 0 }, webVitals: { lcp: 6000 } };

async function completedBusiness(domain: string, audit: Record<string, unknown> = WORST) {
  const business = await Business.create({ domain, originalUrl: `https://${domain}`, businessName: 'B', niche: 'dental', city: 'Vilnius' });
  const completed = await Audit.create({ businessId: business._id, status: 'COMPLETED', ...audit });
  return { business, audit: completed };
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongo.getUri('revamp-admin-routes-test'));
  await Promise.all([Audit.init(), Business.init(), Lot.init(), Lead.init()]);
  server = await listenOnLoopback(createApp());
}, 120_000);

afterAll(async () => {
  await closeServer(server);
  await mongoose.disconnect();
  await mongo.stop();
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await mongoose.connection.dropDatabase();
  await Promise.all([Audit.init(), Business.init(), Lot.init(), Lead.init()]);
  admin = await account('admin@platform.test', 'Platform');
  owner = await account(`owner-${++n}@studio.test`, 'Studio');
  vi.mocked(addPlatformAuditJob).mockResolvedValue({ id: 'platform-job' } as never);
});

describe('PLATFORM_ADMIN_EMAILS gates /admin (REV-232)', () => {
  it('lets a listed email through whatever its case and the spaces in the list', async () => {
    expect((await as(admin).get('/admin/lots')).status).toBe(200);
  });

  it('refuses a studio owner who is not listed with 403 FORBIDDEN, and a missing token with 401', async () => {
    const res = await as(owner).get('/admin/lots');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await as(owner).post('/admin/platform-audits').send(auditBody)).status).toBe(403);
    expect((await request(server).get(`${PREFIX}/admin/lots`)).status).toBe(401);
    expect(addPlatformAuditJob).not.toHaveBeenCalled();
  });

  it('GET /auth/me says who is a platform admin', async () => {
    expect((await as(admin).get('/auth/me')).body.data.platformAdmin).toBe(true);
    expect((await as(owner).get('/auth/me')).body.data.platformAdmin).toBe(false);
  });
});

describe('POST /admin/platform-audits', () => {
  it('creates the business and a QUEUED audit with no leadId and queues one platform job', async () => {
    const res = await as(admin).post('/admin/platform-audits').send(auditBody);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'QUEUED', queued: true });
    const audit = await Audit.findById(res.body.data.auditId).lean();
    expect(audit?.leadId).toBeUndefined();
    expect(String(audit?.businessId)).toBe(res.body.data.businessId);
    const business = await Business.findById(res.body.data.businessId).lean();
    expect(business).toMatchObject({ domain: 'example-admin.test', city: 'Vilnius', niche: 'dental' });
    expect(addPlatformAuditJob).toHaveBeenCalledTimes(1);
    expect(addPlatformAuditJob).toHaveBeenCalledWith({
      auditId: res.body.data.auditId,
      businessId: res.body.data.businessId,
      url: 'https://Example-Admin.test/home',
      niche: 'dental',
    });
    expect(await Lead.countDocuments()).toBe(0);
  });

  it('a second request finds the waiting audit: 200, queued false, no second job', async () => {
    const first = await as(admin).post('/admin/platform-audits').send(auditBody);
    const second = await as(admin).post('/admin/platform-audits').send({ ...auditBody, url: 'https://www.example-admin.test/' });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ queued: false, auditId: first.body.data.auditId });
    expect(addPlatformAuditJob).toHaveBeenCalledTimes(1);
    expect(await Audit.countDocuments()).toBe(1);
  });

  it('marks the audit FAILED and answers 503 when the queue is down', async () => {
    vi.mocked(addPlatformAuditJob).mockRejectedValue(new Error('redis down'));
    const res = await as(admin).post('/admin/platform-audits').send(auditBody);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUDIT_QUEUE_UNAVAILABLE');
    const audit = await Audit.findOne({}).lean();
    expect(audit).toMatchObject({ status: 'FAILED', errorMessage: 'Could not queue the audit' });
  });

  it.each([
    [{ url: 'example.com' }],
    [{ url: 'ftp://example.com' }],
    [{ city: '' }],
    [{ niche: 'plumber' }],
    [{ businessName: '' }],
  ])('400 for %j', async (patch) => {
    const res = await as(admin).post('/admin/platform-audits').send({ ...auditBody, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(addPlatformAuditJob).not.toHaveBeenCalled();
  });
});

describe('GET /admin/platform-audits/:id', () => {
  it('reads status, scores and measurement errors of a platform audit', async () => {
    const { audit } = await completedBusiness('read.example', {
      ...WORST,
      completedAt: new Date('2026-11-28T10:00:00Z'),
      measurementErrors: [{ measurement: 'standards', message: 'not read' }],
    });
    const res = await as(admin).get(`/admin/platform-audits/${audit._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      auditId: String(audit._id),
      businessId: String(audit.businessId),
      status: 'COMPLETED',
      measurementErrors: [{ measurement: 'standards', message: 'not read' }],
      completedAt: '2026-11-28T10:00:00.000Z',
    });
  });

  it('404 PLATFORM_AUDIT_NOT_FOUND for an unknown id, a bad id and an audit a lead ran', async () => {
    const business = await Business.create({ domain: 'lead.example', originalUrl: 'https://lead.example', businessName: 'L' });
    const leadAudit = await Audit.create({ leadId: new Types.ObjectId(), businessId: business._id, status: 'COMPLETED' });
    for (const id of [String(new Types.ObjectId()), 'nope', String(leadAudit._id)]) {
      const res = await as(admin).get(`/admin/platform-audits/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PLATFORM_AUDIT_NOT_FOUND');
    }
  });
});

describe('lots', () => {
  it('POST /admin/lots prices the lot from the audit with priceFromAudit, never a model', async () => {
    const { business, audit } = await completedBusiness('price.example');
    const res = await as(admin).post('/admin/lots').send({ businessId: String(business._id) });
    expect(res.status).toBe(201);
    const expected = priceFromAudit(audit.toObject() as never, lotPriceSettings);
    expect(res.body.data).toMatchObject({
      status: 'DRAFT',
      priceCents: expected.amountCents,
      currency: expected.currency,
      band: 'A',
      need: 1,
      city: 'Vilnius',
      niche: 'dental',
      auditId: String(audit._id),
      businessId: String(business._id),
    });
    expect(res.body.data.priceSignals.length).toBe(expected.signals.length);
  });

  it('prices from a lead audit too: the audit is shared', async () => {
    const business = await Business.create({ domain: 'shared.example', originalUrl: 'https://shared.example', businessName: 'S', city: 'Riga' });
    await Audit.create({ leadId: new Types.ObjectId(), businessId: business._id, status: 'COMPLETED', ...WORST });
    expect((await as(admin).post('/admin/lots').send({ businessId: String(business._id) })).status).toBe(201);
  });

  it('409 NO_COMPLETED_PLATFORM_AUDIT without a completed audit, and for an unknown business', async () => {
    const business = await Business.create({ domain: 'none.example', originalUrl: 'https://none.example', businessName: 'N', city: 'Riga' });
    await Audit.create({ businessId: business._id, status: 'QUEUED' });
    for (const id of [String(business._id), String(new Types.ObjectId())]) {
      const res = await as(admin).post('/admin/lots').send({ businessId: id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_COMPLETED_PLATFORM_AUDIT');
    }
  });

  it('409 LOT_NOT_PRICEABLE for an audit with no price signal', async () => {
    const { business } = await completedBusiness('empty.example', { scores: { total: 50 } });
    const res = await as(admin).post('/admin/lots').send({ businessId: String(business._id) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOT_NOT_PRICEABLE');
    expect(await Lot.countDocuments()).toBe(0);
  });

  it.each([
    ['opted out', { optedOutAt: new Date() }],
    ['held', { contactHold: { rightId: new Types.ObjectId(), tenantId: new Types.ObjectId(), expiresAt: new Date(Date.now() + 864e5), cooldownUntil: new Date(Date.now() + 40 * 864e5) } }],
    ['in cooldown', { contactHold: { rightId: new Types.ObjectId(), tenantId: new Types.ObjectId(), expiresAt: new Date(Date.now() - 864e5), cooldownUntil: new Date(Date.now() + 864e5) } }],
    ['without a city', { $unset: { city: '' } }],
  ])('409 LOT_NOT_ELIGIBLE for a business %s', async (_name, patch) => {
    const { business } = await completedBusiness(`elig-${n++}.example`);
    await Business.collection.updateOne({ _id: business._id }, '$unset' in patch ? patch : { $set: patch });
    const res = await as(admin).post('/admin/lots').send({ businessId: String(business._id) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOT_NOT_ELIGIBLE');
    expect(await Lot.countDocuments()).toBe(0);
  });

  it('409 LOT_ALREADY_LIVE for a second lot, and a withdrawn lot frees the slot', async () => {
    const { business } = await completedBusiness('twice.example');
    const body = { businessId: String(business._id) };
    const first = await as(admin).post('/admin/lots').send(body);
    expect(first.status).toBe(201);
    const second = await as(admin).post('/admin/lots').send(body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('LOT_ALREADY_LIVE');
    expect((await as(admin).post(`/admin/lots/${first.body.data._id}/withdraw`).send({})).status).toBe(200);
    expect((await as(admin).post('/admin/lots').send(body)).status).toBe(201);
  });

  it('400 for a bad business id', async () => {
    expect((await as(admin).post('/admin/lots').send({ businessId: 'abc' })).status).toBe(400);
  });

  it('opens a DRAFT lot with releaseAt, refuses opening it twice, and 404s an unknown id', async () => {
    const { business } = await completedBusiness('open.example');
    const lot = (await as(admin).post('/admin/lots').send({ businessId: String(business._id) })).body.data;
    const open = await as(admin).post(`/admin/lots/${lot._id}/open`).send({ releaseAt: '2026-12-01T10:00:00.000Z' });
    expect(open.status).toBe(200);
    expect(open.body.data).toMatchObject({ status: 'OPEN', releaseAt: '2026-12-01T10:00:00.000Z' });
    const again = await as(admin).post(`/admin/lots/${lot._id}/open`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LOT_TRANSITION_NOT_ALLOWED');
    const missing = await as(admin).post(`/admin/lots/${new Types.ObjectId()}/open`).send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('LOT_NOT_FOUND');
    expect((await as(admin).post(`/admin/lots/${lot._id}/open`).send({ releaseAt: 'soon' })).status).toBe(400);
  });

  it.each([
    ['opted out', { optedOutAt: new Date() }],
    ['held', { contactHold: { rightId: new Types.ObjectId(), tenantId: new Types.ObjectId(), expiresAt: new Date(Date.now() + 864e5), cooldownUntil: new Date(Date.now() + 40 * 864e5) } }],
    ['in cooldown', { contactHold: { rightId: new Types.ObjectId(), tenantId: new Types.ObjectId(), expiresAt: new Date(Date.now() - 864e5), cooldownUntil: new Date(Date.now() + 864e5) } }],
  ])('refuses to open a DRAFT lot of a business that became %s, and writes nothing', async (_name, patch) => {
    const { business } = await completedBusiness(`open-elig-${n++}.example`);
    const lot = (await as(admin).post('/admin/lots').send({ businessId: String(business._id) })).body.data;
    await Business.collection.updateOne({ _id: business._id }, { $set: patch });
    const res = await as(admin).post(`/admin/lots/${lot._id}/open`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOT_NOT_ELIGIBLE');
    const after = await Lot.findById(lot._id).lean();
    expect(after?.status).toBe('DRAFT');
    expect(after?.releaseAt).toBeUndefined();
  });

  it('opens with releaseAt defaulting to now, and does not open a RESERVED lot', async () => {
    const { business } = await completedBusiness('reserved.example');
    const lot = (await as(admin).post('/admin/lots').send({ businessId: String(business._id) })).body.data;
    const before = Date.now();
    const open = await as(admin).post(`/admin/lots/${lot._id}/open`).send({});
    expect(new Date(open.body.data.releaseAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    await Lot.updateOne({ _id: lot._id }, { status: 'RESERVED' });
    expect((await as(admin).post(`/admin/lots/${lot._id}/open`).send({})).status).toBe(409);
  });

  it('withdraws with reason admin; a withdrawn lot cannot be withdrawn again', async () => {
    const { business } = await completedBusiness('wd.example');
    const lot = (await as(admin).post('/admin/lots').send({ businessId: String(business._id) })).body.data;
    const res = await as(admin).post(`/admin/lots/${lot._id}/withdraw`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'WITHDRAWN', withdrawReason: 'admin' });
    expect(res.body.data.withdrawnAt).toBeTruthy();
    const again = await as(admin).post(`/admin/lots/${lot._id}/withdraw`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LOT_TRANSITION_NOT_ALLOWED');
    expect((await as(admin).post(`/admin/lots/${new Types.ObjectId()}/withdraw`).send({})).status).toBe(404);
  });

  it('lists lots newest first with a status filter and pagination', async () => {
    const ids: string[] = [];
    for (const domain of ['l1.example', 'l2.example', 'l3.example']) {
      const { business } = await completedBusiness(domain);
      ids.push((await as(admin).post('/admin/lots').send({ businessId: String(business._id) })).body.data._id);
    }
    await as(admin).post(`/admin/lots/${ids[0]}/open`).send({});
    const all = await as(admin).get('/admin/lots');
    expect(all.body.data.map((l: { _id: string }) => l._id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(all.body.pagination).toMatchObject({ total: 3, page: 1, limit: 20 });
    const open = await as(admin).get('/admin/lots?status=OPEN');
    expect(open.body.data.map((l: { _id: string }) => l._id)).toEqual([ids[0]]);
    expect((await as(admin).get('/admin/lots?limit=2&page=2')).body.data).toHaveLength(1);
    expect((await as(admin).get('/admin/lots?limit=101')).status).toBe(400);
    expect((await as(admin).get('/admin/lots?status=SPOILED')).status).toBe(400);
  });
});
