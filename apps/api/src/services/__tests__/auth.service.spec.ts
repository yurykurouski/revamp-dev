import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AppError } from '../../middlewares/errorHandler.js';
import { createOrganizationWithOwner } from '../../models/Organization.model.js';
import { OrganizationError, registerWithInvitation } from '../../models/Invitation.model.js';
import { Organization } from '../../models/Organization.model.js';
import { User } from '../../models/User.model.js';
import { Membership } from '../../models/Membership.model.js';
import { hashPassword } from '../password.js';
import { verifySessionToken } from '../token.js';
import { loginUser, getAuthContext, registerUser } from '../auth.service.js';

vi.mock('../../models/Organization.model.js', () => ({
  Organization: { findById: vi.fn() },
  createOrganizationWithOwner: vi.fn(),
}));
vi.mock('../../models/Invitation.model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/Invitation.model.js')>()),
  registerWithInvitation: vi.fn(),
}));
vi.mock('../../models/User.model.js', () => ({ User: { findOne: vi.fn(), findById: vi.fn() } }));
vi.mock('../../models/Membership.model.js', () => ({ Membership: { findOne: vi.fn() } }));

/** A mongoose query double: awaitable, with the chain calls the service uses */
const query = <T>(value: T) => {
  const q: any = { sort: () => q, exec: () => Promise.resolve(value), then: (a: any, b: any) => Promise.resolve(value).then(a, b) };
  return q;
};

const ids = { user: new Types.ObjectId(), org: new Types.ObjectId() };
const userDoc = (passwordHash: string) => ({ _id: ids.user, email: 'owner@studio.test', passwordHash, name: 'Ann' });
const orgDoc = { _id: ids.org, name: 'Pixel Studio' };
const membershipDoc = { userId: ids.user, organizationId: ids.org, role: 'owner' };

describe('registerUser (REV-206)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hashes the password, creates the organization with its owner and returns a signed session', async () => {
    vi.mocked(createOrganizationWithOwner).mockResolvedValue({
      user: userDoc('x'),
      organization: orgDoc,
      membership: membershipDoc,
    } as any);

    const session = await registerUser({ email: 'owner@studio.test', password: 'correct horse battery', organizationName: 'Pixel Studio', name: 'Ann' });

    const input = vi.mocked(createOrganizationWithOwner).mock.calls[0]![0];
    expect(input.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(input)).not.toContain('correct horse battery');
    expect(input).toMatchObject({ email: 'owner@studio.test', organizationName: 'Pixel Studio', name: 'Ann' });
    expect(session.user).toEqual({ id: String(ids.user), email: 'owner@studio.test', name: 'Ann' });
    expect(session.organization).toEqual({ id: String(ids.org), name: 'Pixel Studio' });
    expect(session.role).toBe('owner');
    expect(verifySessionToken(session.token)).toEqual({ userId: String(ids.user), organizationId: String(ids.org), role: 'owner' });
    expect(JSON.stringify(session)).not.toContain('passwordHash');
  });

  it('maps a duplicate email (E11000) to 409 EMAIL_TAKEN', async () => {
    vi.mocked(createOrganizationWithOwner).mockRejectedValue(Object.assign(new Error('dup key'), { code: 11000 }));
    await expect(registerUser({ email: 'a@b.co', password: 'correct horse battery', organizationName: 'X' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
    });
  });

  it('passes any other failure through unchanged', async () => {
    const boom = new Error('mongo down');
    vi.mocked(createOrganizationWithOwner).mockRejectedValue(boom);
    await expect(registerUser({ email: 'a@b.co', password: 'correct horse battery', organizationName: 'X' })).rejects.toBe(boom);
  });
});

describe('loginUser (REV-206)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a session for the right password', async () => {
    const hash = await hashPassword('correct horse battery');
    vi.mocked(User.findOne).mockReturnValue(query(userDoc(hash)) as any);
    vi.mocked(Membership.findOne).mockReturnValue(query(membershipDoc) as any);
    vi.mocked(Organization.findById).mockReturnValue(query(orgDoc) as any);

    const session = await loginUser({ email: 'owner@studio.test', password: 'correct horse battery' });
    expect(session.role).toBe('owner');
    expect(verifySessionToken(session.token)?.userId).toBe(String(ids.user));
    expect(User.findOne).toHaveBeenCalledWith({ email: 'owner@studio.test' });
  });

  it('gives the same 401 INVALID_CREDENTIALS for a wrong password and for an unknown email', async () => {
    const hash = await hashPassword('correct horse battery');
    vi.mocked(User.findOne).mockReturnValueOnce(query(userDoc(hash)) as any);
    const wrongPassword = await loginUser({ email: 'owner@studio.test', password: 'wrong' }).catch((e) => e);
    vi.mocked(User.findOne).mockReturnValueOnce(query(null) as any);
    const unknownEmail = await loginUser({ email: 'nobody@studio.test', password: 'wrong' }).catch((e) => e);

    for (const error of [wrongPassword, unknownEmail]) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    }
    expect(wrongPassword.message).toBe(unknownEmail.message);
  });

  it('refuses a user with no organization, with 401 UNAUTHENTICATED', async () => {
    const hash = await hashPassword('correct horse battery');
    vi.mocked(User.findOne).mockReturnValue(query(userDoc(hash)) as any);
    vi.mocked(Membership.findOne).mockReturnValue(query(null) as any);
    await expect(loginUser({ email: 'owner@studio.test', password: 'correct horse battery' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('getAuthContext (REV-206)', () => {
  beforeEach(() => vi.clearAllMocks());
  const claims = { userId: String(ids.user), organizationId: String(ids.org), role: 'owner' as const };

  it('returns the user, organization and role from the database, without a token', async () => {
    vi.mocked(User.findById).mockReturnValue(query(userDoc('h')) as any);
    vi.mocked(Membership.findOne).mockReturnValue(query(membershipDoc) as any);
    vi.mocked(Organization.findById).mockReturnValue(query(orgDoc) as any);
    const context = await getAuthContext(claims);
    expect(context).toEqual({
      user: { id: String(ids.user), email: 'owner@studio.test', name: 'Ann' },
      organization: { id: String(ids.org), name: 'Pixel Studio' },
      role: 'owner',
    });
    expect(Membership.findOne).toHaveBeenCalledWith({ userId: claims.userId, organizationId: claims.organizationId });
  });

  it.each([
    ['the user is gone', null, membershipDoc, orgDoc],
    ['the membership is gone', userDoc('h'), null, orgDoc],
    ['the organization is gone', userDoc('h'), membershipDoc, null],
  ])('is 401 UNAUTHENTICATED when %s', async (_label, user, membership, org) => {
    vi.mocked(User.findById).mockReturnValue(query(user) as any);
    vi.mocked(Membership.findOne).mockReturnValue(query(membership) as any);
    vi.mocked(Organization.findById).mockReturnValue(query(org) as any);
    await expect(getAuthContext(claims)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
  });
});

describe('registerUser with an invitation (REV-207)', () => {
  beforeEach(() => vi.clearAllMocks());
  const dto = { email: 'ann@studio.test', password: 'correct horse battery', invitationToken: 'tok_123' };

  it('joins the invited organization with the invited role instead of creating one, and returns a session for it', async () => {
    vi.mocked(registerWithInvitation).mockResolvedValue({
      user: userDoc('x'),
      organization: orgDoc,
      membership: { userId: ids.user, organizationId: ids.org, role: 'viewer' },
    } as any);
    const session = await registerUser({ ...dto, name: 'Ann' });
    expect(createOrganizationWithOwner).not.toHaveBeenCalled();
    const input = vi.mocked(registerWithInvitation).mock.calls[0]![0];
    expect(input).toMatchObject({ token: 'tok_123', email: 'ann@studio.test', name: 'Ann' });
    expect(input.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(input)).not.toContain('correct horse battery');
    expect(session.role).toBe('viewer');
    expect(verifySessionToken(session.token)).toEqual({ userId: String(ids.user), organizationId: String(ids.org), role: 'viewer' });
  });

  it('ignores a studio name that came with the token', async () => {
    vi.mocked(registerWithInvitation).mockResolvedValue({ user: userDoc('x'), organization: orgDoc, membership: membershipDoc } as any);
    await registerUser({ ...dto, organizationName: 'Ignored Studio' });
    expect(createOrganizationWithOwner).not.toHaveBeenCalled();
  });

  it.each([
    ['INVITATION_NOT_FOUND', 404],
    ['INVITATION_EXPIRED', 410],
    ['INVITATION_EMAIL_MISMATCH', 403],
  ] as const)('maps %s to %i', async (code, status) => {
    vi.mocked(registerWithInvitation).mockRejectedValue(new OrganizationError(code, 'rule'));
    await expect(registerUser(dto)).rejects.toMatchObject({ statusCode: status, code });
  });

  it('maps a taken email (E11000) to 409 EMAIL_TAKEN', async () => {
    vi.mocked(registerWithInvitation).mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(registerUser(dto)).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
  });

  it('refuses a registration with neither a token nor a studio name', async () => {
    await expect(registerUser({ email: 'a@b.co', password: 'correct horse battery' })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(createOrganizationWithOwner).not.toHaveBeenCalled();
  });
});
