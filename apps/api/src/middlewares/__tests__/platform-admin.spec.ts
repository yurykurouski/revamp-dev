import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePlatformAdminEmails } from '../../config/env.js';
import { User } from '../../models/User.model.js';
import { createPlatformAdminGuard, isPlatformAdmin } from '../requireAuth.js';

vi.mock('../../services/membership.service.js', () => ({ findMembershipRole: vi.fn() }));
vi.mock('../../models/User.model.js', () => ({ User: { findById: vi.fn() } }));

const lookup = (email: string | null) =>
  vi.mocked(User.findById).mockReturnValue({
    lean: () => ({ exec: async () => (email === null ? null : { email }) }),
  } as never);

const run = async (guard: ReturnType<typeof createPlatformAdminGuard>, auth: unknown = { userId: 'u1', organizationId: 'o1', role: 'owner' }) => {
  let next!: ReturnType<typeof vi.fn>;
  await new Promise<void>((resolve) => {
    next = vi.fn(() => resolve());
    guard({ auth: auth ?? undefined } as unknown as Request, {} as Response, next as unknown as NextFunction);
  });
  return next;
};

describe('parsePlatformAdminEmails and isPlatformAdmin (REV-232)', () => {
  it('trims, lowercases and drops empty entries', () => {
    expect([...parsePlatformAdminEmails(' Admin@X.test , b@x.test,, ')]).toEqual(['admin@x.test', 'b@x.test']);
  });

  it('an empty variable makes nobody an admin', () => {
    const none = parsePlatformAdminEmails('');
    expect(none.size).toBe(0);
    expect(isPlatformAdmin('admin@x.test', none)).toBe(false);
    expect(parsePlatformAdminEmails('  ,  ').size).toBe(0);
  });

  it('matches whatever the case and the spaces of the email', () => {
    const admins = parsePlatformAdminEmails(' Admin@X.test ');
    expect(isPlatformAdmin('admin@x.test', admins)).toBe(true);
    expect(isPlatformAdmin(' ADMIN@x.TEST ', admins)).toBe(true);
    expect(isPlatformAdmin('admin@x.test.evil', admins)).toBe(false);
    expect(isPlatformAdmin(undefined, admins)).toBe(false);
    expect(isPlatformAdmin(null, admins)).toBe(false);
  });
});

describe('requirePlatformAdmin (REV-232)', () => {
  beforeEach(() => vi.mocked(User.findById).mockReset());

  it('lets a listed user through', async () => {
    lookup('admin@x.test');
    const next = await run(createPlatformAdminGuard(parsePlatformAdminEmails(' Admin@X.test ')));
    expect(next).toHaveBeenCalledWith();
    expect(User.findById).toHaveBeenCalledWith('u1', { email: 1 });
  });

  it('refuses a user who is not listed with 403 FORBIDDEN', async () => {
    lookup('owner@studio.test');
    const next = await run(createPlatformAdminGuard(parsePlatformAdminEmails('admin@x.test')));
    expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('refuses a user who no longer exists', async () => {
    lookup(null);
    const next = await run(createPlatformAdminGuard(parsePlatformAdminEmails('admin@x.test')));
    expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 403 });
  });

  it('refuses everyone, without a database read, when the list is empty', async () => {
    lookup('admin@x.test');
    const next = await run(createPlatformAdminGuard(parsePlatformAdminEmails('')));
    expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('answers 401 when the guard runs before requireAuth', async () => {
    const next = await run(createPlatformAdminGuard(parsePlatformAdminEmails('admin@x.test')), null);
    expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
  });

  it('passes a database error on', async () => {
    vi.mocked(User.findById).mockReturnValue({ lean: () => ({ exec: async () => Promise.reject(new Error('mongo down')) }) } as never);
    const next = await run(createPlatformAdminGuard(parsePlatformAdminEmails('admin@x.test')));
    expect(next.mock.calls[0]![0]).toBeInstanceOf(Error);
  });
});
