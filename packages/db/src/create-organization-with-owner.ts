import mongoose from 'mongoose';
import { Organization, type IOrganizationDocument } from './models/Organization.model.js';
import { User, type IUserDocument } from './models/User.model.js';
import { Membership, type IMembershipDocument } from './models/Membership.model.js';

export interface NewOrganizationOwner {
  email: string;
  passwordHash: string;
  name?: string;
  organizationName: string;
}

/**
 * Registration (REV-206): inserts the organization, its first user and the owner membership in one
 * transaction, so a failed insert never leaves a user without an organization. A second registration
 * of an existing email fails with E11000 from the unique index on `users.email`; the caller maps it
 * to EMAIL_TAKEN. Needs a replica set, like `createLeadWithAudit`.
 */
export async function createOrganizationWithOwner(
  input: NewOrganizationOwner,
): Promise<{ organization: IOrganizationDocument; user: IUserDocument; membership: IMembershipDocument }> {
  let created:
    | { organization: IOrganizationDocument; user: IUserDocument; membership: IMembershipDocument }
    | undefined;
  await mongoose.connection.transaction(async (session) => {
    const [user] = await User.create(
      [{ email: input.email, passwordHash: input.passwordHash, ...(input.name ? { name: input.name } : {}) }],
      { session },
    );
    const [organization] = await Organization.create([{ name: input.organizationName }], { session });
    const [membership] = await Membership.create(
      [{ userId: user!._id, organizationId: organization!._id, role: 'owner' }],
      { session },
    );
    created = { organization: organization!, user: user!, membership: membership! };
  });
  return created!;
}
