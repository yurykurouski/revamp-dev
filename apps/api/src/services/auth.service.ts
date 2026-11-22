import type { IAuthContext, IAuthSession } from '@revamp/shared-types';
import type { LoginDto, RegisterDto } from '@revamp/validation';
import { AppError } from '../middlewares/errorHandler.js';
import { Membership } from '../models/Membership.model.js';
import { registerWithInvitation } from '../models/Invitation.model.js';
import { Organization, createOrganizationWithOwner } from '../models/Organization.model.js';
import { User } from '../models/User.model.js';
import { mapOrganizationError } from './organization-errors.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.js';
import { signSessionToken, type SessionClaims } from './token.js';

interface AccountDocs {
  user: { _id: unknown; email: string; name?: string };
  organization: { _id: unknown; name: string };
  membership: { role: IAuthContext['role'] };
}

const toContext = ({ user, organization, membership }: AccountDocs): IAuthContext => ({
  user: { id: String(user._id), email: user.email, ...(user.name ? { name: user.name } : {}) },
  organization: { id: String(organization._id), name: organization.name },
  role: membership.role,
});

export const toSession = (docs: AccountDocs): IAuthSession => {
  const context = toContext(docs);
  return {
    ...context,
    token: signSessionToken({ userId: context.user.id, organizationId: context.organization.id, role: context.role }),
  };
};

const unauthenticated = (message: string): AppError => new AppError(401, 'UNAUTHENTICATED', message);

/**
 * REV-206: a new user and the organization they own; a second registration of an email is 409 EMAIL_TAKEN.
 * REV-207: with an invitation token the user joins the invited organization with the invited role instead, and the
 * studio name is ignored.
 */
export async function registerUser(dto: RegisterDto): Promise<IAuthSession> {
  if (!dto.invitationToken && !dto.organizationName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'organizationName is required');
  }
  const passwordHash = await hashPassword(dto.password);
  try {
    const created = dto.invitationToken
      ? await registerWithInvitation({
          token: dto.invitationToken,
          email: dto.email,
          passwordHash,
          ...(dto.name ? { name: dto.name } : {}),
        })
      : await createOrganizationWithOwner({
          email: dto.email,
          passwordHash,
          organizationName: dto.organizationName!,
          ...(dto.name ? { name: dto.name } : {}),
        });
    return toSession(created);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    return mapOrganizationError(error);
  }
}

/**
 * A wrong password and an unknown email give the same 401 after the same hashing work, so the response
 * reveals nothing about which accounts exist. The token carries the user's oldest membership.
 */
export async function loginUser(dto: LoginDto): Promise<IAuthSession> {
  const user = await User.findOne({ email: dto.email }).exec();
  const passwordMatches = await verifyPassword(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const membership = await Membership.findOne({ userId: user._id }).sort({ createdAt: 1 }).exec();
  const organization = membership ? await Organization.findById(membership.organizationId).exec() : null;
  if (!membership || !organization) throw unauthenticated('This account does not belong to an organization');
  return toSession({ user, organization, membership });
}

/** The current user, organization and role, read from the database (a removed user or membership is 401) */
export async function getAuthContext(claims: SessionClaims): Promise<IAuthContext> {
  const [user, membership, organization] = await Promise.all([
    User.findById(claims.userId).exec(),
    Membership.findOne({ userId: claims.userId, organizationId: claims.organizationId }).exec(),
    Organization.findById(claims.organizationId).exec(),
  ]);
  if (!user || !membership || !organization) throw unauthenticated('The session is no longer valid');
  return toContext({ user, organization, membership });
}
