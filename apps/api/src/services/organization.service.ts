import type {
  IAuthSession,
  ICreatedInvitation,
  IInvitationPreview,
  IOrganizationMembers,
} from '@revamp/shared-types';
import type { ChangeMemberRoleDto, CreateInvitationDto } from '@revamp/validation';
import { AppError } from '../middlewares/errorHandler.js';
import {
  acceptInvitationAsMember,
  changeMemberRole,
  createInvitation,
  findInvitation,
  listOrganizationMembers,
  removeMember,
  revokeInvitation,
} from '../models/Invitation.model.js';
import { User } from '../models/User.model.js';
import { toSession } from './auth.service.js';
import { mapOrganizationError } from './organization-errors.js';
import type { SessionClaims } from './token.js';

// REV-207: members and invitations of the caller's organization. Every function acts on `auth.organizationId`, never on
// an id from the request, so an owner can only manage their own organization.

export async function listMembers(auth: SessionClaims): Promise<IOrganizationMembers> {
  return listOrganizationMembers(auth.organizationId);
}

export async function inviteMember(auth: SessionClaims, dto: CreateInvitationDto): Promise<ICreatedInvitation> {
  try {
    return await createInvitation({
      organizationId: auth.organizationId,
      email: dto.email,
      role: dto.role,
      invitedBy: auth.userId,
    });
  } catch (error) {
    return mapOrganizationError(error);
  }
}

export async function revokePendingInvitation(auth: SessionClaims, invitationId: string): Promise<void> {
  const revoked = await revokeInvitation({ organizationId: auth.organizationId, invitationId });
  if (!revoked) throw new AppError(404, 'INVITATION_NOT_FOUND', 'There is no pending invitation with this id');
}

export async function changeRole(auth: SessionClaims, userId: string, dto: ChangeMemberRoleDto): Promise<void> {
  try {
    await changeMemberRole({ organizationId: auth.organizationId, userId, role: dto.role });
  } catch (error) {
    mapOrganizationError(error);
  }
}

export async function removeFromOrganization(auth: SessionClaims, userId: string): Promise<void> {
  try {
    await removeMember({ organizationId: auth.organizationId, userId });
  } catch (error) {
    mapOrganizationError(error);
  }
}

/** What the public join page shows for a token: the studio, the address and the role, nothing else */
export async function previewInvitation(token: string): Promise<IInvitationPreview> {
  try {
    const invitation = await findInvitation(token);
    return {
      organizationName: invitation.organizationName,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  } catch (error) {
    return mapOrganizationError(error);
  }
}

/** A signed-in user joins the invited organization (their own email must match); returns a session for it */
export async function acceptInvitation(auth: SessionClaims, token: string): Promise<IAuthSession> {
  const user = await User.findById(auth.userId).exec();
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'The session is no longer valid');
  try {
    const { organization, membership } = await acceptInvitationAsMember({ token, userId: auth.userId, userEmail: user.email });
    return toSession({ user, organization, membership });
  } catch (error) {
    return mapOrganizationError(error);
  }
}
