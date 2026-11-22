import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AppError } from '../../middlewares/errorHandler.js';
import {
  OrganizationError,
  acceptInvitationAsMember,
  changeMemberRole,
  createInvitation,
  findInvitation,
  listOrganizationMembers,
  removeMember,
  revokeInvitation,
} from '../../models/Invitation.model.js';
import { User } from '../../models/User.model.js';
import { verifySessionToken } from '../token.js';
import {
  acceptInvitation,
  changeRole,
  inviteMember,
  listMembers,
  previewInvitation,
  removeFromOrganization,
  revokePendingInvitation,
} from '../organization.service.js';

vi.mock('../../models/Invitation.model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/Invitation.model.js')>()),
  acceptInvitationAsMember: vi.fn(),
  changeMemberRole: vi.fn(),
  createInvitation: vi.fn(),
  findInvitation: vi.fn(),
  listOrganizationMembers: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock('../../models/User.model.js', () => ({ User: { findById: vi.fn() } }));

const auth = { userId: '5eed00000000000000000001', organizationId: '5eed00000000000000000002', role: 'owner' as const };
const query = <T>(value: T) => ({ exec: () => Promise.resolve(value), then: (a: never, b: never) => Promise.resolve(value).then(a, b) });

const ERRORS: [ConstructorParameters<typeof OrganizationError>[0], number, string][] = [
  ['ALREADY_MEMBER', 409, 'ALREADY_MEMBER'],
  ['LAST_OWNER', 409, 'LAST_OWNER'],
  ['MEMBER_NOT_FOUND', 404, 'MEMBER_NOT_FOUND'],
  ['INVITATION_NOT_FOUND', 404, 'INVITATION_NOT_FOUND'],
  ['INVITATION_EXPIRED', 410, 'INVITATION_EXPIRED'],
  ['INVITATION_EMAIL_MISMATCH', 403, 'INVITATION_EMAIL_MISMATCH'],
];

describe('organization service (REV-207)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the members and pending invitations of the caller organization', async () => {
    const list = { members: [], invitations: [] };
    vi.mocked(listOrganizationMembers).mockResolvedValue(list);
    await expect(listMembers(auth)).resolves.toBe(list);
    expect(listOrganizationMembers).toHaveBeenCalledWith(auth.organizationId);
  });

  it('invites into the caller organization, recording who invited', async () => {
    const created = { invitation: { id: 'i1', email: 'a@b.co', role: 'viewer' as const, expiresAt: 'x', createdAt: 'y' }, token: 't'.repeat(43) };
    vi.mocked(createInvitation).mockResolvedValue(created);
    await expect(inviteMember(auth, { email: 'a@b.co', role: 'viewer' })).resolves.toBe(created);
    expect(createInvitation).toHaveBeenCalledWith({ organizationId: auth.organizationId, email: 'a@b.co', role: 'viewer', invitedBy: auth.userId });
  });

  it.each(ERRORS)('maps %s to %i %s', async (code, status, apiCode) => {
    vi.mocked(createInvitation).mockRejectedValue(new OrganizationError(code, 'rule not met'));
    const error = await inviteMember(auth, { email: 'a@b.co', role: 'viewer' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: status, code: apiCode, message: 'rule not met' });
  });

  it('passes any other failure through unchanged', async () => {
    const boom = new Error('mongo down');
    vi.mocked(changeMemberRole).mockRejectedValue(boom);
    await expect(changeRole(auth, auth.userId, { role: 'viewer' })).rejects.toBe(boom);
  });

  it('revokes a pending invitation of the caller organization, and says INVITATION_NOT_FOUND when there is none', async () => {
    vi.mocked(revokeInvitation).mockResolvedValueOnce(true);
    await expect(revokePendingInvitation(auth, 'inv1')).resolves.toBeUndefined();
    expect(revokeInvitation).toHaveBeenCalledWith({ organizationId: auth.organizationId, invitationId: 'inv1' });
    vi.mocked(revokeInvitation).mockResolvedValueOnce(false);
    await expect(revokePendingInvitation(auth, 'inv2')).rejects.toMatchObject({ statusCode: 404, code: 'INVITATION_NOT_FOUND' });
  });

  it('changes a role and removes a member inside the caller organization only', async () => {
    vi.mocked(changeMemberRole).mockResolvedValue({ role: 'operator' } as never);
    await expect(changeRole(auth, 'u2', { role: 'operator' })).resolves.toBeUndefined();
    expect(changeMemberRole).toHaveBeenCalledWith({ organizationId: auth.organizationId, userId: 'u2', role: 'operator' });
    await removeFromOrganization(auth, 'u3');
    expect(removeMember).toHaveBeenCalledWith({ organizationId: auth.organizationId, userId: 'u3' });
  });

  it('previews an invitation for the join page without ids or the organization id', async () => {
    vi.mocked(findInvitation).mockResolvedValue({
      id: 'i1',
      email: 'ann@studio.test',
      role: 'operator',
      expiresAt: '2026-12-01T00:00:00.000Z',
      createdAt: '2026-11-24T00:00:00.000Z',
      organizationId: 'o1',
      organizationName: 'Pixel Studio',
    });
    await expect(previewInvitation('tok')).resolves.toEqual({
      organizationName: 'Pixel Studio',
      email: 'ann@studio.test',
      role: 'operator',
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('maps an unknown invitation on the preview', async () => {
    vi.mocked(findInvitation).mockRejectedValue(new OrganizationError('INVITATION_NOT_FOUND', 'nope'));
    await expect(previewInvitation('x')).rejects.toMatchObject({ statusCode: 404, code: 'INVITATION_NOT_FOUND' });
  });

  describe('acceptInvitation', () => {
    const orgId = new Types.ObjectId();
    it('joins the signed-in user with their own email and returns a session for the invited organization', async () => {
      vi.mocked(User.findById).mockReturnValue(query({ _id: auth.userId, email: 'ann@studio.test', name: 'Ann' }) as never);
      vi.mocked(acceptInvitationAsMember).mockResolvedValue({
        organization: { _id: orgId, name: 'Pixel Studio' },
        membership: { role: 'viewer' },
      } as never);
      const session = await acceptInvitation(auth, 'tok');
      expect(acceptInvitationAsMember).toHaveBeenCalledWith({ token: 'tok', userId: auth.userId, userEmail: 'ann@studio.test' });
      expect(session).toMatchObject({ role: 'viewer', organization: { id: String(orgId), name: 'Pixel Studio' }, user: { email: 'ann@studio.test' } });
      expect(verifySessionToken(session.token)).toEqual({ userId: auth.userId, organizationId: String(orgId), role: 'viewer' });
    });

    it('is 401 when the signed-in user no longer exists', async () => {
      vi.mocked(User.findById).mockReturnValue(query(null) as never);
      await expect(acceptInvitation(auth, 'tok')).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
      expect(acceptInvitationAsMember).not.toHaveBeenCalled();
    });

    it('maps a mismatch and a used invitation', async () => {
      vi.mocked(User.findById).mockReturnValue(query({ _id: auth.userId, email: 'bob@studio.test' }) as never);
      vi.mocked(acceptInvitationAsMember).mockRejectedValueOnce(new OrganizationError('INVITATION_EMAIL_MISMATCH', 'other address'));
      await expect(acceptInvitation(auth, 'tok')).rejects.toMatchObject({ statusCode: 403, code: 'INVITATION_EMAIL_MISMATCH' });
      vi.mocked(acceptInvitationAsMember).mockRejectedValueOnce(new OrganizationError('INVITATION_EXPIRED', 'used'));
      await expect(acceptInvitation(auth, 'tok')).rejects.toMatchObject({ statusCode: 410, code: 'INVITATION_EXPIRED' });
    });
  });
});
