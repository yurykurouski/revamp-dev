import { describe, it, expect } from 'vitest';
import { leadComplexity, matchesComplexityFilter } from '../siteComplexity.js';

describe('site complexity helpers (REV-38)', () => {
  it('reads a missing class as UNKNOWN', () => {
    expect(leadComplexity({})).toBe('UNKNOWN');
    expect(leadComplexity({ siteComplexity: 'COMPLEX' })).toBe('COMPLEX');
  });

  it('matches every lead when no filter or ALL is selected', () => {
    expect(matchesComplexityFilter({ siteComplexity: 'COMPLEX' }, undefined)).toBe(true);
    expect(matchesComplexityFilter({}, 'ALL')).toBe(true);
  });

  it('matches only the selected class', () => {
    expect(matchesComplexityFilter({ siteComplexity: 'ONE_PAGE_BROCHURE' }, 'ONE_PAGE_BROCHURE')).toBe(true);
    expect(matchesComplexityFilter({ siteComplexity: 'SMALL_MULTI_PAGE' }, 'ONE_PAGE_BROCHURE')).toBe(false);
    expect(matchesComplexityFilter({}, 'ONE_PAGE_BROCHURE')).toBe(false);
  });

  it('matches leads audited before REV-38 when filtering on UNKNOWN', () => {
    expect(matchesComplexityFilter({}, 'UNKNOWN')).toBe(true);
    expect(matchesComplexityFilter({ siteComplexity: 'UNKNOWN' }, 'UNKNOWN')).toBe(true);
    expect(matchesComplexityFilter({ siteComplexity: 'COMPLEX' }, 'UNKNOWN')).toBe(false);
  });
});
