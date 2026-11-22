import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ORGANIZATION_ROLES,
  canManageMembers,
  canWrite,
  type OrganizationRole,
} from '@revamp/shared-types';
import { ChangeMemberRoleSchema, CreateInvitationSchema, RegisterSchema } from '../src/index.js';

describe('roles (REV-207)', () => {
  it('lists owner, operator and viewer', () => {
    expect([...ORGANIZATION_ROLES]).toEqual(['owner', 'operator', 'viewer']);
  });

  it.each<[OrganizationRole, boolean, boolean]>([
    ['owner', true, true],
    ['operator', true, false],
    ['viewer', false, false],
  ])('%s: write=%s, manage members=%s', (role, write, manage) => {
    expect(canWrite(role)).toBe(write);
    expect(canManageMembers(role)).toBe(manage);
  });

  it.each([undefined, null, '', 'admin', 'OWNER'])('canWrite and canManageMembers are false for %j', (role) => {
    expect(canWrite(role as never)).toBe(false);
    expect(canManageMembers(role as never)).toBe(false);
  });

  it('lists the error codes of members and invitations', () => {
    for (const code of [
      'FORBIDDEN',
      'ALREADY_MEMBER',
      'LAST_OWNER',
      'MEMBER_NOT_FOUND',
      'INVITATION_NOT_FOUND',
      'INVITATION_EXPIRED',
      'INVITATION_EMAIL_MISMATCH',
    ]) {
      expect(API_ERROR_CODES).toContain(code);
    }
  });
});

describe('CreateInvitationSchema (REV-207)', () => {
  it('accepts an email and a role, lowercasing the email', () => {
    expect(CreateInvitationSchema.parse({ email: ' Ann@Studio.Test ', role: 'operator' })).toEqual({
      email: 'ann@studio.test',
      role: 'operator',
    });
  });

  it.each(['owner', 'operator', 'viewer'])('accepts the role %s', (role) => {
    expect(CreateInvitationSchema.safeParse({ email: 'a@b.co', role }).success).toBe(true);
  });

  it.each([
    ['an unknown role', { email: 'a@b.co', role: 'admin' }],
    ['no role', { email: 'a@b.co' }],
    ['a malformed email', { email: 'nope', role: 'viewer' }],
    ['no email', { role: 'viewer' }],
  ])('rejects %s', (_label, body) => {
    expect(CreateInvitationSchema.safeParse(body).success).toBe(false);
  });
});

describe('ChangeMemberRoleSchema (REV-207)', () => {
  it('accepts every role', () => {
    for (const role of ORGANIZATION_ROLES) expect(ChangeMemberRoleSchema.parse({ role })).toEqual({ role });
  });

  it.each([{}, { role: 'admin' }, { role: '' }])('rejects %j', (body) => {
    expect(ChangeMemberRoleSchema.safeParse(body).success).toBe(false);
  });
});

describe('RegisterSchema with an invitation (REV-207)', () => {
  const base = { email: 'ann@studio.test', password: 'correct horse battery' };

  it('does not need a studio name when it carries an invitation token', () => {
    const parsed = RegisterSchema.parse({ ...base, invitationToken: 'abc_DEF-123' });
    expect(parsed.invitationToken).toBe('abc_DEF-123');
    expect(parsed.organizationName).toBeUndefined();
  });

  it('still needs a studio name without a token', () => {
    expect(RegisterSchema.safeParse(base).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...base, organizationName: '  ' }).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...base, organizationName: 'Pixel' }).success).toBe(true);
  });

  it.each(['', 'has space', 'x'.repeat(129), 'bad/slash'])('rejects the token %j', (token) => {
    expect(RegisterSchema.safeParse({ ...base, invitationToken: token }).success).toBe(false);
  });
});
