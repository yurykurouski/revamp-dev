import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOT_PRICE_SETTINGS,
  LotPriceSettingsSchema,
  auditBand,
  lotBandFromNeed,
  lotPriceSettingsFromEnv,
  priceFromAudit,
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
    expect(p.amountCents).toBe(2970);
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
