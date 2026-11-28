import { describe, expect, it } from 'vitest';
import { LotListingQuerySchema, MaskedLotSchema, needLevel } from '../src/index';

const item = {
  id: 'a'.repeat(24),
  niche: 'dental',
  city: 'Vilnius',
  band: 'B',
  priceCents: 12000,
  currency: 'EUR',
  releaseAt: '2026-11-28T10:00:00.000Z',
  signals: [{ signal: 'siteEra', level: 'high' }],
};

describe('needLevel', () => {
  it.each([
    [0, 'low'],
    [0.3333, 'low'],
    [1 / 3, 'medium'],
    [0.6666, 'medium'],
    [2 / 3, 'high'],
    [1, 'high'],
  ])('%s -> %s', (need, level) => {
    expect(needLevel(need)).toBe(level);
  });
});

describe('MaskedLotSchema', () => {
  it('accepts a full valid item', () => {
    expect(MaskedLotSchema.safeParse(item).success).toBe(true);
  });
  it.each(['businessId', 'auditId', 'businessName', 'domain', 'need', 'status'])('rejects the extra key %s', (key) => {
    expect(MaskedLotSchema.safeParse({ ...item, [key]: 'x' }).success).toBe(false);
  });
  it('rejects a signal with a value', () => {
    expect(MaskedLotSchema.safeParse({ ...item, signals: [{ signal: 'lcp', level: 'low', value: 4200 }] }).success).toBe(false);
  });
  it('rejects an unknown signal, level or band', () => {
    expect(MaskedLotSchema.safeParse({ ...item, signals: [{ signal: 'x', level: 'low' }] }).success).toBe(false);
    expect(MaskedLotSchema.safeParse({ ...item, signals: [{ signal: 'lcp', level: 'extreme' }] }).success).toBe(false);
    expect(MaskedLotSchema.safeParse({ ...item, band: 'E' }).success).toBe(false);
  });
});

describe('LotListingQuerySchema', () => {
  it('defaults page and limit', () => {
    expect(LotListingQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
  });
  it.each([[{ limit: '51' }], [{ limit: '0' }], [{ page: '0' }], [{ band: 'E' }], [{ niche: 'cars' }], [{ city: 'x'.repeat(101) }]])(
    'rejects %j',
    (q) => {
      expect(LotListingQuerySchema.safeParse(q).success).toBe(false);
    },
  );
  it('trims the city and treats an empty one as absent', () => {
    expect(LotListingQuerySchema.parse({ city: '  Vilnius ' }).city).toBe('Vilnius');
    expect(LotListingQuerySchema.parse({ city: '' }).city).toBeUndefined();
    expect(LotListingQuerySchema.parse({ band: '', niche: '' })).toMatchObject({ page: 1, limit: 20 });
  });
  it('accepts filters and coerces numbers', () => {
    expect(LotListingQuerySchema.parse({ niche: 'auto', band: 'A', page: '2', limit: '50' })).toMatchObject({
      niche: 'auto',
      band: 'A',
      page: 2,
      limit: 50,
    });
  });
});
