import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { signSessionToken, verifySessionToken, SESSION_TTL_SECONDS } from '../token.js';

const claims = { userId: '5eed00000000000000000001', organizationId: '5eed00000000000000000002', role: 'owner' as const };

describe('session token (REV-206)', () => {
  it('round-trips the user, the organization and the role', () => {
    expect(verifySessionToken(signSessionToken(claims))).toEqual(claims);
  });

  it('expires in 7 days', () => {
    const payload = jwt.decode(signSessionToken(claims)) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
    expect(SESSION_TTL_SECONDS).toBe(7 * 24 * 3600);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ sub: claims.userId, org: claims.organizationId, role: 'owner' }, env.JWT_SECRET, {
      expiresIn: -10,
    });
    expect(verifySessionToken(expired)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ sub: claims.userId, org: claims.organizationId, role: 'owner' }, 'x'.repeat(40));
    expect(verifySessionToken(forged)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signSessionToken(claims).split('.');
    const payload = Buffer.from(JSON.stringify({ sub: 'other', org: claims.organizationId, role: 'owner' })).toString('base64url');
    expect(verifySessionToken(`${header}.${payload}.${signature}`)).toBeNull();
  });

  it('rejects an unsigned token (alg none)', () => {
    const none = jwt.sign({ sub: claims.userId, org: claims.organizationId, role: 'owner' }, '', { algorithm: 'none' });
    expect(verifySessionToken(none)).toBeNull();
  });

  it('rejects a token with an unknown role or missing claims', () => {
    expect(verifySessionToken(jwt.sign({ sub: claims.userId, org: claims.organizationId, role: 'admin' }, env.JWT_SECRET))).toBeNull();
    expect(verifySessionToken(jwt.sign({ sub: claims.userId }, env.JWT_SECRET))).toBeNull();
  });

  it.each(['', 'garbage', 'a.b.c'])('rejects %j', (token) => {
    expect(verifySessionToken(token)).toBeNull();
  });
});
