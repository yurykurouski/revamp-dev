import { describe, it, expect, vi, afterAll, beforeAll, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { IStandardsChecks } from '@revamp/shared-types';
import { VitalsService, RawLayoutShift, RawStandards, NO_LCP_ENTRY, STANDARDS_POINTS } from '../vitals.service.js';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[vitals.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

afterAll(async () => {
  await browser?.close();
});

const shift = (startTime: number, value: number, hadRecentInput = false): RawLayoutShift => ({
  startTime,
  value,
  hadRecentInput,
});

const ALL_STANDARDS: RawStandards = {
  viewport: true,
  title: true,
  faviconLink: true,
  structuredData: true,
  openGraph: true,
};

const ALL_CHECKS: IStandardsChecks = {
  https: true,
  viewport: true,
  title: true,
  favicon: true,
  structuredData: true,
  openGraph: true,
};

/** A page double whose DOM reads give `evaluation`; `favicon.ico` answers when `ico` is given */
const mockPage = (evaluation: unknown, ico?: { status: number; contentType: string }) => ({
  evaluate: vi.fn().mockResolvedValue(evaluation),
  url: () => 'https://example-secure.com/home',
  request: {
    get: vi.fn(async () => {
      if (!ico) throw new Error('connect ECONNREFUSED');
      return {
        ok: () => ico.status >= 200 && ico.status < 300,
        headers: () => ({ 'content-type': ico.contentType }),
        body: async () => Buffer.from('icon'),
        dispose: async () => {},
      };
    }),
  },
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

  it('gives the standards points of every passed check, 100 in all (spec 3.1.3.2, REV-102)', () => {
    expect(Object.values(STANDARDS_POINTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(VitalsService.calculateStandardsScore(ALL_CHECKS)).toBe(100);
    expect(VitalsService.calculateStandardsScore({ ...ALL_CHECKS, https: false })).toBe(70);
    expect(VitalsService.calculateStandardsScore({ ...ALL_CHECKS, viewport: false, title: false })).toBe(60);
    expect(
      VitalsService.calculateStandardsScore({ ...ALL_CHECKS, favicon: false, structuredData: false, openGraph: false }),
    ).toBe(70);
    expect(
      VitalsService.calculateStandardsScore({
        https: false,
        viewport: false,
        title: false,
        favicon: false,
        structuredData: false,
        openGraph: false,
      }),
    ).toBe(0);
  });

  it('should collect vitals from page evaluate', async () => {
    const service = new VitalsService();
    const page = mockPage({ lcpMs: 2400, shifts: [shift(100, 0.03), shift(300, 0.01)], standards: ALL_STANDARDS });

    const result = await service.collectVitals(page as any, 'https://example-secure.com');

    expect(result.lcpSeconds).toBe(2.4);
    // Only the vitals the page measured; no Speed Index or INP estimated from them (REV-105)
    expect(result.webVitals).toEqual({ lcp: 2400, cls: 0.04 });
    expect(result.standards).toEqual(ALL_CHECKS);
    expect(result.performanceScore).toBeGreaterThanOrEqual(80);
    expect(result.standardsScore).toBe(100);
    expect(result.errors).toEqual([]);
    // An icon link is enough; /favicon.ico is not requested
    expect(page.request.get).not.toHaveBeenCalled();
  });

  it('reports performance as not measured when the page has no LCP entry, keeping CLS and standards', async () => {
    const service = new VitalsService();
    const page = mockPage({
      lcpMs: null,
      shifts: [shift(100, 0.02)],
      standards: { ...ALL_STANDARDS, title: false, openGraph: false },
    });

    const result = await service.collectVitals(page as any, 'https://example-secure.com');

    // No other timing stands in for the missing LCP, and nothing is derived from it
    expect(result.lcpSeconds).toBeUndefined();
    expect(result.performanceScore).toBeUndefined();
    expect(result.webVitals).toEqual({ cls: 0.02 });
    expect(result.standards).toEqual({ ...ALL_CHECKS, title: false, openGraph: false });
    expect(result.standardsScore).toBe(80);
    expect(result.errors).toEqual([{ measurement: 'performance', message: NO_LCP_ENTRY }]);
  });

  it('reports performance and standards as not measured when the page cannot be read, with no stand-in values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new VitalsService();
    const page: any = {
      evaluate: vi.fn().mockRejectedValue(new Error('page.evaluate: Execution context was destroyed\n    at stack line')),
    };

    const result = await service.collectVitals(page, 'https://example-secure.com');

    expect(result).toEqual({
      webVitals: {},
      errors: [
        { measurement: 'performance', message: 'page.evaluate: Execution context was destroyed' },
        { measurement: 'standards', message: 'page.evaluate: Execution context was destroyed' },
      ],
    });
    warn.mockRestore();
  });
});

describe('VitalsService favicon check (REV-102)', () => {
  const noIconLink = { ...ALL_STANDARDS, faviconLink: false };

  it('finds the favicon at /favicon.ico of the final origin when the page links none', async () => {
    const page = mockPage({ lcpMs: 1000, shifts: [], standards: noIconLink }, { status: 200, contentType: 'image/x-icon' });

    const result = await new VitalsService().collectVitals(page as any, 'http://example-secure.com');

    expect(result.standards?.favicon).toBe(true);
    expect(page.request.get).toHaveBeenCalledWith('https://example-secure.com/favicon.ico', expect.anything());
  });

  it('has no favicon when /favicon.ico is missing, an HTML page, or unreachable', async () => {
    for (const ico of [
      { status: 404, contentType: 'image/x-icon' },
      { status: 200, contentType: 'text/html; charset=utf-8' },
      undefined,
    ]) {
      const page = mockPage({ lcpMs: 1000, shifts: [], standards: noIconLink }, ico);
      const result = await new VitalsService().collectVitals(page as any, 'https://example-secure.com');
      expect(result.standards?.favicon).toBe(false);
      expect(result.standardsScore).toBe(90);
    }
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

    expect(result.webVitals.lcp).toBeGreaterThan(0);
    expect(result.webVitals.cls).toBeGreaterThan(0);
    expect(Object.keys(result.webVitals).sort()).toEqual(['cls', 'lcp']);
    expect(result.performanceScore).toBeGreaterThan(0);
    expect(result.standards).toEqual({
      https: true,
      viewport: true,
      title: true,
      favicon: false,
      structuredData: false,
      openGraph: false,
    });
    expect(result.errors).toEqual([]);
  });

  it('reports CLS 0 for a page that does not shift', async () => {
    await page.setContent('<!doctype html><title>Still</title><h1>Nothing moves here</h1>');
    await page.waitForTimeout(200);

    const result = await service.collectVitals(page, 'http://fixture.test');

    expect(result.webVitals.lcp).toBeGreaterThan(0);
    expect(result.webVitals.cls).toBe(0);
  });

  it('reads the icon link, Schema.org JSON-LD and OpenGraph tags from the DOM', async () => {
    await page.setContent(`<!doctype html><html><head><title>Marked up</title>
      <meta name="viewport" content="width=device-width">
      <link rel="Shortcut Icon" href="/icon.png">
      <meta property="og:title" content="Marked up">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Dentist","name":"X"}]}</script>
      </head><body><h1>Marked up</h1></body></html>`);

    const result = await service.collectVitals(page, 'https://fixture.test');

    expect(result.standards).toEqual(ALL_CHECKS);
    expect(result.standardsScore).toBe(100);
  });

  it('counts microdata, and ignores broken or untyped JSON-LD and empty tags', async () => {
    await page.setContent(`<!doctype html><html><head><title>Micro</title>
      <meta name="viewport" content="">
      <link rel="icon" href="">
      <meta property="og:title" content="  ">
      <script type="application/ld+json">{not json</script>
      <script type="application/ld+json">{"@context":"https://schema.org"}</script>
      </head><body><div itemscope itemtype="https://schema.org/LocalBusiness">Shop</div></body></html>`);

    const result = await service.collectVitals(page, 'http://fixture.test');

    expect(result.standards).toEqual({
      https: false,
      viewport: false,
      title: true,
      favicon: false,
      structuredData: true,
      openGraph: false,
    });
  });
});

describe('VitalsService.probeFaviconIco (local server)', () => {
  let server: Server;
  let origin: string;
  const replies: Record<string, { status: number; type: string; body: string }> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const reply = replies[req.headers.host ?? ''] ?? { status: 404, type: 'text/plain', body: '' };
      res.writeHead(reply.status, { 'content-type': reply.type });
      res.end(reply.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it.skipIf(!browser)('accepts an icon and rejects a 404 or a soft-404 HTML page', async () => {
    const context = await browser!.newContext();
    const page = await context.newPage();
    const host = new URL(origin).host;
    try {
      replies[host] = { status: 200, type: 'image/x-icon', body: 'ICO' };
      expect(await VitalsService.probeFaviconIco(page, `${origin}/some/page`)).toBe(true);

      replies[host] = { status: 200, type: 'text/html', body: '<html>Not found</html>' };
      expect(await VitalsService.probeFaviconIco(page, origin)).toBe(false);

      replies[host] = { status: 404, type: 'image/x-icon', body: 'x' };
      expect(await VitalsService.probeFaviconIco(page, origin)).toBe(false);

      expect(await VitalsService.probeFaviconIco(page, 'about:blank')).toBe(false);
    } finally {
      await context.close();
    }
  });
});
