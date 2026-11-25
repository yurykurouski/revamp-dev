import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrganizationWithOwner } from '@revamp/db';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { Organization } from '../../models/Organization.model.js';
import { requireSender } from '../../services/sender.service.js';
import { signSessionToken } from '../../services/token.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';
import { setMemberRole } from './authed-request.js';

// REV-221: the studio sender on a real MongoDB. The role comes from the mocked membership lookup, so one owner token can
// act as owner, operator or viewer; the queues are mocked and nothing reaches Redis or a worker.
vi.mock('../../services/membership.service.js', async () => (await import('./authed-request.js')).membershipServiceMock());
vi.mock('../../queues/audit.queue.js', () => ({ addAuditJob: vi.fn(), auditQueue: {} }));
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
let A: { id: string; token: string };
let B: { id: string; token: string };
let n = 0;

async function studio(name: string) {
  const { organization, user } = await createOrganizationWithOwner({
    email: `owner-${++n}@${name}.test`,
    passwordHash: 'x',
    organizationName: name,
  });
  const id = String(organization._id);
  return { id, token: signSessionToken({ userId: String(user._id), organizationId: id, role: 'owner' }) };
}
const as = (s: { token: string }) => ({
  get: (url: string) => request(server).get(`${PREFIX}${url}`).set('Authorization', `Bearer ${s.token}`),
  put: (url: string) => request(server).put(`${PREFIX}${url}`).set('Authorization', `Bearer ${s.token}`),
});

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongo.getUri('revamp-sender-test'));
  server = await listenOnLoopback(createApp());
}, 120_000);

afterAll(async () => {
  setMemberRole('owner');
  await closeServer(server);
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  setMemberRole('owner');
  await mongoose.connection.dropDatabase();
  A = await studio('alpha');
  B = await studio('bravo');
});

describe('studio sender routes (REV-221)', () => {
  it('reports no sender before one is set', async () => {
    const res = await as(A).get('/outreach/sender');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { configured: false } });
  });

  it("the owner's PUT stores the sender, and a viewer reads it", async () => {
    const put = await as(A).put('/organization/sender').send({ name: ' Studio A ', address: 'Hello@Studio-A.test' });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ configured: true, name: 'Studio A', address: 'hello@studio-a.test' });
    expect((await Organization.findById(A.id).lean())?.sender).toEqual({ name: 'Studio A', address: 'hello@studio-a.test' });

    setMemberRole('viewer');
    const get = await as(A).get('/outreach/sender');
    expect(get.status).toBe(200);
    expect(get.body.data).toEqual({ configured: true, name: 'Studio A', address: 'hello@studio-a.test' });
  });

  it('an invalid address is 400 and writes nothing', async () => {
    const res = await as(A).put('/organization/sender').send({ name: 'Studio A', address: 'nope' });
    expect(res.status).toBe(400);
    expect((await Organization.findById(A.id).lean())?.sender).toBeUndefined();
  });

  it('an operator and a viewer get 403 and nothing is written', async () => {
    for (const role of ['operator', 'viewer'] as const) {
      setMemberRole(role);
      const res = await as(A).put('/organization/sender').send({ name: 'Mallory', address: 'm@evil.test' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await Organization.findById(A.id).lean())?.sender).toBeUndefined();
  });

  it("another studio's sender is never shown, and a save changes only the caller's studio", async () => {
    await as(A).put('/organization/sender').send({ name: 'Studio A', address: 'a@studio-a.test' });
    expect((await as(B).get('/outreach/sender')).body.data).toEqual({ configured: false });
    await as(B).put('/organization/sender').send({ name: 'Studio B', address: 'b@studio-b.test' });
    expect((await as(A).get('/outreach/sender')).body.data.address).toBe('a@studio-a.test');
    expect((await as(B).get('/outreach/sender')).body.data.address).toBe('b@studio-b.test');
  });

  it('a body that names an organization cannot move the write to another studio', async () => {
    await as(B).put('/organization/sender').send({ name: 'Studio B', address: 'b@studio-b.test', organizationId: A.id, _id: A.id });
    expect((await Organization.findById(A.id).lean())?.sender).toBeUndefined();
    expect((await Organization.findById(B.id).lean())?.sender?.address).toBe('b@studio-b.test');
  });

  it('requireSender refuses a studio without a sender with 409 SENDER_NOT_CONFIGURED and returns one that has it', async () => {
    await expect(requireSender(A.id)).rejects.toMatchObject({ statusCode: 409, code: 'SENDER_NOT_CONFIGURED' });
    await as(A).put('/organization/sender').send({ name: 'Studio A', address: 'a@studio-a.test' });
    await expect(requireSender(A.id)).resolves.toEqual({ name: 'Studio A', address: 'a@studio-a.test' });
  });
});
