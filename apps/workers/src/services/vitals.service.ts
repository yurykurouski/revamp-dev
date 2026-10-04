import { Page } from 'playwright';
import { IMeasurementError, IStandardsChecks, IWebVitals, STANDARDS_CHECKS, STANDARDS_POINTS } from '@revamp/shared-types';
import { sanitizeAuditError } from '@revamp/validation';
import { RawStandards, readStandardsInDocument } from './standards.page.js';

export { STANDARDS_POINTS };
export type { RawStandards };

/**
 * What the vitals collection measured. A measurement that failed leaves its values out and is listed
 * in `errors` instead; nothing is filled in with a stand-in value (REV-100)
 */
export interface VitalsAuditResult {
  lcpSeconds?: number;
  webVitals: IWebVitals;
  standards?: IStandardsChecks;
  performanceScore?: number;
  standardsScore?: number;
  errors: IMeasurementError[];
}

/** Reason recorded when the page produced no LCP entry */
export const NO_LCP_ENTRY = 'The page reported no largest-contentful-paint entry';

/** A layout-shift entry as read in the page */
export interface RawLayoutShift {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
}

export interface RawVitals {
  lcpMs: number | null;
  shifts: RawLayoutShift[];
}

/** How long the `/favicon.ico` probe may take; a site that does not answer by then has no favicon */
const FAVICON_PROBE_TIMEOUT_MS = 3000;

/** Core Web Vitals session window: shifts less than 1 s apart, at most 5 s long */
const CLS_SESSION_GAP_MS = 1000;
const CLS_SESSION_MAX_MS = 5000;

export class VitalsService {
  /**
   * CLS as defined by Core Web Vitals: the largest session window of layout shifts that were
   * not caused by recent user input, rounded to 3 decimals
   */
  static calculateCls(shifts: RawLayoutShift[]): number {
    let max = 0;
    let current = 0;
    let windowStart = 0;
    let previous = 0;

    const sorted = shifts.filter((s) => !s.hadRecentInput).sort((a, b) => a.startTime - b.startTime);
    for (const shift of sorted) {
      const startsNewWindow =
        current === 0 ||
        shift.startTime - previous >= CLS_SESSION_GAP_MS ||
        shift.startTime - windowStart >= CLS_SESSION_MAX_MS;
      if (startsNewWindow) {
        current = 0;
        windowStart = shift.startTime;
      }
      current += shift.value;
      previous = shift.startTime;
      max = Math.max(max, current);
    }

    return Math.round(max * 1000) / 1000;
  }

  /**
   * Calculates performance score (0 - 100) based on Core Web Vitals (LCP, CLS)
   */
  static calculatePerformanceScore(lcpSeconds: number, cls: number): number {
    let score = 100;

    // LCP evaluation (Google CWV thresholds: <=2.5s Good, <=4.0s Needs Improvement, >4.0s Poor)
    if (lcpSeconds <= 1.8) {
      score -= 0;
    } else if (lcpSeconds <= 2.5) {
      score -= 10;
    } else if (lcpSeconds <= 4.0) {
      score -= 35;
    } else {
      score -= 60;
    }

    // CLS evaluation (Google CWV thresholds: <=0.1 Good, <=0.25 Needs Improvement, >0.25 Poor)
    if (cls <= 0.1) {
      score -= 0;
    } else if (cls <= 0.25) {
      score -= 15;
    } else {
      score -= 30;
    }

    return Math.max(10, Math.min(100, Math.round(score)));
  }

  /**
   * Standards score (0 - 100): the points of every check the page passes (`STANDARDS_POINTS`)
   */
  static calculateStandardsScore(checks: IStandardsChecks): number {
    return STANDARDS_CHECKS.reduce((score, check) => score + (checks[check] ? STANDARDS_POINTS[check] : 0), 0);
  }

  /**
   * Whether the site serves `/favicon.ico`, which browsers request when the page links no icon.
   * A redirect is followed; an HTML page (a soft 404) or an error status is not a favicon
   */
  static async probeFaviconIco(page: Page, targetUrl: string): Promise<boolean> {
    try {
      const response = await page.request.get(new URL('/favicon.ico', targetUrl).toString(), {
        timeout: FAVICON_PROBE_TIMEOUT_MS,
        failOnStatusCode: false,
      });
      const contentType = response.headers()['content-type'] ?? '';
      const found = response.ok() && !contentType.includes('text/html') && (await response.body()).length > 0;
      await response.dispose();
      return found;
    } catch {
      // No answer within the timeout or a refused connection: the browser would show no icon either
      return false;
    }
  }

  /**
   * LCP and layout shifts as the page reports them, through buffered PerformanceObservers; shared by the audit and the
   * published MVP's measurement (REV-119), so both pages are read alike
   */
  static readVitalsInPage(page: Page): Promise<RawVitals> {
    return page.evaluate(
      () =>
        new Promise<RawVitals>((resolve) => {
          // LCP and layout-shift entries are not in the performance timeline (getEntriesByType
          // returns none); only a buffered PerformanceObserver receives them (REV-99)
          let lcpMs: number | null = null;
          const shifts: RawLayoutShift[] = [];

          const readLcp = (entries: PerformanceEntryList) => {
            const last = entries[entries.length - 1];
            if (last) lcpMs = last.startTime;
          };
          const readShifts = (entries: PerformanceEntryList) => {
            for (const entry of entries) {
              const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
              shifts.push({
                startTime: shift.startTime,
                value: typeof shift.value === 'number' ? shift.value : 0,
                hadRecentInput: !!shift.hadRecentInput,
              });
            }
          };

          const lcpObserver = new PerformanceObserver((list) => readLcp(list.getEntries()));
          const clsObserver = new PerformanceObserver((list) => readShifts(list.getEntries()));
          lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
          clsObserver.observe({ type: 'layout-shift', buffered: true });

          // Buffered entries are delivered on a later task; collect whatever is still queued
          setTimeout(() => {
            readLcp(lcpObserver.takeRecords());
            readShifts(clsObserver.takeRecords());
            lcpObserver.disconnect();
            clsObserver.disconnect();

            resolve({ lcpMs, shifts });
          }, 50);
        }),
    );
  }

  /**
   * Collects Core Web Vitals and Standards metrics from an active Playwright page
   */
  async collectVitals(page: Page, targetUrl: string): Promise<VitalsAuditResult> {
    const hasSsl = targetUrl.toLowerCase().startsWith('https://');

    try {
      const evaluation = await VitalsService.readVitalsInPage(page);

      // The same reader checks the published MVP (REV-118)
      const { faviconLink, ...domChecks } = await page.evaluate(readStandardsInDocument, undefined);
      const standards: IStandardsChecks = {
        https: hasSsl,
        ...domChecks,
        // Probed on the page's final origin, after any redirect
        favicon: faviconLink || (await VitalsService.probeFaviconIco(page, page.url() || targetUrl)),
      };
      const cls = VitalsService.calculateCls(evaluation.shifts);
      const result: VitalsAuditResult = {
        webVitals: { cls },
        standards,
        standardsScore: VitalsService.calculateStandardsScore(standards),
        errors: [],
      };

      // Without an LCP the performance score cannot be computed; no other timing stands in for it
      if (evaluation.lcpMs === null) {
        result.errors.push({ measurement: 'performance', message: NO_LCP_ENTRY });
        return result;
      }

      const lcpMs = evaluation.lcpMs;
      const lcpSeconds = Math.round((lcpMs / 1000) * 100) / 100;
      result.lcpSeconds = lcpSeconds;
      result.webVitals = { lcp: Math.round(lcpMs), cls };
      result.performanceScore = VitalsService.calculatePerformanceScore(lcpSeconds, cls);
      return result;
    } catch (err) {
      console.warn('[VitalsService] Error evaluating performance metrics:', err);
      // Neither performance nor the page's standards were read; both are reported as not measured
      const message = sanitizeAuditError(err);
      return {
        webVitals: {},
        errors: [
          { measurement: 'performance', message },
          { measurement: 'standards', message },
        ],
      };
    }
  }
}

export const vitalsService = new VitalsService();
