import supertest from 'supertest';
import { vi } from 'vitest';
import type { OrganizationRole } from '@revamp/shared-types';
import { signSessionToken } from '../../services/token.js';

const token = signSessionToken({
  userId: '5eed00000000000000000001',
  organizationId: '5eed00000000000000000002',
  role: 'owner',
});

/**
 * The role the mocked membership lookup returns (REV-207); `requireAuth` reads the role from the database, never from
 * the token. Route specs mock the lookup with `vi.mock('../../services/membership.service.js', () =>
 * membershipServiceMock())` and pick a role with `setMemberRole`.
 */
const state: { role: OrganizationRole | null } = { role: 'owner' };
export const setMemberRole = (role: OrganizationRole | null): void => {
  state.role = role;
};
export const membershipServiceMock = () => ({ findMembershipRole: vi.fn(async () => state.role) });

type Target = Parameters<typeof supertest>[0];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * `request(server)` that sends a valid session token with every call (REV-206), so the route tests keep testing
 * their routes. Tests of the sign-in itself use plain supertest.
 */
export const authedRequest = (target: Target) => {
  const agent = supertest(target);
  return Object.fromEntries(
    METHODS.map((method) => [method, (url: string) => agent[method](url).set('Authorization', `Bearer ${token}`)]),
  ) as Record<(typeof METHODS)[number], (url: string) => supertest.Test>;
};
