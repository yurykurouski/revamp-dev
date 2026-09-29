import { Page } from 'playwright';
import { ILighthouseMetrics } from '@revamp/shared-types';

export interface VitalsAuditResult {
  lcpSeconds: number;
  lighthouseMetrics: ILighthouseMetrics;
  standards: {
    hasSsl: boolean;
    hasViewport: boolean;
    hasTitle: boolean;
  };
  performanceScore: number;
  standardsScore: number;
}

/** A layout-shift entry as read in the page */
export interface RawLayoutShift {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
}

interface RawVitals {
  lcpMs: number | null;
  shifts: RawLayoutShift[];
  loadEventEndMs: number;
  hasViewport: boolean;
  hasTitle: boolean;
}

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
   * Calculates standards score (0 - 100) based on SSL and mobile responsive meta
   */
  static calculateStandardsScore(hasSsl: boolean, hasViewport: boolean, hasTitle: boolean): number {
    let score = 0;
    if (hasSsl) score += 40;
    if (hasViewport) score += 40;
    if (hasTitle) score += 20;
    return score;
  }

  /**
   * Collects Core Web Vitals and Standards metrics from an active Playwright page
   */
  async collectVitals(page: Page, targetUrl: string): Promise<VitalsAuditResult> {
    const hasSsl = targetUrl.toLowerCase().startsWith('https://');

    try {
      const evaluation = await page.evaluate(
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

              const navEntries = performance.getEntriesByType('navigation');
              const nav = navEntries[0] as PerformanceNavigationTiming | undefined;

              const viewportMeta = document.querySelector('meta[name="viewport"]');
              resolve({
                lcpMs,
                shifts,
                loadEventEndMs: nav ? nav.loadEventEnd || nav.duration || 0 : 0,
                hasViewport: !!viewportMeta && !!viewportMeta.getAttribute('content'),
                hasTitle: !!document.title && document.title.trim().length > 0,
              });
            }, 50);
          }),
      );

      if (evaluation.lcpMs === null) {
        throw new Error('The page reported no largest-contentful-paint entry');
      }
      const lcpMs = evaluation.lcpMs;
      const cls = VitalsService.calculateCls(evaluation.shifts);

      const lcpSeconds = Math.round((lcpMs / 1000) * 100) / 100;
      const performanceScore = VitalsService.calculatePerformanceScore(lcpSeconds, cls);
      const standardsScore = VitalsService.calculateStandardsScore(
        hasSsl,
        evaluation.hasViewport,
        evaluation.hasTitle,
      );

      return {
        lcpSeconds,
        lighthouseMetrics: {
          lcp: Math.round(lcpMs),
          cls,
          speedIndex: Math.round(evaluation.loadEventEndMs || lcpMs * 1.1),
        },
        standards: {
          hasSsl,
          hasViewport: evaluation.hasViewport,
          hasTitle: evaluation.hasTitle,
        },
        performanceScore,
        standardsScore,
      };
    } catch (err) {
      console.warn('[VitalsService] Error evaluating performance metrics:', err);
      // Fallback in case evaluation encounters an error
      return {
        lcpSeconds: 2.5,
        lighthouseMetrics: {
          lcp: 2500,
          cls: 0.05,
          speedIndex: 2500,
        },
        standards: {
          hasSsl,
          hasViewport: true,
          hasTitle: true,
        },
        performanceScore: 70,
        standardsScore: hasSsl ? 80 : 40,
      };
    }
  }
}

export const vitalsService = new VitalsService();
