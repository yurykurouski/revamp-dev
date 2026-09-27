import { describe, it, expect } from 'vitest';
import { leadComplexity } from '../siteComplexity.js';

describe('site complexity helpers (REV-38)', () => {
  it('reads a missing class as UNKNOWN', () => {
    expect(leadComplexity({})).toBe('UNKNOWN');
    expect(leadComplexity({ siteComplexity: 'COMPLEX' })).toBe('COMPLEX');
  });
});
