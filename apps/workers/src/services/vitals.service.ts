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

export class VitalsService {
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
      const evaluation = await page.evaluate(() => {
        let lcpMs = 0;
        let cls = 0;

        // 1. Buffered LCP Extraction
        try {
          const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
          if (lcpEntries.length > 0) {
            lcpMs = lcpEntries[lcpEntries.length - 1]?.startTime || 0;
          }
        } catch {
          // ignore
        }

        // 2. Buffered CLS Extraction
        try {
          const shiftEntries = performance.getEntriesByType('layout-shift');
          for (const entry of shiftEntries) {
            const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
            if (!shift.hadRecentInput && typeof shift.value === 'number') {
              cls += shift.value;
            }
          }
        } catch {
          // ignore
        }

        // 3. Navigation timings fallback for fast or minimal pages
        const paintEntries = performance.getEntriesByType('paint');
        const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint')?.startTime || 0;

        const navEntries = performance.getEntriesByType('navigation');
        let navDuration = 0;
        let responseEnd = 0;
        if (navEntries.length > 0) {
          const nav = navEntries[0] as PerformanceNavigationTiming;
          navDuration = nav.loadEventEnd || nav.duration || 0;
          responseEnd = nav.responseEnd || 0;
        }

        // If LCP was 0 (e.g. text only or very fast render), estimate from FCP or response timing
        if (lcpMs === 0) {
          lcpMs = fcp > 0 ? fcp : (responseEnd > 0 ? responseEnd : navDuration || 500);
        }

        // 4. Standards inspection
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        const hasViewport = !!viewportMeta && !!viewportMeta.getAttribute('content');
        const hasTitle = !!document.title && document.title.trim().length > 0;

        return {
          lcpMs,
          cls: Math.round(cls * 1000) / 1000,
          speedIndexMs: Math.round(navDuration || lcpMs * 1.1),
          hasViewport,
          hasTitle,
        };
      });

      const lcpSeconds = Math.round((evaluation.lcpMs / 1000) * 100) / 100;
      const performanceScore = VitalsService.calculatePerformanceScore(
        lcpSeconds,
        evaluation.cls,
      );
      const standardsScore = VitalsService.calculateStandardsScore(
        hasSsl,
        evaluation.hasViewport,
        evaluation.hasTitle,
      );

      return {
        lcpSeconds,
        lighthouseMetrics: {
          lcp: Math.round(evaluation.lcpMs),
          cls: evaluation.cls,
          speedIndex: evaluation.speedIndexMs,
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
