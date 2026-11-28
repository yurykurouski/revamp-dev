import { describe, expect, it } from 'vitest';
import { AdminLotsQuerySchema, CreateLotSchema, CreatePlatformAuditSchema, OpenLotSchema } from '../src/index';

const ok = { url: 'https://example.com', businessName: 'Example', niche: 'other', city: 'Vilnius' };

describe('CreatePlatformAuditSchema', () => {
  it('accepts a valid body and trims', () => {
    expect(CreatePlatformAuditSchema.parse({ ...ok, city: ' Vilnius ' }).city).toBe('Vilnius');
  });
  it.each([
    [{ url: 'example.com' }],
    [{ url: 'ftp://example.com' }],
    [{ city: '' }],
    [{ city: '   ' }],
    [{ businessName: 'x'.repeat(101) }],
    [{ niche: 'plumber' }],
  ])('rejects %j', (patch) => {
    expect(CreatePlatformAuditSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
  it('accepts a 100-character name', () => {
    expect(CreatePlatformAuditSchema.safeParse({ ...ok, businessName: 'x'.repeat(100) }).success).toBe(true);
  });
});

describe('CreateLotSchema', () => {
  it('accepts an ObjectId and rejects others', () => {
    expect(CreateLotSchema.safeParse({ businessId: 'a'.repeat(24) }).success).toBe(true);
    expect(CreateLotSchema.safeParse({ businessId: 'abc' }).success).toBe(false);
    expect(CreateLotSchema.safeParse({}).success).toBe(false);
  });
});

describe('OpenLotSchema', () => {
  it('accepts no body fields or an ISO datetime', () => {
    expect(OpenLotSchema.safeParse({}).success).toBe(true);
    expect(OpenLotSchema.safeParse({ releaseAt: '2026-12-01T10:00:00.000Z' }).success).toBe(true);
  });
  it('rejects a non-ISO date', () => {
    expect(OpenLotSchema.safeParse({ releaseAt: 'tomorrow' }).success).toBe(false);
  });
});

describe('AdminLotsQuerySchema', () => {
  it('defaults page and limit', () => {
    expect(AdminLotsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });
  it('rejects a limit of 101, page 0 and an unknown status', () => {
    expect(AdminLotsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(AdminLotsQuerySchema.safeParse({ limit: '100' }).success).toBe(true);
    expect(AdminLotsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(AdminLotsQuerySchema.safeParse({ status: 'SPOILED' }).success).toBe(false);
  });
  it('accepts a known status', () => {
    expect(AdminLotsQuerySchema.parse({ status: 'OPEN' }).status).toBe('OPEN');
  });
});
