import { describe, it, expect } from 'vitest';
import { SITE_COMPLEXITY_CLASSES } from '@revamp/shared-types';
import {
  GetLeadsQuerySchema,
  SiteComplexityClassSchema,
  SiteComplexitySchema,
  SiteComplexitySignalsSchema,
} from '../src/index.js';

const validSignals = {
  internalPageCount: 1,
  internalPages: ['/galeria'],
  hasEcommerce: false,
  hasBooking: false,
  hasLogin: false,
  hasSearch: false,
  hasAppShell: false,
  sectionCount: 6,
  pageHeight: 4800,
};

describe('Site complexity schemas (REV-38)', () => {
  it('accepts every shared complexity class and nothing else', () => {
    for (const cls of SITE_COMPLEXITY_CLASSES) {
      expect(SiteComplexityClassSchema.parse(cls)).toBe(cls);
    }
    expect(SiteComplexityClassSchema.safeParse('one_page_brochure').success).toBe(false);
    expect(SiteComplexityClassSchema.safeParse('').success).toBe(false);
  });

  it('accepts a full complexity result and one without signals', () => {
    expect(
      SiteComplexitySchema.parse({ class: 'ONE_PAGE_BROCHURE', signals: validSignals, reasons: ['internal_pages:1'] }),
    ).toMatchObject({ class: 'ONE_PAGE_BROCHURE' });
    expect(SiteComplexitySchema.safeParse({ class: 'UNKNOWN', reasons: ['signals_unavailable'] }).success).toBe(true);
  });

  it('rejects negative or fractional counts and missing flags', () => {
    expect(SiteComplexitySignalsSchema.safeParse({ ...validSignals, internalPageCount: -1 }).success).toBe(false);
    expect(SiteComplexitySignalsSchema.safeParse({ ...validSignals, sectionCount: 1.5 }).success).toBe(false);
    expect(SiteComplexitySignalsSchema.safeParse({ ...validSignals, pageHeight: -1 }).success).toBe(false);
    const withoutFlag: Partial<typeof validSignals> = { ...validSignals };
    delete withoutFlag.hasEcommerce;
    expect(SiteComplexitySignalsSchema.safeParse(withoutFlag).success).toBe(false);
  });

  it('caps the listed pages at 20 and reasons at 20', () => {
    const pages = Array.from({ length: 21 }, (_, i) => `/p${i}`);
    expect(SiteComplexitySignalsSchema.safeParse({ ...validSignals, internalPages: pages }).success).toBe(false);
    expect(SiteComplexitySignalsSchema.safeParse({ ...validSignals, internalPages: pages.slice(0, 20) }).success).toBe(
      true,
    );
    expect(
      SiteComplexitySchema.safeParse({ class: 'COMPLEX', reasons: Array.from({ length: 21 }, () => 'x') }).success,
    ).toBe(false);
  });
});

describe('GetLeadsQuerySchema (REV-38)', () => {
  it('accepts an empty query', () => {
    expect(GetLeadsQuerySchema.parse({})).toEqual({});
  });

  it('coerces paging and keeps the complexity filter', () => {
    expect(GetLeadsQuerySchema.parse({ page: '2', limit: '50', complexity: 'ONE_PAGE_BROCHURE', niche: 'dental' })).toEqual(
      { page: 2, limit: 50, complexity: 'ONE_PAGE_BROCHURE', niche: 'dental' },
    );
  });

  it('treats empty parameters as missing', () => {
    expect(GetLeadsQuerySchema.parse({ complexity: '', status: '', page: '' })).toEqual({});
  });

  it('rejects unknown complexity classes and out-of-range paging', () => {
    expect(GetLeadsQuerySchema.safeParse({ complexity: 'HUGE' }).success).toBe(false);
    expect(GetLeadsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(GetLeadsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(GetLeadsQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });

  it('accepts the 100-lead page limit boundary', () => {
    expect(GetLeadsQuerySchema.parse({ limit: '100' })).toEqual({ limit: 100 });
  });
});
