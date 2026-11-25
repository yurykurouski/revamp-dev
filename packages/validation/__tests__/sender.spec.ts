import { describe, expect, it } from 'vitest';
import { StudioSenderSchema } from '../src/index.js';

describe('StudioSenderSchema (REV-221)', () => {
  it('accepts a valid sender, trimming the name and lowercasing the address', () => {
    expect(StudioSenderSchema.parse({ name: '  Pixel Studio ', address: ' Hello@Pixel.Example ' })).toEqual({
      name: 'Pixel Studio',
      address: 'hello@pixel.example',
    });
  });

  it.each([
    ['an empty name', { name: '   ' }],
    ['a name of 101 characters', { name: 'x'.repeat(101) }],
    ['an invalid address', { address: 'not-an-email' }],
    ['a missing address', { address: undefined }],
    ['an address over 320 characters', { address: `${'a'.repeat(320)}@x.test` }],
  ])('rejects %s', (_label, override) => {
    expect(StudioSenderSchema.safeParse({ name: 'Studio', address: 'a@b.test', ...override }).success).toBe(false);
  });

  it('accepts a name of exactly 100 characters', () => {
    expect(StudioSenderSchema.safeParse({ name: 'x'.repeat(100), address: 'a@b.test' }).success).toBe(true);
  });
});
