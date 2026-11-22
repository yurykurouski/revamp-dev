import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });

/** `scrypt$<salt hex>$<key hex>` with a random salt, so one password never hashes the same twice (REV-206) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Constant-time check; a malformed stored value is simply "no match", never an exception */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, saltHex, keyHex] = stored.split('$');
  if (prefix !== PREFIX || !saltHex || !keyHex || !/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(keyHex)) {
    return false;
  }
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(actual, expected);
}

/**
 * A valid hash of a password nobody knows. Login verifies against it when the email is unknown, so an
 * unknown email costs as much time as a wrong password and the response time does not reveal accounts.
 */
export const DUMMY_PASSWORD_HASH = `${PREFIX}$${'00'.repeat(SALT_BYTES)}$${'00'.repeat(KEY_LENGTH)}`;
