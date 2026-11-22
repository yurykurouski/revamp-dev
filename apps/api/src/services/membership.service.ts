import type { OrganizationRole } from '@revamp/shared-types';
import { Membership } from '../models/Membership.model.js';

/** The role this user has in this organization right now, or null when they are not a member (REV-207) */
export async function findMembershipRole(userId: string, organizationId: string): Promise<OrganizationRole | null> {
  const membership = await Membership.findOne({ userId, organizationId }, { role: 1 }).lean();
  return membership?.role ?? null;
}
