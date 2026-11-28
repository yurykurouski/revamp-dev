import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  DEFAULT_LOT_PRICE_SETTINGS,
  LotPriceSettingsSchema,
  auditBand,
  lotBandFromNeed,
  lotPriceSettingsFromEnv,
  priceFromAudit,
  roundToStep,
  type PriceableAudit,
} from '../src/lot-price';

const ALL = ['siteEra', 'accessibility', 'standards', 'lcp'];

function audit(parts: {
  era?: number;
  violations?: number;
  standards?: number;
  lcp?: number;
}): PriceableAudit {
  return {
    webVitals: parts.lcp === undefined ? {} : { lcp: parts.lcp },
    ...(parts.era === undefined ? {} : { siteEra: { dated: true, score: parts.era, signs: [] } }),
    ...(parts.violations === undefined
      ? {}
      : {
          a11ySummary: {
            violationsCount: parts.violations,
            contrastIssuesCount: 0,
            missingAltCount: 0,
            criticalViolations: [],
          },
        }),
    ...(parts.standards === undefined ? {} : { scores: { standards: parts.standards } }),
  };
}

describe('priceFromAudit', () => {
  it('returns the floor and no band when nothing was measured', () => {
    const a = audit({});
    expect(priceFromAudit(a)).toEqual({
      amountCents: 1500,
      currency: 'EUR',
      need: null,
      signals: [],
      missing: ALL,
    });
    expect(auditBand(a)).toBeUndefined();
  });

  it('returns the cap when every signal is at its worst', () => {
    const a = audit({ era: 14, violations: 50, standards: 0, lcp: 9000 });
    const p = priceFromAudit(a);
    expect(p.amountCents).toBe(9900);
    expect(p.need).toBe(1);
    expect(auditBand(a)).toBe('A');
  });

  it('weights the signals by default', () => {
    const a = audit({ era: 3, violations: 0, standards: 100, lcp: 2500 });
    const p = priceFromAudit(a);
    expect(p.need).toBeCloseTo(0.175, 10);
    expect(p.amountCents).toBe(3000);
    expect(auditBand(a)).toBe('D');
    expect(p.signals.map((s) => s.weight).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10);
  });

  it('renormalizes over measured signals', () => {
    const p = priceFromAudit(audit({ era: 6 }));
    expect(p.need).toBe(1);
    expect(p.amountCents).toBe(9900);
    expect(p.signals).toHaveLength(1);
    expect(p.signals[0].weight).toBe(1);
    expect(p.missing).toEqual(['accessibility', 'standards', 'lcp']);
  });

  it('treats a zero measurement as measured', () => {
    const a = audit({ violations: 0 });
    const p = priceFromAudit(a);
    expect(p.need).toBe(0);
    expect(p.amountCents).toBe(1500);
    expect(p.missing).not.toContain('accessibility');
    expect(auditBand(a)).toBe('D');
  });

  it('clamps out-of-range values', () => {
    expect(priceFromAudit(audit({ lcp: 100 })).need).toBe(0);
    expect(priceFromAudit(audit({ standards: 140 })).need).toBe(0);
    expect(priceFromAudit(audit({ standards: -20 })).need).toBe(1);
    for (const a of [audit({ lcp: 100, standards: 140 }), audit({ standards: -20, era: 99, violations: 999 })]) {
      const amount = priceFromAudit(a).amountCents;
      expect(amount).toBeGreaterThanOrEqual(1500);
      expect(amount).toBeLessThanOrEqual(9900);
    }
  });

  it('computes each need exactly', () => {
    expect(priceFromAudit(audit({ lcp: 4250 })).signals[0].need).toBeCloseTo(0.5, 10);
    expect(priceFromAudit(audit({ violations: 10 })).signals[0].need).toBeCloseTo(0.5, 10);
    expect(priceFromAudit(audit({ standards: 70 })).signals[0].need).toBeCloseTo(0.3, 10);
  });

  it('is deterministic', () => {
    const a = audit({ era: 4, violations: 7, standards: 55, lcp: 3800 });
    const first = priceFromAudit(a);
    for (let i = 0; i < 100; i++) expect(priceFromAudit(a)).toEqual(first);
  });

  it('ignores fields it does not read', () => {
    const a = audit({ era: 4, violations: 7, standards: 55, lcp: 3800 });
    const extra = {
      ...a,
      designCritique: { anything: true },
      screenshotUrls: { desktop: 'x' },
      status: 'COMPLETED',
    } as unknown as PriceableAudit;
    expect(priceFromAudit(extra)).toEqual(priceFromAudit(a));
  });

  it('leaves out a signal with weight 0', () => {
    const settings = {
      ...DEFAULT_LOT_PRICE_SETTINGS,
      weights: { siteEra: 0, accessibility: 1, standards: 0, lcp: 0 },
    };
    const p = priceFromAudit(audit({ era: 14, violations: 0 }), settings);
    expect(p.need).toBe(0);
    expect(p.missing).toContain('siteEra');
  });
});

describe('lotBandFromNeed', () => {
  it('bands the need at 0.25, 0.5, 0.75', () => {
    expect(lotBandFromNeed(0.75)).toBe('A');
    expect(lotBandFromNeed(0.7499)).toBe('B');
    expect(lotBandFromNeed(0.5)).toBe('B');
    expect(lotBandFromNeed(0.25)).toBe('C');
    expect(lotBandFromNeed(0.2499)).toBe('D');
    expect(lotBandFromNeed(0)).toBe('D');
    expect(lotBandFromNeed(null)).toBeUndefined();
  });
});

describe('lotPriceSettingsFromEnv', () => {
  it('uses the defaults for an empty env and for empty strings', () => {
    expect(lotPriceSettingsFromEnv({})).toEqual(DEFAULT_LOT_PRICE_SETTINGS);
    expect(lotPriceSettingsFromEnv({ LOT_PRICE_FLOOR_CENTS: '', LOT_CURRENCY: '' })).toEqual(
      DEFAULT_LOT_PRICE_SETTINGS,
    );
  });

  it('reads values and upper-cases the currency', () => {
    const s = lotPriceSettingsFromEnv({ LOT_PRICE_FLOOR_CENTS: '2000', LOT_CURRENCY: 'usd' });
    expect(s.floorCents).toBe(2000);
    expect(s.currency).toBe('USD');
  });

  it('reads the weights', () => {
    const s = lotPriceSettingsFromEnv({ LOT_PRICE_WEIGHT_LCP: '5', LOT_PRICE_WEIGHT_SITE_ERA: '1' });
    expect(s.weights).toEqual({ siteEra: 1, accessibility: 25, standards: 20, lcp: 5 });
  });

  it.each([
    [{ LOT_PRICE_CAP_CENTS: '1000' }],
    [
      {
        LOT_PRICE_WEIGHT_SITE_ERA: '0',
        LOT_PRICE_WEIGHT_ACCESSIBILITY: '0',
        LOT_PRICE_WEIGHT_STANDARDS: '0',
        LOT_PRICE_WEIGHT_LCP: '0',
      },
    ],
    [{ LOT_PRICE_FLOOR_CENTS: '12.5' }],
    [{ LOT_PRICE_FLOOR_CENTS: '-1' }],
    [{ LOT_PRICE_FLOOR_CENTS: 'abc' }],
    [{ LOT_PRICE_WEIGHT_LCP: '-3' }],
    [{ LOT_CURRENCY: 'EURO' }],
  ])('throws for %j', (env) => {
    expect(() => lotPriceSettingsFromEnv(env)).toThrow();
  });
});

describe('LotPriceSettingsSchema', () => {
  it('rejects an unknown key', () => {
    expect(() => LotPriceSettingsSchema.parse({ ...DEFAULT_LOT_PRICE_SETTINGS, extra: 1 })).toThrow();
  });
});

describe('REV-231 follow-ups', () => {
  it('rejects a weight above 1000 (two of 1e308 would sum to Infinity)', () => {
    expect(() =>
      LotPriceSettingsSchema.parse({
        ...DEFAULT_LOT_PRICE_SETTINGS,
        weights: { siteEra: 1e308, accessibility: 1e308, standards: 0, lcp: 0 },
      }),
    ).toThrow(ZodError);
    expect(() => lotPriceSettingsFromEnv({ LOT_PRICE_WEIGHT_LCP: '1001' })).toThrow(ZodError);
  });

  it('trims the currency from the env', () => {
    expect(lotPriceSettingsFromEnv({ LOT_CURRENCY: ' eur ' }).currency).toBe('EUR');
  });

  it('rounds a need of exactly 0.75 that floats under it, so the band is A', () => {
    const settings = {
      ...DEFAULT_LOT_PRICE_SETTINGS,
      weights: { siteEra: 0.1, accessibility: 0.1, standards: 0.1, lcp: 0 },
    };
    const a = audit({ era: 1.5, violations: 20, standards: 0 });
    const raw = (0.1 * (1.5 / 6) + 0.1 * 1 + 0.1 * 1) / (0.1 + 0.1 + 0.1);
    expect(raw).toBeLessThan(0.75);
    const p = priceFromAudit(a, settings);
    expect(p.need).toBe(0.75);
    expect(auditBand(a, settings)).toBe('A');
  });

  it('throws a ZodError naming the failing path', () => {
    const issuePath = (fn: () => unknown): unknown => {
      try {
        fn();
      } catch (e) {
        return (e as ZodError).issues[0]?.path;
      }
      return undefined;
    };
    expect(issuePath(() => lotPriceSettingsFromEnv({ LOT_PRICE_CAP_CENTS: '1000' }))).toEqual(['capCents']);
    expect(
      issuePath(() =>
        lotPriceSettingsFromEnv({
          LOT_PRICE_WEIGHT_SITE_ERA: '0',
          LOT_PRICE_WEIGHT_ACCESSIBILITY: '0',
          LOT_PRICE_WEIGHT_STANDARDS: '0',
          LOT_PRICE_WEIGHT_LCP: '0',
        }),
      ),
    ).toEqual(['weights']);
  });
});

describe('price step (REV-233)', () => {
  it('roundToStep rounds to the nearest multiple, half up', () => {
    expect(roundToStep(2749, 500)).toBe(2500);
    expect(roundToStep(2750, 500)).toBe(3000);
    expect(roundToStep(2970, 1)).toBe(2970);
  });

  it('a step of 1 reproduces the exact price', () => {
    const a = audit({ era: 3, violations: 0, standards: 100, lcp: 2500 });
    expect(priceFromAudit(a, { ...DEFAULT_LOT_PRICE_SETTINGS, stepCents: 1 }).amountCents).toBe(2970);
  });

  it('keeps need, signals and band from the unrounded need, and the clamp wins over the step (cap 9900)', () => {
    const a = audit({ era: 14, violations: 50, standards: 0, lcp: 9000 });
    expect(priceFromAudit(a).amountCents).toBe(9900);
    const b = audit({ era: 3, violations: 0, standards: 100, lcp: 2500 });
    expect(priceFromAudit(b).need).toBeCloseTo(0.175, 10);
  });

  it('the no-signal price stays exactly the floor even when the floor is not a multiple', () => {
    const s = { ...DEFAULT_LOT_PRICE_SETTINGS, floorCents: 1234 };
    expect(priceFromAudit(audit({}), s).amountCents).toBe(1234);
  });

  it('defaults to 500 and reads LOT_PRICE_STEP_CENTS', () => {
    expect(DEFAULT_LOT_PRICE_SETTINGS.stepCents).toBe(500);
    expect(lotPriceSettingsFromEnv({ LOT_PRICE_STEP_CENTS: '' }).stepCents).toBe(500);
    expect(lotPriceSettingsFromEnv({ LOT_PRICE_STEP_CENTS: '100' }).stepCents).toBe(100);
  });

  it.each(['0', '-5', '1.5', '10001', 'abc'])('rejects LOT_PRICE_STEP_CENTS=%s', (v) => {
    expect(() => lotPriceSettingsFromEnv({ LOT_PRICE_STEP_CENTS: v })).toThrow(ZodError);
  });
});
