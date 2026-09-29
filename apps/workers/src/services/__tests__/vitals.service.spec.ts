import { describe, it, expect, vi, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { VitalsService, RawLayoutShift, NO_LCP_ENTRY } from '../vitals.service.js';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[vitals.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

const shift = (startTime: number, value: number, hadRecentInput = false): RawLayoutShift => ({
  startTime,
  value,
  hadRecentInput,
});

describe('VitalsService', () => {
  it('should calculate performance scores using Google CWV thresholds', () => {
    // Fast LCP <= 1.8s, low CLS <= 0.1
    expect(VitalsService.calculatePerformanceScore(1.2, 0.02)).toBe(100);

    // Moderate LCP <= 2.5s
    expect(VitalsService.calculatePerformanceScore(2.3, 0.05)).toBe(90);

    // Needs improvement LCP 2.5 - 4.0s
    expect(VitalsService.calculatePerformanceScore(3.5, 0.15)).toBe(50);

    // Poor LCP > 4.0s
    expect(VitalsService.calculatePerformanceScore(5.2, 0.3)).toBe(10);
  });

  it('should calculate standards score based on SSL, Viewport, and Title', () => {
    expect(VitalsService.calculateStandardsScore(true, true, true)).toBe(100);
    expect(VitalsService.calculateStandardsScore(false, true, true)).toBe(60);
    expect(VitalsService.calculateStandardsScore(true, false, false)).toBe(40);
  });

  it('should collect vitals from page evaluate', async () => {
    const service = new VitalsService();
    const mockPage: any = {
      evaluate: vi.fn().mockResolvedValue({
        lcpMs: 2400,
        shifts: [shift(100, 0.03), shift(300, 0.01)],
        hasViewport: true,
        hasTitle: true,
      }),
    };

    const result = await service.collectVitals(mockPage, 'https://example-secure.com');

    expect(result.lcpSeconds).toBe(2.4);
    // Only the vitals the page measured; no Speed Index or INP estimated from them (REV-105)
    expect(result.lighthouseMetrics).toEqual({ lcp: 2400, cls: 0.04 });
    expect(result.standards.hasSsl).toBe(true);
    expect(result.standards.hasViewport).toBe(true);
    expect(result.performanceScore).toBeGreaterThanOrEqual(80);
    expect(result.standardsScore).toBe(100);
    expect(result.errors).toEqual([]);
  });

  it('reports performance as not measured when the page has no LCP entry, keeping CLS and standards', async () => {
    const service = new VitalsService();
    const mockPage: any = {
      evaluate: vi.fn().mockResolvedValue({
        lcpMs: null,
        shifts: [shift(100, 0.02)],
        hasViewport: true,
        hasTitle: false,
      }),
    };

    const result = await service.collectVitals(mockPage, 'https://example-secure.com');

    // No other timing stands in for the missing LCP, and nothing is derived from it
    expect(result.lcpSeconds).toBeUndefined();
    expect(result.performanceScore).toBeUndefined();
    expect(result.lighthouseMetrics).toEqual({ cls: 0.02 });
    expect(result.standards).toEqual({ hasSsl: true, hasViewport: true, hasTitle: false });
    expect(result.standardsScore).toBe(80);
    expect(result.errors).toEqual([{ measurement: 'performance', message: NO_LCP_ENTRY }]);
  });

  it('reports performance and standards as not measured when the page cannot be read, with no stand-in values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new VitalsService();
    const mockPage: any = {
      evaluate: vi.fn().mockRejectedValue(new Error('page.evaluate: Execution context was destroyed\n    at stack line')),
    };

    const result = await service.collectVitals(mockPage, 'https://example-secure.com');

    expect(result).toEqual({
      lighthouseMetrics: {},
      errors: [
        { measurement: 'performance', message: 'page.evaluate: Execution context was destroyed' },
        { measurement: 'standards', message: 'page.evaluate: Execution context was destroyed' },
      ],
    });
    warn.mockRestore();
  });
});

describe('VitalsService.calculateCls (Core Web Vitals session windows)', () => {
  it('is 0 without layout shifts', () => {
    expect(VitalsService.calculateCls([])).toBe(0);
  });

  it('sums shifts less than 1 s apart into one window', () => {
    expect(VitalsService.calculateCls([shift(0, 0.1), shift(900, 0.05), shift(1800, 0.02)])).toBe(0.17);
  });

  it('starts a new window after a 1 s gap and keeps the largest window', () => {
    expect(VitalsService.calculateCls([shift(0, 0.1), shift(1000, 0.05), shift(1500, 0.03)])).toBe(0.1);
    expect(VitalsService.calculateCls([shift(0, 0.02), shift(2000, 0.05), shift(2500, 0.03)])).toBe(0.08);
  });

  it('caps a window at 5 s even when shifts keep coming', () => {
    const steady = [0, 800, 1600, 2400, 3200, 4000, 4800, 5600].map((t) => shift(t, 0.01));
    // The shift at 5600 ms opens a new window: 7 shifts in the first one
    expect(VitalsService.calculateCls(steady)).toBe(0.07);
  });

  it('ignores shifts caused by recent input', () => {
    expect(VitalsService.calculateCls([shift(0, 0.2, true), shift(100, 0.03)])).toBe(0.03);
  });

  it('does not depend on the entry order', () => {
    expect(VitalsService.calculateCls([shift(1800, 0.02), shift(0, 0.1), shift(900, 0.05)])).toBe(0.17);
  });
});

describe.skipIf(!browser)('VitalsService (real Chromium)', () => {
  let context: BrowserContext;
  let page: Page;
  const service = new VitalsService();

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    context = await browser!.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    page = await context.newPage();
  });

  afterEach(async () => {
    await context.close();
  });

  it('measures LCP and CLS from buffered performance entries', async () => {
    // A block is inserted above the content after first paint, pushing it down. Chromium marks
    // shifts in the first ~500 ms after navigation as input-driven, so the shift comes later
    await page.setContent(`<!doctype html><html><head><title>Fixture</title>
      <meta name="viewport" content="width=device-width"></head>
      <body style="margin:0"><p style="font-size:48px;margin:0">Largest block of text on the page</p>
      <script>
        setTimeout(() => {
          const spacer = document.createElement('div');
          spacer.style.height = '400px';
          document.body.insertBefore(spacer, document.body.firstChild);
        }, 800);
      </script></body></html>`);
    await page.waitForTimeout(1200);

    const result = await service.collectVitals(page, 'https://fixture.test');

    expect(result.lighthouseMetrics.lcp).toBeGreaterThan(0);
    expect(result.lighthouseMetrics.cls).toBeGreaterThan(0);
    expect(Object.keys(result.lighthouseMetrics).sort()).toEqual(['cls', 'lcp']);
    expect(result.performanceScore).toBeGreaterThan(0);
    expect(result.standards).toEqual({ hasSsl: true, hasViewport: true, hasTitle: true });
    expect(result.errors).toEqual([]);
  });

  it('reports CLS 0 for a page that does not shift', async () => {
    await page.setContent('<!doctype html><title>Still</title><h1>Nothing moves here</h1>');
    await page.waitForTimeout(200);

    const result = await service.collectVitals(page, 'http://fixture.test');

    expect(result.lighthouseMetrics.lcp).toBeGreaterThan(0);
    expect(result.lighthouseMetrics.cls).toBe(0);
  });
});
