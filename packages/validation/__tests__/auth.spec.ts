import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, ORGANIZATION_ROLES } from '@revamp/shared-types';
import { LoginSchema, RegisterSchema } from '../src/index.js';

const validRegister = {
  email: 'Owner@Studio.Example',
  password: 'correct horse battery',
  organizationName: '  Pixel Studio ',
};

describe('RegisterSchema (REV-206)', () => {
  it('accepts a valid body, lowercasing the email and trimming names', () => {
    const parsed = RegisterSchema.parse({ ...validRegister, name: ' Ann ' });
    expect(parsed.email).toBe('owner@studio.example');
    expect(parsed.organizationName).toBe('Pixel Studio');
    expect(parsed.name).toBe('Ann');
  });

  it('treats the user name as optional', () => {
    expect(RegisterSchema.safeParse(validRegister).success).toBe(true);
  });

  it.each([
    ['a malformed email', { email: 'not-an-email' }],
    ['a missing email', { email: undefined }],
    ['a password of 9 characters', { password: '123456789' }],
    ['a password of 129 characters', { password: 'x'.repeat(129) }],
    ['an empty organization name', { organizationName: '   ' }],
    ['an organization name over 100 characters', { organizationName: 'x'.repeat(101) }],
    ['a user name over 100 characters', { name: 'x'.repeat(101) }],
  ])('rejects %s', (_label, override) => {
    expect(RegisterSchema.safeParse({ ...validRegister, ...override }).success).toBe(false);
  });

  it('accepts a password of exactly 10 and exactly 128 characters', () => {
    expect(RegisterSchema.safeParse({ ...validRegister, password: 'x'.repeat(10) }).success).toBe(true);
    expect(RegisterSchema.safeParse({ ...validRegister, password: 'x'.repeat(128) }).success).toBe(true);
  });

  it('keeps spaces inside the password', () => {
    expect(RegisterSchema.parse({ ...validRegister, password: '  spaced out pass  ' }).password).toBe(
      '  spaced out pass  ',
    );
  });
});

describe('LoginSchema (REV-206)', () => {
  it('accepts an email and a password and lowercases the email', () => {
    expect(LoginSchema.parse({ email: 'A@B.CO', password: 'x' })).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('does not apply the registration length rule to a login password', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
  });

  it.each([
    ['an empty password', { email: 'a@b.co', password: '' }],
    ['a missing password', { email: 'a@b.co' }],
    ['a malformed email', { email: 'nope', password: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(LoginSchema.safeParse(body).success).toBe(false);
  });
});

describe('auth shared types (REV-206)', () => {
  it('lists the owner role', () => {
    expect(ORGANIZATION_ROLES).toContain('owner');
  });

  it('lists the three auth error codes', () => {
    for (const code of ['UNAUTHENTICATED', 'INVALID_CREDENTIALS', 'EMAIL_TAKEN']) {
      expect(API_ERROR_CODES).toContain(code);
    }
  });
});
