import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationRole } from '@revamp/shared-types';
import { AppError } from '../errorHandler.js';
import { requireAuth, requireAuthUnless, requireOwner, requireWriter } from '../requireAuth.js';
import { findMembershipRole } from '../../services/membership.service.js';
import { signSessionToken } from '../../services/token.js';

vi.mock('../../services/membership.service.js', () => ({ findMembershipRole: vi.fn() }));

const claims = { userId: '5eed00000000000000000001', organizationId: '5eed00000000000000000002', role: 'owner' as const };

/** Runs a middleware and waits for it to call next (the guards are async) */
const run = async (middleware: RequestHandler, headers: Record<string, string> = {}, extra: Partial<Request> = {}) => {
  const req = { headers, method: 'GET', path: '/', ...extra } as unknown as Request;
  let next!: ReturnType<typeof vi.fn>;
  await new Promise<void>((resolve) => {
    next = vi.fn(() => resolve());
    middleware(req, {} as Response, next as unknown as NextFunction);
  });
  return { req, next };
};

const unauthenticated = (next: ReturnType<typeof vi.fn>) => {
  const error = next.mock.calls[0]![0];
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
};

const bearer = () => ({ authorization: `Bearer ${signSessionToken(claims)}` });

describe('requireAuth (REV-206, REV-207)', () => {
  beforeEach(() => {
    vi.mocked(findMembershipRole).mockReset();
    vi.mocked(findMembershipRole).mockResolvedValue('owner');
  });

  it('sets req.auth from a valid bearer token and the live membership, and continues without an error', async () => {
    const { req, next } = await run(requireAuth, bearer());
    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toEqual(claims);
    expect(findMembershipRole).toHaveBeenCalledWith(claims.userId, claims.organizationId);
  });

  it.each([
    ['no header', {}],
    ['an empty header', { authorization: '' }],
    ['another scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['a bearer without a token', { authorization: 'Bearer ' }],
    ['an invalid token', { authorization: 'Bearer not.a.token' }],
  ])('is 401 UNAUTHENTICATED with %s, without a database read', async (_label, headers) => {
    const { req, next } = await run(requireAuth, headers);
    unauthenticated(next);
    expect(req.auth).toBeUndefined();
    expect(findMembershipRole).not.toHaveBeenCalled();
  });

  it('accepts the scheme in any letter case', async () => {
    const { next } = await run(requireAuth, { authorization: `bearer ${signSessionToken(claims)}` });
    expect(next).toHaveBeenCalledWith();
  });

  it('is 401 when the membership is gone: a removed member loses access at once, whatever the token says', async () => {
    vi.mocked(findMembershipRole).mockResolvedValue(null);
    const { req, next } = await run(requireAuth, bearer());
    unauthenticated(next);
    expect(req.auth).toBeUndefined();
  });

  it.each<OrganizationRole>(['owner', 'operator', 'viewer'])('takes the role from the database, not the token: %s', async (role) => {
    vi.mocked(findMembershipRole).mockResolvedValue(role);
    const { req } = await run(requireAuth, bearer());
    expect(req.auth?.role).toBe(role);
  });

  it('passes a database failure on to the error handler instead of hanging or granting access', async () => {
    const failure = new Error('mongo down');
    vi.mocked(findMembershipRole).mockRejectedValue(failure);
    const { req, next } = await run(requireAuth, bearer());
    expect(next).toHaveBeenCalledWith(failure);
    expect(req.auth).toBeUndefined();
  });
});

describe('requireAuthUnless (REV-206)', () => {
  const guard = requireAuthUnless((req) => req.method === 'GET' && req.path === '/open');

  beforeEach(() => {
    vi.mocked(findMembershipRole).mockReset();
    vi.mocked(findMembershipRole).mockResolvedValue('owner');
  });

  it('lets a matching request through without a token', async () => {
    const { req, next } = await run(guard, {}, { method: 'GET', path: '/open' });
    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toBeUndefined();
  });

  it('still requires a token for every other request, including another method on the same path', async () => {
    unauthenticated((await run(guard, {}, { method: 'POST', path: '/open' })).next);
    unauthenticated((await run(guard, {}, { method: 'GET', path: '/closed' })).next);
  });
});

const forbidden = (next: ReturnType<typeof vi.fn>) => {
  const error = next.mock.calls[0]![0];
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
};

const asRole = (role: OrganizationRole | undefined, method: string) =>
  ({ headers: {}, method, path: '/', auth: role ? { ...claims, role } : undefined }) as unknown as Partial<Request>;

describe('requireWriter (REV-207)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('lets an owner and an operator %s, and refuses a viewer with 403 FORBIDDEN', async (method) => {
    for (const role of ['owner', 'operator'] as const) {
      expect((await run(requireWriter, {}, asRole(role, method))).next).toHaveBeenCalledWith();
    }
    forbidden((await run(requireWriter, {}, asRole('viewer', method))).next);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets a viewer %s', async (method) => {
    expect((await run(requireWriter, {}, asRole('viewer', method))).next).toHaveBeenCalledWith();
  });

  it('is 401, not 403, for a write when no one is signed in (the guard ran in the wrong order)', async () => {
    unauthenticated((await run(requireWriter, {}, asRole(undefined, 'POST'))).next);
    unauthenticated((await run(requireWriter, {}, asRole(undefined, 'DELETE'))).next);
  });

  it('lets a read through without a session: the public preview shares the mount', async () => {
    expect((await run(requireWriter, {}, asRole(undefined, 'GET'))).next).toHaveBeenCalledWith();
  });
});

describe('requireOwner (REV-207)', () => {
  it('lets an owner through and refuses an operator and a viewer with 403 FORBIDDEN, for every method', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect((await run(requireOwner, {}, asRole('owner', method))).next).toHaveBeenCalledWith();
      forbidden((await run(requireOwner, {}, asRole('operator', method))).next);
      forbidden((await run(requireOwner, {}, asRole('viewer', method))).next);
    }
  });
});
