import { canManageMembers, canWrite, type OrganizationRole } from '@revamp/shared-types';
import { useAuthStore } from '../store/useAuthStore.js';

export interface Permissions {
  role: OrganizationRole | undefined;
  /** May change data: add leads, run discovery, generate and edit MVPs, approve, reject, send test email */
  canWrite: boolean;
  /** May invite, remove and change the role of members */
  canManageMembers: boolean;
}

/**
 * What the signed-in role may do (REV-207). The dashboard only hides what the API would refuse anyway (403
 * FORBIDDEN); the API is the gate. Signed out, nothing is allowed.
 */
export function usePermissions(): Permissions {
  const role = useAuthStore((s) => s.session?.role);
  return { role, canWrite: canWrite(role), canManageMembers: canManageMembers(role) };
}
