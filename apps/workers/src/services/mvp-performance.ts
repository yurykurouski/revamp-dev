import { IMvpPerformance } from '@revamp/shared-types';
import { MvpPerformanceSchema, sanitizeAuditError } from '@revamp/validation';
import { browserService } from './browser.service.js';
import { NO_LCP_ENTRY, RawVitals, VitalsService } from './vitals.service.js';

/** Reads a page's LCP and layout shifts; the browser service in production, a stub in tests */
export type PageVitalsReader = (url: string) => Promise<RawVitals>;

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url.slice(0, 253);
  } catch {
    return url.slice(0, 253) || 'unknown';
  }
};

/**
 * The published MVP's web vitals (REV-119): the uploaded page loaded on the audit's phone and read by the audit's own
 * reader, scored as the audit scores the original. Advisory: a page that cannot be measured gets its error and no
 * values, never a stand-in number (REV-100), and the publish goes on.
 */
export async function measureMvpPerformance(
  url: string,
  read: PageVitalsReader = (page) => browserService.measurePageVitals(page),
  now: Date = new Date(),
): Promise<IMvpPerformance> {
  const base = { host: hostOf(url), measuredAt: now };
  try {
    const raw = await read(url);
    const cls = VitalsService.calculateCls(raw.shifts);
    if (raw.lcpMs === null) return MvpPerformanceSchema.parse({ ...base, webVitals: { cls }, error: NO_LCP_ENTRY }) as IMvpPerformance;
    const lcp = Math.round(raw.lcpMs);
    const score = VitalsService.calculatePerformanceScore(Math.round((raw.lcpMs / 1000) * 100) / 100, cls);
    return MvpPerformanceSchema.parse({ ...base, webVitals: { lcp, cls }, score }) as IMvpPerformance;
  } catch (error) {
    console.warn(`[MvpPerformance] The published MVP at ${url} was not measured:`, error);
    return { ...base, webVitals: {}, error: sanitizeAuditError(error).slice(0, 300) || 'not measured' };
  }
}
