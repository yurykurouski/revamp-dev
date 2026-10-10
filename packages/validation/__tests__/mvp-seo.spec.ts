import { describe, expect, it } from 'vitest';
import { STANDARDS_CHECKS, STANDARDS_POINTS } from '@revamp/shared-types';
import { MvpSeoSchema, MvpStandardsSchema } from '../src/index';

const ALL = Object.fromEntries(STANDARDS_CHECKS.map((check) => [check, true])) as Record<(typeof STANDARDS_CHECKS)[number], boolean>;

describe('STANDARDS_POINTS (REV-118)', () => {
  it('has points for every check, adding up to 100', () => {
    expect(Object.keys(STANDARDS_POINTS).sort()).toEqual([...STANDARDS_CHECKS].sort());
    expect(Object.values(STANDARDS_POINTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('MvpStandardsSchema (REV-118)', () => {
  it('accepts every check with the score of the passed ones', () => {
    expect(MvpStandardsSchema.safeParse({ checks: ALL, score: 100 }).success).toBe(true);
    expect(MvpStandardsSchema.safeParse({ checks: { ...ALL, https: false }, score: 80 }).success).toBe(true);
    expect(MvpStandardsSchema.safeParse({ checks: Object.fromEntries(STANDARDS_CHECKS.map((c) => [c, false])), score: 0 }).success).toBe(true);
  });

  it('rejects a score that is not the points of the passed checks', () => {
    expect(MvpStandardsSchema.safeParse({ checks: ALL, score: 90 }).success).toBe(false);
  });

  it('rejects a missing or non-boolean check, and a score out of range', () => {
    const missing: Partial<typeof ALL> = { ...ALL };
    delete missing.singleH1;
    expect(MvpStandardsSchema.safeParse({ checks: missing, score: 90 }).success).toBe(false);
    expect(MvpStandardsSchema.safeParse({ checks: { ...ALL, title: 'yes' }, score: 100 }).success).toBe(false);
    expect(MvpStandardsSchema.safeParse({ checks: ALL, score: 101 }).success).toBe(false);
  });
});

describe('MvpSeoSchema (REV-118)', () => {
  it('accepts the tags, all optional', () => {
    expect(MvpSeoSchema.safeParse({}).success).toBe(true);
    expect(
      MvpSeoSchema.safeParse({
        description: 'Gabinet',
        image: 'https://x.pl/og.jpg',
        locale: 'pl_PL',
        localBusiness: { name: 'Falco', url: 'https://x.pl', telephone: '+48 1', email: 'a@x.pl', address: 'ul. 1', sameAs: ['https://fb.com/x'] },
      }).success,
    ).toBe(true);
  });

  it('rejects a description over 160 characters, a non-http image or profile, a bad locale and an invalid email', () => {
    expect(MvpSeoSchema.safeParse({ description: 'x'.repeat(161) }).success).toBe(false);
    expect(MvpSeoSchema.safeParse({ description: '' }).success).toBe(false);
    expect(MvpSeoSchema.safeParse({ image: 'javascript:alert(1)' }).success).toBe(false);
    expect(MvpSeoSchema.safeParse({ locale: 'pl-PL' }).success).toBe(false);
    expect(MvpSeoSchema.safeParse({ localBusiness: { name: 'X', sameAs: ['data:x'] } }).success).toBe(false);
    expect(MvpSeoSchema.safeParse({ localBusiness: { name: 'X', email: 'nope', sameAs: [] } }).success).toBe(false);
    expect(MvpSeoSchema.safeParse({ localBusiness: { name: '', sameAs: [] } }).success).toBe(false);
  });
});
