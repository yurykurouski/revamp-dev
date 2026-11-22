import supertest from 'supertest';
import { signSessionToken } from '../../services/token.js';

const token = signSessionToken({
  userId: '5eed00000000000000000001',
  organizationId: '5eed00000000000000000002',
  role: 'owner',
});

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
