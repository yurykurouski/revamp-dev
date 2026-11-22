import jwt from 'jsonwebtoken';
import { ORGANIZATION_ROLES, type OrganizationRole } from '@revamp/shared-types';
import { env } from '../config/env.js';

/** A session lasts 7 days; there is no refresh token and no server-side logout (REV-206) */
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionClaims {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign({ sub: claims.userId, org: claims.organizationId, role: claims.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** The claims of a valid, unexpired token signed with our secret, otherwise null; never throws */
export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string') return null;
    const { sub, org, role } = payload as { sub?: unknown; org?: unknown; role?: unknown };
    if (typeof sub !== 'string' || typeof org !== 'string') return null;
    if (!(ORGANIZATION_ROLES as readonly unknown[]).includes(role)) return null;
    return { userId: sub, organizationId: org, role: role as OrganizationRole };
  } catch {
    return null;
  }
}
