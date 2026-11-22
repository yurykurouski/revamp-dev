import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errorHandler.js';
import { requireAuth, requireAuthUnless } from '../requireAuth.js';
import { signSessionToken } from '../../services/token.js';

const claims = { userId: '5eed00000000000000000001', organizationId: '5eed00000000000000000002', role: 'owner' as const };

const run = (middleware: ReturnType<typeof requireAuth>, headers: Record<string, string> = {}, extra: Partial<Request> = {}) => {
  const req = { headers, method: 'GET', path: '/', ...extra } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  middleware(req, {} as Response, next);
  return { req, next: next as ReturnType<typeof vi.fn> };
};

const unauthenticated = (next: ReturnType<typeof vi.fn>) => {
  const error = next.mock.calls[0]![0];
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
};

describe('requireAuth (REV-206)', () => {
  it('sets req.auth from a valid bearer token and continues without an error', () => {
    const { req, next } = run(requireAuth, { authorization: `Bearer ${signSessionToken(claims)}` });
    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toEqual(claims);
  });

  it.each([
    ['no header', {}],
    ['an empty header', { authorization: '' }],
    ['another scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['a bearer without a token', { authorization: 'Bearer ' }],
    ['an invalid token', { authorization: 'Bearer not.a.token' }],
  ])('is 401 UNAUTHENTICATED with %s', (_label, headers) => {
    const { req, next } = run(requireAuth, headers);
    unauthenticated(next);
    expect(req.auth).toBeUndefined();
  });

  it('accepts the scheme in any letter case', () => {
    const { next } = run(requireAuth, { authorization: `bearer ${signSessionToken(claims)}` });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireAuthUnless (REV-206)', () => {
  const guard = requireAuthUnless((req) => req.method === 'GET' && req.path === '/open');

  it('lets a matching request through without a token', () => {
    const { req, next } = run(guard, {}, { method: 'GET', path: '/open' });
    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toBeUndefined();
  });

  it('still requires a token for every other request, including another method on the same path', () => {
    unauthenticated(run(guard, {}, { method: 'POST', path: '/open' }).next);
    unauthenticated(run(guard, {}, { method: 'GET', path: '/closed' }).next);
  });
});
