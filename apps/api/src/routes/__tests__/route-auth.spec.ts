import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { authedRequest, setMemberRole } from './authed-request.js';
import { closeServer, listenOnLoopback } from './loopback-server.js';
import { listApiRoutes } from './route-table.js';

// Loading the routes imports the queues; none of them may connect to Redis or Mongo here
vi.mock('../../services/membership.service.js', async () => (await import('./authed-request.js')).membershipServiceMock());
vi.mock('../../services/lead.service.js');
// The owner-only routes run their handlers in the role table below; none of them may reach a database
vi.mock('../../services/organization.service.js');
vi.mock('../../models/Audit.model.js');
vi.mock('../../data/tenant-scope.js', async () => (await import('../../__tests__/scope-passthrough.js')).tenantScopeMock());
vi.mock('../../models/Lead.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../queues/audit.queue.js');
vi.mock('../../queues/ai.queue.js', () => ({ addAiGenerationJob: vi.fn(), aiGenerationQueue: {} }));
vi.mock('../../queues/deploy.queue.js', () => ({ deployQueue: {} }));
vi.mock('../../queues/email.queue.js', () => ({ addEmailDispatchJob: vi.fn(), calculateDispatchDelay: vi.fn(), emailQueue: {} }));
vi.mock('../../queues/email-test.queue.js', () => ({ sendTestEmailJob: vi.fn() }));
vi.mock('../../queues/mvp-page.queue.js', () => ({
  runMvpPageJob: vi.fn(),
  MVP_PAGE_CHANGE_WAIT_MS: 420_000,
  MVP_PAGE_PUBLISH_WAIT_MS: 120_000,
}));

/**
 * REV-206: every route of the API needs a token except these. The list is written out here on purpose:
 * a new route fails the test below until someone decides whether it is public.
 */
const PUBLIC_ROUTES = [
  'GET /health',
  'POST /auth/register',
  'POST /auth/login',
  // The join page reads an invitation by its token (REV-207); accepting one needs a session
  'GET /invitations/:token',
  'POST /invitations/:token/join',
  // Recipients and MVP pages call these; they carry a campaign token instead of a session
  'GET /track/open/:token.gif',
  'GET /track/open/:token',
  'GET /track/click/:token',
  'POST /track/mvp-event',
  'GET /track/unsubscribe/:token',
  'POST /track/unsubscribe/:token',
  'GET /track/revamp-tracker.js',
  // Loaded in an iframe, which cannot send a header
  'GET /mvp/preview/:slug',
];

describe('every API route needs a token unless it is public (REV-206)', () => {
  let server: Server;
  let routes: string[];
  beforeAll(async () => {
    const app = createApp();
    // The API router is mounted at API_PREFIX; its routes are listed relative to it
    routes = listApiRoutes(app);
    server = await listenOnLoopback(app);
  });
  afterAll(() => closeServer(server));

  it('finds the routes it is meant to guard', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('GET /leads');
    expect(routes).toContain('POST /outreach/:id/approve');
  });

  it('lists only public routes that exist', () => {
    const missing = PUBLIC_ROUTES.filter((route) => !routes.includes(route));
    expect(missing).toEqual([]);
  });

  it('lets every public route through without a token: none answers 401', async () => {
    // A public handler may answer anything (the models and queues are mocked) or still be running when the wait ends;
    // only the guard's 401 UNAUTHENTICATED is a failure
    const failures: string[] = [];
    for (const route of PUBLIC_ROUTES) {
      const [method, path] = route.split(' ') as [string, string];
      const url = `${env.API_PREFIX}${path.replace(/:\w+/g, 'x1')}`;
      const res = await (request(server) as any)
        [method.toLowerCase()](url)
        .send({})
        .timeout({ response: 1500, deadline: 1500 })
        .catch((error: { status?: number }) => ({ status: error.status ?? 0, body: {} }));
      if (res.status === 401 && res.body?.error?.code === 'UNAUTHENTICATED') failures.push(route);
    }
    expect(failures).toEqual([]);
  });

  it('answers 401 UNAUTHENTICATED to every other route without a token', async () => {
    const guarded = routes.filter((route) => !PUBLIC_ROUTES.includes(route));
    expect(guarded.length).toBeGreaterThan(15);
    const failures: string[] = [];
    for (const route of guarded) {
      const [method, path] = route.split(' ') as [string, string];
      const url = `${env.API_PREFIX}${path.replace(/:\w+/g, 'x1')}`;
      const res = await (request(server) as any)[method.toLowerCase()](url).send({});
      if (res.status !== 401 || res.body?.error?.code !== 'UNAUTHENTICATED') failures.push(`${route} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('answers 401 to a forged token on a guarded route', async () => {
    const res = await request(server).get(`${env.API_PREFIX}/leads`).set('Authorization', 'Bearer forged.token.value');
    expect(res.status).toBe(401);
  });

  it('keeps the other methods of /mvp/preview/:slug guarded', async () => {
    const res = await request(server).delete(`${env.API_PREFIX}/mvp/preview/x1`);
    expect(res.status).toBe(401);
  });
  describe('roles (REV-207)', () => {
    const READ = new Set(['GET', 'HEAD', 'OPTIONS']);
    // /auth/me and accepting an invitation answer every signed-in role about themselves; the rest of both is public
    const own = (route: string) => /^(GET|POST) \/(auth|invitations)\//.test(route);
    const rolePath = (route: string) => `${env.API_PREFIX}${route.split(' ')[1]!.replace(/:\w+/g, 'x1')}`;
    /**
     * A guard answers 403 or 401 itself, fast, before any handler: those calls wait for the answer (no timeout, so
     * load cannot turn a guard answer into a pass or a failure). A call that is expected to get through the guard may
     * run a handler that never answers (the models are mocked), so it only waits a moment.
     */
    const call = async (route: string, expectGuardAnswer = false) => {
      const method = route.split(' ')[0]!.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const pending = authedRequest(server)[method](rolePath(route)).send({});
      if (expectGuardAnswer) return pending.catch((error: { status?: number }) => ({ status: error.status ?? 0, body: {} }));
      return pending
        .timeout({ response: 400, deadline: 400 })
        .catch((error: { status?: number }) => ({ status: error.status ?? 0, body: {} }));
    };
    /** Not refused by the guard: neither 401 nor 403 (a timeout, 0, means a handler is running, which is a pass) */
    const gotThrough = (status: number) => status !== 401 && status !== 403;
    // REV-232: `/admin/*` is for the platform admins list, not for a studio role: checked in its own test below
    const adminRoutes = () => routes.filter((r) => r.includes(' /admin/'));
    const roleRoutes = () => routes.filter((r) => !PUBLIC_ROUTES.includes(r) && !own(r) && !r.includes(' /admin/'));
    const writeRoutes = () => roleRoutes().filter((r) => !READ.has(r.split(' ')[0]!) && !r.includes(' /organization/'));
    const readRoutes = () => roleRoutes().filter((r) => READ.has(r.split(' ')[0]!) && !r.includes(' /organization/'));
    const ownerRoutes = () => roleRoutes().filter((r) => r.includes(' /organization/'));

    afterAll(() => setMemberRole('owner'));

    it('finds the write routes it is meant to check', () => {
      expect(writeRoutes().length).toBeGreaterThanOrEqual(11);
      expect(writeRoutes()).toContain('POST /leads');
      expect(writeRoutes()).toContain('POST /outreach/:id/approve');
      expect(writeRoutes()).toContain('POST /outreach/:id/test');
      expect(readRoutes().length).toBeGreaterThan(5);
    });

    it('refuses every write route to a viewer with 403 FORBIDDEN', async () => {
      setMemberRole('viewer');
      const failures: string[] = [];
      for (const route of writeRoutes()) {
        const res = await call(route, true);
        if (res.status !== 403 || res.body?.error?.code !== 'FORBIDDEN') failures.push(`${route} -> ${res.status}`);
      }
      expect(failures).toEqual([]);
    });

    it('lets a viewer read: no read route answers 403', async () => {
      setMemberRole('viewer');
      const failures: string[] = [];
      for (const route of readRoutes()) {
        if (!gotThrough((await call(route)).status)) failures.push(route);
      }
      expect(failures).toEqual([]);
    });

    it.each(['operator', 'owner'] as const)('does not refuse any write route to an %s', async (role) => {
      setMemberRole(role);
      const failures: string[] = [];
      for (const route of writeRoutes()) {
        if (!gotThrough((await call(route)).status)) failures.push(route);
      }
      expect(failures).toEqual([]);
    });

    it('keeps the members and invitations routes to owners: 403 for an operator and a viewer on every one', async () => {
      expect(ownerRoutes().length).toBeGreaterThanOrEqual(5);
      for (const role of ['operator', 'viewer'] as const) {
        setMemberRole(role);
        const failures: string[] = [];
        for (const route of ownerRoutes()) {
          const res = await call(route, true);
          if (res.status !== 403 || res.body?.error?.code !== 'FORBIDDEN') failures.push(`${role} ${route} -> ${res.status}`);
        }
        expect(failures).toEqual([]);
      }
      setMemberRole('owner');
      for (const route of ownerRoutes()) expect(gotThrough((await call(route)).status), route).toBe(true);
    });

    it('refuses every /admin route to a studio owner who is not a platform admin with 403 FORBIDDEN (REV-232)', async () => {
      expect(adminRoutes().length).toBeGreaterThanOrEqual(6);
      for (const role of ['owner', 'operator', 'viewer'] as const) {
        setMemberRole(role);
        const failures: string[] = [];
        for (const route of adminRoutes()) {
          const res = await call(route, true);
          if (res.status !== 403 || res.body?.error?.code !== 'FORBIDDEN') failures.push(`${role} ${route} -> ${res.status}`);
        }
        expect(failures).toEqual([]);
      }
      setMemberRole('owner');
    });

    it('answers 401 when the membership is gone, on a read and on a write route', async () => {
      setMemberRole(null);
      expect((await call('GET /leads', true)).status).toBe(401);
      expect((await call('POST /leads', true)).status).toBe(401);
    });
  });
});
