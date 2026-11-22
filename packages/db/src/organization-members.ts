import { createHash, randomBytes } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import type { IInvitation, IOrganizationMember, IOrganizationMembers, OrganizationRole } from '@revamp/shared-types';
import { Invitation, type IInvitationDocument } from './models/Invitation.model.js';
import { Membership, type IMembershipDocument } from './models/Membership.model.js';
import { Organization, type IOrganizationDocument } from './models/Organization.model.js';
import { User, type IUserDocument } from './models/User.model.js';

// REV-207: invitations and members. Every function that changes data runs in one transaction, like
// `createOrganizationWithOwner`, so a half-done join or a lost owner cannot be saved.

export type OrganizationErrorCode =
  | 'ALREADY_MEMBER'
  | 'LAST_OWNER'
  | 'MEMBER_NOT_FOUND'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_EMAIL_MISMATCH';

/** A rule of members and invitations that was not met; the API maps `code` to its error code */
export class OrganizationError extends Error {
  constructor(
    public readonly code: OrganizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OrganizationError';
  }
}

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

type Id = Types.ObjectId | string;

export const hashInvitationToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** 32 random bytes, URL-safe: 43 characters */
export const generateInvitationToken = (): string => randomBytes(32).toString('base64url');

const toInvitation = (doc: Pick<IInvitationDocument, 'email' | 'role' | 'expiresAt' | 'createdAt'> & { _id: unknown }): IInvitation => ({
  id: String(doc._id),
  email: doc.email,
  role: doc.role,
  expiresAt: doc.expiresAt.toISOString(),
  createdAt: doc.createdAt.toISOString(),
});

/**
 * Creates an invitation and returns its one-time token. An older pending invitation for the same organization and
 * address is revoked, so only the newest link works. An address that already belongs to a member is ALREADY_MEMBER.
 */
export async function createInvitation(input: {
  organizationId: Id;
  email: string;
  role: OrganizationRole;
  invitedBy: Id;
  now?: Date;
}): Promise<{ invitation: IInvitation; token: string }> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const token = generateInvitationToken();
  let created: IInvitation | undefined;
  await mongoose.connection.transaction(async (session) => {
    // Serializes with other member changes of this organization, so two invitations for one address cannot both survive
    await lockMembers(session, input.organizationId);
    const existing = await User.findOne({ email }, { _id: 1 }, { session }).lean();
    if (existing && (await Membership.exists({ userId: existing._id, organizationId: input.organizationId }).session(session))) {
      throw new OrganizationError('ALREADY_MEMBER', 'This address already belongs to a member');
    }
    await Invitation.updateMany(
      { organizationId: input.organizationId, email, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: now } },
      { session },
    );
    const [doc] = await Invitation.create(
      [
        {
          organizationId: input.organizationId,
          email,
          role: input.role,
          tokenHash: hashInvitationToken(token),
          invitedBy: input.invitedBy,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
      ],
      { session },
    );
    created = toInvitation(doc!);
  });
  return { invitation: created!, token };
}

const isUsable = (doc: IInvitationDocument, now: Date): boolean => !doc.acceptedAt && !doc.revokedAt && doc.expiresAt.getTime() > now.getTime();

/** The invitation behind a token, for the join page: NOT_FOUND for an unknown token, EXPIRED for an expired, used or revoked one */
export async function findInvitation(
  token: string,
  now: Date = new Date(),
): Promise<IInvitation & { organizationId: string; organizationName: string }> {
  const doc = await Invitation.findOne({ tokenHash: hashInvitationToken(token) });
  if (!doc) throw new OrganizationError('INVITATION_NOT_FOUND', 'This invitation does not exist');
  if (!isUsable(doc, now)) throw new OrganizationError('INVITATION_EXPIRED', 'This invitation has expired or was already used');
  const organization = await Organization.findById(doc.organizationId);
  if (!organization) throw new OrganizationError('INVITATION_NOT_FOUND', 'This invitation does not exist');
  return { ...toInvitation(doc), organizationId: String(doc.organizationId), organizationName: organization.name };
}

/** Inside a transaction: the usable invitation for this address, claimed (marked used) atomically */
async function claimInvitation(session: ClientSession, token: string, email: string, now: Date): Promise<IInvitationDocument> {
  const tokenHash = hashInvitationToken(token);
  const existing = await Invitation.findOne({ tokenHash }, null, { session });
  if (!existing) throw new OrganizationError('INVITATION_NOT_FOUND', 'This invitation does not exist');
  if (!isUsable(existing, now)) throw new OrganizationError('INVITATION_EXPIRED', 'This invitation has expired or was already used');
  if (existing.email !== email.trim().toLowerCase()) {
    throw new OrganizationError('INVITATION_EMAIL_MISMATCH', 'This invitation is for another email address');
  }
  // The filter repeats the checks: of two racing claims only one still matches after the other's write
  const claimed = await Invitation.findOneAndUpdate(
    { _id: existing._id, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { acceptedAt: now } },
    { session, new: true },
  );
  if (!claimed) throw new OrganizationError('INVITATION_EXPIRED', 'This invitation has expired or was already used');
  return claimed;
}

const isDuplicateKey = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === 11000;

/** A signed-in user joins the invited organization with the invited role; the invitation must be for their address */
export async function acceptInvitationAsMember(input: {
  token: string;
  userId: Id;
  userEmail: string;
  now?: Date;
}): Promise<{ organization: IOrganizationDocument; membership: IMembershipDocument }> {
  const now = input.now ?? new Date();
  let result: { organization: IOrganizationDocument; membership: IMembershipDocument } | undefined;
  await mongoose.connection.transaction(async (session) => {
    const invitation = await claimInvitation(session, input.token, input.userEmail, now);
    const organization = await Organization.findById(invitation.organizationId, null, { session });
    if (!organization) throw new OrganizationError('INVITATION_NOT_FOUND', 'This invitation does not exist');
    try {
      const [membership] = await Membership.create(
        [{ userId: input.userId, organizationId: invitation.organizationId, role: invitation.role }],
        { session },
      );
      result = { organization, membership: membership! };
    } catch (error) {
      if (isDuplicateKey(error)) throw new OrganizationError('ALREADY_MEMBER', 'You already belong to this organization');
      throw error;
    }
  });
  return result!;
}

/**
 * A new user joins the invited organization with the invited role, in one transaction. A taken address fails with
 * E11000 from the unique index on `users.email` and leaves the invitation usable.
 */
export async function registerWithInvitation(input: {
  token: string;
  email: string;
  passwordHash: string;
  name?: string;
  now?: Date;
}): Promise<{ organization: IOrganizationDocument; user: IUserDocument; membership: IMembershipDocument }> {
  const now = input.now ?? new Date();
  let result: { organization: IOrganizationDocument; user: IUserDocument; membership: IMembershipDocument } | undefined;
  await mongoose.connection.transaction(async (session) => {
    const invitation = await claimInvitation(session, input.token, input.email, now);
    const organization = await Organization.findById(invitation.organizationId, null, { session });
    if (!organization) throw new OrganizationError('INVITATION_NOT_FOUND', 'This invitation does not exist');
    const [user] = await User.create(
      [{ email: input.email, passwordHash: input.passwordHash, ...(input.name ? { name: input.name } : {}) }],
      { session },
    );
    const [membership] = await Membership.create(
      [{ userId: user!._id, organizationId: invitation.organizationId, role: invitation.role }],
      { session },
    );
    result = { organization, user: user!, membership: membership! };
  });
  return result!;
}

/**
 * Inside a transaction: writes the organization document first. Two transactions that change the members of one
 * organization then conflict on that write and the second one retries after the first has committed, so the
 * "is this the last owner" count below never reads a state that the other change is about to invalidate.
 */
async function lockMembers(session: ClientSession, organizationId: Id): Promise<void> {
  const locked = await Organization.updateOne({ _id: organizationId }, { $inc: { __v: 1 } }, { session });
  if (locked.matchedCount === 0) throw new OrganizationError('MEMBER_NOT_FOUND', 'This organization has no such member');
}

async function ownersLeftAfterLeaving(session: ClientSession, organizationId: Id, membership: IMembershipDocument): Promise<number> {
  const owners = await Membership.countDocuments({ organizationId, role: 'owner' }, { session });
  return membership.role === 'owner' ? owners - 1 : owners;
}

/** Changes a member's role; demoting the last owner is LAST_OWNER */
export async function changeMemberRole(input: { organizationId: Id; userId: Id; role: OrganizationRole }): Promise<IMembershipDocument> {
  let changed: IMembershipDocument | undefined;
  await mongoose.connection.transaction(async (session) => {
    await lockMembers(session, input.organizationId);
    const membership = await Membership.findOne({ organizationId: input.organizationId, userId: input.userId }, null, { session });
    if (!membership) throw new OrganizationError('MEMBER_NOT_FOUND', 'This organization has no such member');
    if (membership.role === 'owner' && input.role !== 'owner' && (await ownersLeftAfterLeaving(session, input.organizationId, membership)) < 1) {
      throw new OrganizationError('LAST_OWNER', 'An organization needs at least one owner');
    }
    membership.role = input.role;
    changed = await membership.save({ session });
  });
  return changed!;
}

/** Removes a member from the organization (the user account stays); removing the last owner is LAST_OWNER */
export async function removeMember(input: { organizationId: Id; userId: Id }): Promise<void> {
  await mongoose.connection.transaction(async (session) => {
    await lockMembers(session, input.organizationId);
    const membership = await Membership.findOne({ organizationId: input.organizationId, userId: input.userId }, null, { session });
    if (!membership) throw new OrganizationError('MEMBER_NOT_FOUND', 'This organization has no such member');
    if (membership.role === 'owner' && (await ownersLeftAfterLeaving(session, input.organizationId, membership)) < 1) {
      throw new OrganizationError('LAST_OWNER', 'An organization needs at least one owner');
    }
    await membership.deleteOne({ session });
  });
}

/** Revokes a pending invitation of this organization; false when there is none (unknown, used or already revoked) */
export async function revokeInvitation(input: { organizationId: Id; invitationId: Id; now?: Date }): Promise<boolean> {
  const result = await Invitation.updateOne(
    { _id: input.invitationId, organizationId: input.organizationId, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: input.now ?? new Date() } },
  );
  return result.modifiedCount === 1;
}

/** The members of an organization with their user, and its pending (unused, unrevoked, unexpired) invitations */
export async function listOrganizationMembers(organizationId: Id, now: Date = new Date()): Promise<IOrganizationMembers> {
  const [memberships, invitations] = await Promise.all([
    Membership.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    Invitation.find({ organizationId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 }).lean(),
  ]);
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }, { email: 1, name: 1 }).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const members: IOrganizationMember[] = memberships.flatMap((m) => {
    const user = byId.get(String(m.userId));
    if (!user) return [];
    return [{ userId: String(m.userId), email: user.email, ...(user.name ? { name: user.name } : {}), role: m.role, joinedAt: m.createdAt.toISOString() }];
  });
  return { members, invitations: invitations.map((i) => toInvitation(i)) };
}
