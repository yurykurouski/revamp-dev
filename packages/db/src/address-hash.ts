import { createHash } from 'node:crypto';

/**
 * REV-224: an opted-out address is kept only as this hash, so the suppression list holds no personal data. This is the
 * one place that normalizes an address (trim, lowercase); every writer and reader of `SuppressedAddress` goes through it.
 */
export function hashAddress(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
