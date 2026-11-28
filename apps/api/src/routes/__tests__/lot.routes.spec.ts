import type { Server } from 'node:http';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Business, Lot, Membership, createOrganizationWithOwner } from '@revamp/db';
import { MaskedLotSchema, needLevel } from '@revamp/validation';
import { errorHandler } from '../../middlewares/errorHandler.js';
import { requireAuth, requireWriter } from '../../middlewares/requireAuth.js';
import type { RateLimitStore } from '../../middlewares/rateLimit.js';
import { signSessionToken } from '../../services/token.js';
import { createLotRoutes, type LotRoutesDeps } from '../lot.routes.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';

vi.mock('../../queues/connection.js', () => ({ redisConnection: { status: 'ready', multi: vi.fn() } }));

// REV-233: GET /lots against a real in-memory replica set; the limiter's store is a test double
let mongo: MongoMemoryReplSet;
const servers: Server[] = [];
let studioA: { token: string };
let studioB: { token: string };
let n = 0;

const NAME = 'Secret Dental Clinic';
const DOMAIN = 'secret-clinic.example';

async function account(email: string) {
  const { organization, user } = await createOrganizationWithOwner({ email, passwordHash: 'x', organizationName: `Studio ${email}` });
  const token = signSessionToken({ userId: String(user._id), organizationId: String(organization._id), role: 'owner' });
  return { token, userId: user._id, organizationId: organization._id };
}

const memoryStore = (): RateLimitStore => {
  const counts = new Map<string, number>();
  return { hit: async (key) => counts.set(key, (counts.get(key) ?? 0) + 1).get(key)! };
};

async function serve(deps: LotRoutesDeps = {}) {
  const app = express();
  app.use('/lots', requireAuth, requireWriter, createLotRoutes({ store: memoryStore(), ...deps }));
  app.use(errorHandler);
  const server = await listenOnLoopback(app);
  servers.push(server);
  return server;
}
const get = (server: Server, who: { token: string }, url = '/lots') =>
  request(server).get(url).set('Authorization', `Bearer ${who.token}`);

async function lots(count: number, over: Record<string, unknown> = {}) {
  for (let i = 0; i < count; i++) {
    const business = await Business.create({ domain: `b${++n}.example`, originalUrl: `https://${DOMAIN}/${n}`, businessName: NAME, niche: 'dental', city: 'Vilnius' });
    await Lot.create({
      businessId: business._id, auditId: new Types.ObjectId(), niche: 'dental', city: 'Vilnius', priceCents: 2000, currency: 'EUR',
      band: 'B', need: 0.6, priceSignals: [{ signal: 'lcp', value: 4321, need: 0.5, weight: 1 }, { signal: 'siteEra', value: 5, need: 0.9, weight: 2 }],
      status: 'OPEN', live: true, releaseAt: new Date(Date.now() - 60_000), ...over,
    });
  }
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongo.getUri('revamp-lot-routes-test'));
}, 120_000);

afterAll(async () => {
  await Promise.all(servers.map(closeServer));
  await mongoose.disconnect();
  await mongo.stop();
}, 60_000);

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([Business.init(), Lot.init(), Membership.init()]);
  studioA = await account(`a-${++n}@studio.test`);
  studioB = await account(`b-${++n}@studio.test`);
});

describe('GET /lots masking (REV-233)', () => {
  it('answers 401 without a token', async () => {
    const server = await serve();
    expect((await request(server).get('/lots')).status).toBe(401);
  });

  it('lists masked items only: exact keys, levels from needLevel, no identity anywhere in the body', async () => {
    await lots(3);
    const res = await get(await serve(), studioA);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, page: 1, limit: 20 });
    const items = res.body.data.items as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['band', 'city', 'currency', 'id', 'niche', 'priceCents', 'releaseAt', 'signals']);
      expect(MaskedLotSchema.safeParse(item).success).toBe(true);
    }
    expect(items[0]!['signals']).toEqual([
      { signal: 'lcp', level: needLevel(0.5) },
      { signal: 'siteEra', level: needLevel(0.9) },
    ]);
    const body = JSON.stringify(res.body);
    for (const secret of [NAME, DOMAIN, 'originalUrl', 'businessId', 'auditId', '4321']) expect(body).not.toContain(secret);
  });

  it('refuses to send an item with an extra identity field: 500 and the field is not in the body', async () => {
    const leaky = async () => ({
      total: 1,
      items: [{
        id: 'a'.repeat(24), niche: 'dental', city: 'Vilnius', band: 'B', priceCents: 1, currency: 'EUR',
        releaseAt: new Date(), signals: [], businessId: 'b'.repeat(24),
      }],
    });
    // the schema is strict: the extra key must fail the parse, never be silently dropped
    const res = await get(await serve({ fetchLots: leaky as never }), studioA);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('b'.repeat(24));
  });

  it('shows releaseAt truncated to the whole minute', async () => {
    await lots(3, { releaseAt: new Date('2026-11-01T12:34:56.789Z') });
    const res = await get(await serve(), studioA);
    expect(res.body.data.items.map((i: { releaseAt: string }) => i.releaseAt)).toEqual(Array(3).fill('2026-11-01T12:34:00.000Z'));
  });

  it.each(['owner', 'operator', 'viewer'] as const)('answers 200 for a %s', async (role) => {
    const member = await account(`m-${++n}@studio.test`);
    await Membership.updateOne({ userId: member.userId, organizationId: member.organizationId }, { role });
    expect((await get(await serve(), member)).status).toBe(200);
  });
});

describe('GET /lots k threshold, release time and filters', () => {
  it('withholds a group below k and lists a group of k', async () => {
    await lots(2, { niche: 'auto', city: 'Kaunas', band: 'A' });
    await lots(3);
    const res = await get(await serve({ minGroup: 3 }), studioA);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.every((i: { niche: string }) => i.niche === 'dental')).toBe(true);
  });

  it('lists a lot only from its release time', async () => {
    await lots(3, { releaseAt: new Date(Date.now() + 3_600_000) });
    const res = await get(await serve(), studioA);
    expect(res.body.data).toMatchObject({ total: 0, items: [] });
  });

  it('filters by niche, city and band, and pages', async () => {
    await lots(4);
    await lots(3, { niche: 'auto', city: 'Kaunas', band: 'A' });
    const server = await serve();
    expect((await get(server, studioA, '/lots?niche=auto')).body.data.total).toBe(3);
    expect((await get(server, studioA, '/lots?city=vilnius&band=B')).body.data.total).toBe(4);
    const page = (await get(server, studioA, '/lots?limit=2&page=2')).body.data;
    expect(page).toMatchObject({ total: 7, page: 2, limit: 2 });
    expect(page.items).toHaveLength(2);
  });

  it.each(['limit=0', 'limit=51', 'page=0', 'band=E', 'niche=cars', `city=${'x'.repeat(101)}`])('answers 400 VALIDATION_ERROR for %s', async (q) => {
    const res = await get(await serve(), studioA, `/lots?${q}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /lots rate limit', () => {
  it('answers 429 RATE_LIMITED after the limit for one studio while another studio is unaffected, and 400 does not use the budget', async () => {
    const server = await serve({ limit: 30, now: () => 1_700_000_000_000 });
    for (let i = 0; i < 5; i++) expect((await get(server, studioA, '/lots?limit=0')).status).toBe(400);
    for (let i = 0; i < 30; i++) expect((await get(server, studioA)).status).toBe(200);
    const over = await get(server, studioA);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('RATE_LIMITED');
    expect(over.body.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(over.headers['retry-after']).toBe(String(over.body.error.details.retryAfterSeconds));
    expect((await get(server, studioB)).status).toBe(200);
  });

  it('answers 503 LISTINGS_UNAVAILABLE when the store rejects', async () => {
    const server = await serve({ store: { hit: async () => { throw new Error('down'); } } });
    const res = await get(server, studioA);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LISTINGS_UNAVAILABLE');
  });
});
