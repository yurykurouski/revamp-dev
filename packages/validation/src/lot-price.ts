/**
 * Lot price and audit band (REV-231, E3.1).
 *
 * Deterministic: the price is computed from measured audit fields only. No LLM, no randomness, no clock.
 * A signal that was not measured (absent siteEra, failed axe scan, absent standards score, absent LCP) is left
 * out and the remaining weights are renormalized (REV-100); with no signal the price is the floor.
 * Band A is the strongest case for a redesign (the most valuable lot), D the weakest.
 */
import { z } from 'zod';
import { LOT_BANDS, type IAudit, type IAuditScores, type LotBandCode, type NeedLevel } from '@revamp/shared-types';

export const LOT_PRICE_SIGNALS = ['siteEra', 'accessibility', 'standards', 'lcp'] as const;
export type LotPriceSignal = (typeof LOT_PRICE_SIGNALS)[number];

export { LOT_BANDS };
export type LotBand = LotBandCode;
export const LotBandSchema = z.enum(LOT_BANDS);

export { NEED_LEVELS } from '@revamp/shared-types';

/** REV-233: the coarse level of a signal's need (0..1) shown in masked listings: below 1/3 low, below 2/3 medium, else high */
export function needLevel(need: number): NeedLevel {
  if (need < 1 / 3) return 'low';
  if (need < 2 / 3) return 'medium';
  return 'high';
}

const SITE_ERA_SCORE_FULL = 6; // twice SITE_DATED_THRESHOLD
const A11Y_VIOLATIONS_FULL = 20;
const LCP_GOOD_MS = 2500;
const LCP_FULL_MS = 6000;

const BAND_A_MIN = 0.75;
const BAND_B_MIN = 0.5;
const BAND_C_MIN = 0.25;

export interface LotPriceSettings {
  floorCents: number;
  capCents: number;
  currency: string;
  weights: Record<LotPriceSignal, number>;
}

const WeightSchema = z.number().finite().min(0).max(1000);

export const LotPriceSettingsSchema: z.ZodType<LotPriceSettings, z.ZodTypeDef, unknown> = z
  .object({
    floorCents: z.number().int().min(0),
    capCents: z.number().int().min(0),
    currency: z
      .string()
      .transform((c) => c.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code')),
    weights: z
      .object({
        siteEra: WeightSchema,
        accessibility: WeightSchema,
        standards: WeightSchema,
        lcp: WeightSchema,
      })
      .strict(),
  })
  .strict()
  .refine((s) => s.capCents >= s.floorCents, {
    message: 'capCents must be at least floorCents',
    path: ['capCents'],
  })
  .refine((s) => LOT_PRICE_SIGNALS.some((k) => s.weights[k] > 0), {
    message: 'at least one weight must be positive',
    path: ['weights'],
  });

export const DEFAULT_LOT_PRICE_SETTINGS: LotPriceSettings = {
  floorCents: 1500,
  capCents: 9900,
  currency: 'EUR',
  weights: { siteEra: 35, accessibility: 25, standards: 20, lcp: 20 },
};

/** The audit fields the price reads; a Mongoose lean doc or an IAudit fits */
export type PriceableAudit = Pick<IAudit, 'siteEra' | 'a11ySummary' | 'webVitals'> & {
  scores?: Pick<IAuditScores, 'standards'>;
};

export interface LotPriceSignalPart {
  signal: LotPriceSignal;
  value: number;
  need: number;
  weight: number;
}

export interface LotPrice {
  amountCents: number;
  currency: string;
  /** Weighted need in [0, 1]; null when no signal was measured */
  need: number | null;
  /** Measured signals only, in LOT_PRICE_SIGNALS order; `weight` is the renormalized share (sums to 1) */
  signals: LotPriceSignalPart[];
  /** Signals left out because they were not measured or weigh 0 */
  missing: LotPriceSignal[];
}

const roundNeed = (n: number): number => Number(n.toFixed(12));
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function measuredValue(audit: PriceableAudit, signal: LotPriceSignal): number | undefined {
  const raw =
    signal === 'siteEra'
      ? audit.siteEra?.score
      : signal === 'accessibility'
        ? audit.a11ySummary?.violationsCount
        : signal === 'standards'
          ? audit.scores?.standards
          : audit.webVitals?.lcp;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function needOf(signal: LotPriceSignal, value: number): number {
  switch (signal) {
    case 'siteEra':
      return clamp01(value / SITE_ERA_SCORE_FULL);
    case 'accessibility':
      return clamp01(value / A11Y_VIOLATIONS_FULL);
    case 'standards':
      return clamp01((100 - value) / 100);
    case 'lcp':
      return clamp01((value - LCP_GOOD_MS) / (LCP_FULL_MS - LCP_GOOD_MS));
  }
}

export function priceFromAudit(
  audit: PriceableAudit,
  settings: LotPriceSettings = DEFAULT_LOT_PRICE_SETTINGS,
): LotPrice {
  const measured: { signal: LotPriceSignal; value: number; need: number; rawWeight: number }[] = [];
  const missing: LotPriceSignal[] = [];
  for (const signal of LOT_PRICE_SIGNALS) {
    const value = measuredValue(audit, signal);
    const rawWeight = settings.weights[signal];
    if (value === undefined || !(rawWeight > 0)) {
      missing.push(signal);
      continue;
    }
    measured.push({ signal, value, need: needOf(signal, value), rawWeight });
  }

  const totalWeight = measured.reduce((sum, m) => sum + m.rawWeight, 0);
  if (measured.length === 0 || totalWeight <= 0) {
    return { amountCents: settings.floorCents, currency: settings.currency, need: null, signals: [], missing };
  }

  // 12 decimals: 0.1 * 7.5 style float noise must not push a need of exactly 0.75 under the band edge
  const need = roundNeed(clamp01(measured.reduce((sum, m) => sum + m.rawWeight * m.need, 0) / totalWeight));
  const amountCents = settings.floorCents + Math.round((settings.capCents - settings.floorCents) * need);
  return {
    amountCents: Math.min(settings.capCents, Math.max(settings.floorCents, amountCents)),
    currency: settings.currency,
    need,
    signals: measured.map((m) => ({
      signal: m.signal,
      value: m.value,
      need: m.need,
      weight: m.rawWeight / totalWeight,
    })),
    missing,
  };
}

export function lotBandFromNeed(need: number | null): LotBand | undefined {
  if (need === null) return undefined;
  if (need >= BAND_A_MIN) return 'A';
  if (need >= BAND_B_MIN) return 'B';
  if (need >= BAND_C_MIN) return 'C';
  return 'D';
}

export function auditBand(audit: PriceableAudit, settings?: LotPriceSettings): LotBand | undefined {
  return lotBandFromNeed(priceFromAudit(audit, settings).need);
}

/** Reads the LOT_* variables; an empty string counts as unset. Throws a ZodError on a bad value. */
export function lotPriceSettingsFromEnv(env: Record<string, string | undefined>): LotPriceSettings {
  const get = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v === undefined || v === '' ? undefined : v;
  };
  const d = DEFAULT_LOT_PRICE_SETTINGS;
  const num = (name: string, fallback: number): unknown => {
    const v = get(name);
    return v === undefined ? fallback : Number(v);
  };
  return LotPriceSettingsSchema.parse({
    floorCents: num('LOT_PRICE_FLOOR_CENTS', d.floorCents),
    capCents: num('LOT_PRICE_CAP_CENTS', d.capCents),
    currency: get('LOT_CURRENCY') ?? d.currency,
    weights: {
      siteEra: num('LOT_PRICE_WEIGHT_SITE_ERA', d.weights.siteEra),
      accessibility: num('LOT_PRICE_WEIGHT_ACCESSIBILITY', d.weights.accessibility),
      standards: num('LOT_PRICE_WEIGHT_STANDARDS', d.weights.standards),
      lcp: num('LOT_PRICE_WEIGHT_LCP', d.weights.lcp),
    },
  });
}
