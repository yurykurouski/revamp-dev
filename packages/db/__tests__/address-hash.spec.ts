import { describe, it, expect } from 'vitest';
import { hashAddress } from '../src/address-hash.js';

describe('hashAddress (REV-224)', () => {
  it('normalizes case and surrounding whitespace', () => {
    expect(hashAddress(' Owner@Example.COM ')).toBe(hashAddress('owner@example.com'));
  });

  it('is 64 lowercase hex characters', () => {
    expect(hashAddress('owner@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different addresses', () => {
    expect(hashAddress('a@example.com')).not.toBe(hashAddress('b@example.com'));
  });

  it('never contains the address', () => {
    expect(hashAddress('owner@example.com')).not.toContain('owner');
  });
});
