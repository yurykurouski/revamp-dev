import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../password.js';

describe('password hashing (REV-206)', () => {
  it('stores scrypt$salt$hash, never the password', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(stored).not.toContain('correct horse');
  });

  it('hashes one password differently every time (random salt)', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });

  it('verifies the right password and rejects a wrong one, including near misses', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterY', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it.each(['', 'plain', 'scrypt$onlysalt', 'scrypt$zz$zz', 'bcrypt$aa$bb'])('rejects a malformed stored value %j without throwing', async (stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });

  it('has a dummy hash in the stored format, for the unknown-email path', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword('anything', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
