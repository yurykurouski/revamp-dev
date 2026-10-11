import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserService, FULL_PAGE_MAX_HEIGHT, REVEAL_ANIMATIONS_CSS, EVALUATE_NAME_SHIM } from '../browser.service.js';
import { chromium, type Page } from 'playwright';
import { cookieConsentService } from '../cookie-consent.service.js';
import { VitalsService, vitalsService } from '../vitals.service.js';
import { axeService } from '../axe.service.js';

vi.mock('../axe.service.js', () => ({
  axeService: {
    scanPage: vi.fn().mockResolvedValue({
      a11yScore: 85,
      summary: { violationsCount: 2, contrastIssuesCount: 1, missingAltCount: 1, criticalViolations: [] },
      violations: [],
      errors: [],
    }),
  },
}));

vi.mock('../vitals.service.js', () => ({
  VitalsService: { readVitalsInPage: vi.fn().mockResolvedValue({ lcpMs: 640, shifts: [] }) },
  vitalsService: {
    collectVitals: vi.fn().mockResolvedValue({
      lcpSeconds: 1.8,
      webVitals: { lcp: 1800, cls: 0.02 },
      standards: { https: true, viewport: true, title: true, favicon: true, structuredData: true, openGraph: true },
      performanceScore: 95,
      standardsScore: 100,
      errors: [],
    }),
  },
}));

vi.mock('../cookie-consent.service.js', () => ({
  cookieConsentService: {
    dismiss: vi.fn().mockResolvedValue('dismissed:cmp:onetrust'),
  },
}));

vi.mock('playwright', () => {
  return {
    chromium: {
      launch: vi.fn(),
    },
  };
});

describe('BrowserService', () => {
  let mockPage: any;
  let mockContext: any;
  let mockBrowser: any;
  let launchedBrowsers: any[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot-data')),
      viewportSize: vi.fn().mockReturnValue({ width: 1440, height: 900 }),
      addStyleTag: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        colors: ['rgb(79, 70, 229)', 'rgb(255, 255, 255)'],
        fontFamilies: ['Inter'],
        faviconUrl: 'https://example.com/favicon.ico',
        logoUrl: 'https://example.com/logo.png',
        phone: '+1 555-1234',
        email: 'info@example.com',
        address: '123 Test St',
        workingHours: '9-18',
        socialLinks: [{ platform: 'telegram', url: 'https://t.me/test' }],
        services: ['Service 1'],
      }),
    };

    mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
      addInitScript: vi.fn().mockResolvedValue(undefined),
    };

    // Every launch returns its own browser (the first is mockBrowser), so recycling can tell old from new
    const makeBrowser = () => ({
      isConnected: vi.fn().mockReturnValue(true),
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
    });
    mockBrowser = makeBrowser();
    launchedBrowsers = [];
    vi.mocked(chromium.launch).mockImplementation(async () => {
      const browser = launchedBrowsers.length === 0 ? mockBrowser : makeBrowser();
      launchedBrowsers.push(browser);
      return browser;
    });
  });

  it('should launch chromium with proper security and sandbox flags', async () => {
    const service = new BrowserService(20);
    const browser = await service.getBrowser();

    expect(chromium.launch).toHaveBeenCalledWith({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    expect(browser).toBe(mockBrowser);
  });

  it('should recycle browser instance after reaching maxJobsPerBrowser threshold', async () => {
    const service = new BrowserService(2);

    await service.captureScreenshots('https://test1.com');
    expect(mockBrowser.close).not.toHaveBeenCalled();

    await service.captureScreenshots('https://test2.com');
    expect(mockBrowser.close).not.toHaveBeenCalled();

    // 3rd job exceeds threshold of 2, triggers recycle
    await service.captureScreenshots('https://test3.com');
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    expect(chromium.launch).toHaveBeenCalledTimes(2);
  });

  it('should capture both desktop and mobile screenshots with correct viewport configs', async () => {
    const service = new BrowserService(20);
    const result = await service.captureScreenshots('https://example.com');

    expect(mockBrowser.newContext).toHaveBeenCalledTimes(2);

    // 1st context: Desktop 1440x900
    const desktopConfig = mockBrowser.newContext.mock.calls[0][0];
    expect(desktopConfig.viewport).toEqual({ width: 1440, height: 900 });

    // 2nd context: Mobile 375x812
    const mobileConfig = mockBrowser.newContext.mock.calls[1][0];
    expect(mobileConfig.viewport).toEqual({ width: 375, height: 812 });
    expect(mobileConfig.isMobile).toBe(true);

    // Both contexts must be strictly closed
    expect(mockContext.close).toHaveBeenCalledTimes(2);

    expect(result.desktopBuffer).toBeInstanceOf(Buffer);
    expect(result.mobileBuffer).toBeInstanceOf(Buffer);
  });

  it('captureHtmlScreenshot takes a full-page capture when asked (REV-143)', async () => {
    mockPage.setContent = vi.fn().mockResolvedValue(undefined);
    const service = new BrowserService(20);
    await service.captureHtmlScreenshot('<html></html>', { width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true });
    expect(mockBrowser.newContext.mock.calls[0][0]).toMatchObject({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false });
    expect(mockPage.screenshot).toHaveBeenLastCalledWith({ fullPage: true });
    await service.captureHtmlScreenshot('<html></html>');
    expect(mockPage.screenshot).toHaveBeenLastCalledWith({ fullPage: false });
    expect(mockContext.close).toHaveBeenCalledTimes(2);
  });

  it('should close context even if navigation throws an error', async () => {
    const service = new BrowserService(20);
    mockPage.goto.mockRejectedValue(new Error('DNS resolution error'));

    await expect(service.captureScreenshots('https://unreachable-domain.xyz')).rejects.toThrow(
      'DNS resolution error',
    );

    // Context must still be closed in finally block
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it('should fallback to domcontentloaded if networkidle times out', async () => {
    const service = new BrowserService(20);
    const timeoutErr = new Error('Timeout 25000ms exceeded.');
    timeoutErr.name = 'TimeoutError';
    mockPage.goto.mockRejectedValue(timeoutErr);

    const result = await service.captureScreenshots('https://slow-network-site.com');

    expect(mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 10000 });
    expect(result.desktopBuffer).toBeDefined();
    expect(result.mobileBuffer).toBeDefined();
  });

  it('should execute captureFullAudit returning screenshots, a11yResult, and vitalsResult', async () => {
    const service = new BrowserService(20);
    const result = await service.captureFullAudit('https://full-audit-test.com');

    expect(result.desktopBuffer).toBeInstanceOf(Buffer);
    expect(result.mobileBuffer).toBeInstanceOf(Buffer);
    expect(result.a11yResult.a11yScore).toBe(85);
    expect(result.vitalsResult.lcpSeconds).toBe(1.8);
    expect(mockContext.close).toHaveBeenCalledTimes(2);
    expect(result.eraFacts).toBeDefined();
    expect(result).not.toHaveProperty('siteSections');
    expect(result).not.toHaveProperty('siteLayout');
  });

  it('should capture above-the-fold and full-page screenshots for desktop and mobile (REV-21)', async () => {
    const service = new BrowserService(20);
    const result = await service.captureFullAudit('https://full-page-test.com');

    const screenshotCalls = mockPage.screenshot.mock.calls.map((c: any[]) => c[0]);
    const viewportShots = screenshotCalls.filter((o: any) => o.fullPage === false);
    const fullPageShots = screenshotCalls.filter((o: any) => o.fullPage === true);

    expect(viewportShots).toHaveLength(2);
    expect(fullPageShots).toHaveLength(2);
    expect(result.desktopFullBuffer).toBeInstanceOf(Buffer);
    expect(result.mobileFullBuffer).toBeInstanceOf(Buffer);
  });

  it('should dismiss the cookie banner before the first screenshot in both contexts (REV-33)', async () => {
    const service = new BrowserService(20);
    vi.mocked(cookieConsentService.dismiss)
      .mockResolvedValueOnce('dismissed:cmp:onetrust')
      .mockResolvedValueOnce('not_found');

    const result = await service.captureFullAudit('https://consent-test.com');

    expect(cookieConsentService.dismiss).toHaveBeenCalledTimes(2);
    expect(result.cookieConsent).toEqual({ desktop: 'dismissed:cmp:onetrust', mobile: 'not_found' });

    const dismissOrder = vi.mocked(cookieConsentService.dismiss).mock.invocationCallOrder;
    const screenshotOrder = mockPage.screenshot.mock.invocationCallOrder;
    // Desktop: dismiss, viewport shot, full-page shot; mobile: dismiss, viewport shot, full-page shot
    expect(dismissOrder[0]).toBeLessThan(screenshotOrder[0]);
    expect(dismissOrder[1]).toBeGreaterThan(screenshotOrder[1]);
    expect(dismissOrder[1]).toBeLessThan(screenshotOrder[2]);
  });

  it('should collect vitals before dismissing consent and scan a11y after it (REV-33)', async () => {
    const service = new BrowserService(20);
    await service.captureFullAudit('https://consent-order-test.com');

    const mobileDismiss = vi.mocked(cookieConsentService.dismiss).mock.invocationCallOrder[1]!;
    expect(vi.mocked(vitalsService.collectVitals).mock.invocationCallOrder[0]).toBeLessThan(mobileDismiss);
    expect(vi.mocked(axeService.scanPage).mock.invocationCallOrder[0]).toBeGreaterThan(mobileDismiss);
  });

  it('should auto-scroll the page to trigger lazy-loaded content before full-page capture', async () => {
    const service = new BrowserService(20);
    mockPage.evaluate.mockResolvedValue(3200);

    const height = await service.autoScroll(mockPage, FULL_PAGE_MAX_HEIGHT.desktop);

    expect(height).toBe(3200);
    expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), FULL_PAGE_MAX_HEIGHT.desktop);
  });

  it('should return 0 from autoScroll when page evaluation fails', async () => {
    const service = new BrowserService(20);
    mockPage.evaluate.mockRejectedValue(new Error('Execution context was destroyed'));

    await expect(service.autoScroll(mockPage, 5000)).resolves.toBe(0);
  });

  it('should not clip full-page screenshots for pages within the height cap', async () => {
    const service = new BrowserService(20);
    mockPage.evaluate.mockResolvedValue(4000);

    await service.captureFullPageScreenshot(mockPage, FULL_PAGE_MAX_HEIGHT.desktop);

    expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true });
  });

  it('should force scroll-reveal animations visible before the full-page capture', async () => {
    const service = new BrowserService(20);
    mockPage.evaluate.mockResolvedValue(2000);

    await service.captureFullPageScreenshot(mockPage, 8000);

    expect(mockPage.addStyleTag).toHaveBeenCalledWith({ content: REVEAL_ANIMATIONS_CSS });
    expect(REVEAL_ANIMATIONS_CSS).toContain('[data-aos]');
    expect(mockPage.addStyleTag.mock.invocationCallOrder[0]).toBeLessThan(
      mockPage.screenshot.mock.invocationCallOrder[0],
    );
  });

  it('should clip very long pages to the max height cap', async () => {
    const service = new BrowserService(20);
    mockPage.evaluate.mockResolvedValue(50000);

    await service.captureFullPageScreenshot(mockPage, 8000);

    expect(mockPage.screenshot).toHaveBeenCalledWith({
      type: 'png',
      fullPage: true,
      clip: { x: 0, y: 0, width: 1440, height: 8000 },
    });
  });

  it('should install the __name evaluation shim in every crawl context', async () => {
    const service = new BrowserService(20);
    await service.captureFullAudit('https://shim-test.com');

    expect(mockContext.addInitScript).toHaveBeenCalledTimes(2);
    expect(mockContext.addInitScript).toHaveBeenCalledWith({ content: EVALUATE_NAME_SHIM });
  });

  it('should attach extracted site content to the raw brand data (REV-23)', async () => {
    const service = new BrowserService(20);
    const siteContent = {
      headings: ['Welcome'],
      paragraphs: ['A paragraph of real site copy.'],
      serviceItems: [],
      navItems: [],
      testimonials: [],
      images: [],
    };
    vi.spyOn(service, 'extractSiteContent').mockResolvedValue(siteContent);

    const result = await service.captureFullAudit('https://content-test.com');

    expect(result.rawBrandData.content).toEqual(siteContent);
  });

  it('should return undefined when site content extraction fails or is malformed', async () => {
    const service = new BrowserService(20);

    mockPage.evaluate.mockRejectedValueOnce(new Error('Execution context was destroyed'));
    await expect(service.extractSiteContent(mockPage)).resolves.toBeUndefined();

    mockPage.evaluate.mockResolvedValueOnce({ unexpected: true });
    await expect(service.extractSiteContent(mockPage)).resolves.toBeUndefined();
  });

  it('measures a published page on the audit`s phone and closes its context (REV-119)', async () => {
    const service = new BrowserService(20);
    const vitals = await service.measurePageVitals('http://localhost:9000/revamp-demos/falco/index.html');
    expect(vitals).toEqual({ lcpMs: 640, shifts: [] });
    const options = mockBrowser.newContext.mock.calls[0][0];
    expect(options).toMatchObject({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    expect(options.userAgent).toContain('iPhone');
    expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:9000/revamp-demos/falco/index.html', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(VitalsService.readVitalsInPage).toHaveBeenCalledWith(mockPage);
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it('closes the measuring context when the page cannot be loaded (REV-119)', async () => {
    const service = new BrowserService(20);
    mockPage.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));
    await expect(service.measurePageVitals('http://localhost:9000/x')).rejects.toThrow('ERR_CONNECTION_REFUSED');
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it('should close browser gracefully on close()', async () => {
    const service = new BrowserService(20);
    await service.getBrowser();
    await service.close();

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  describe('browser recycling (REV-163)', () => {
    const deferred = () => {
      let resolve!: () => void;
      let reject!: (err: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    /** Starts a capture that stays inside its context until the returned handle settles it */
    const startHeldCapture = async (service: BrowserService) => {
      const held = deferred();
      mockPage.setContent = vi.fn().mockImplementationOnce(() => held.promise).mockResolvedValue(undefined);
      const job = service.captureHtmlScreenshot('<p>held</p>');
      await vi.waitFor(() => expect(mockPage.setContent).toHaveBeenCalledTimes(1));
      return { held, job };
    };

    it('a job holding a context while the 21st job starts is not interrupted', async () => {
      const service = new BrowserService(20);
      const { held, job } = await startHeldCapture(service);
      for (let i = 2; i <= 20; i++) await service.captureHtmlScreenshot(`<p>${i}</p>`);
      expect(launchedBrowsers).toHaveLength(1);

      await service.captureHtmlScreenshot('<p>21</p>');
      const [browserA, browserB] = launchedBrowsers;
      expect(browserB.newContext).toHaveBeenCalledTimes(1);
      expect(browserA.close).not.toHaveBeenCalled();

      held.resolve();
      await expect(job).resolves.toBeInstanceOf(Buffer);
      expect(browserA.close).toHaveBeenCalledTimes(1);
      expect(browserB.close).not.toHaveBeenCalled();
    });

    it('two jobs that start together at the limit share one launch and neither gets a closed browser', async () => {
      mockPage.setContent = vi.fn().mockResolvedValue(undefined);
      const service = new BrowserService(1);
      await service.captureHtmlScreenshot('<p>1</p>');
      await Promise.all([service.captureHtmlScreenshot('<p>2</p>'), service.captureHtmlScreenshot('<p>3</p>')]);

      expect(launchedBrowsers).toHaveLength(3);
      for (const browser of launchedBrowsers) {
        const closedAt = browser.close.mock.invocationCallOrder[0];
        if (closedAt === undefined) continue;
        for (const openedAt of browser.newContext.mock.invocationCallOrder) expect(openedAt).toBeLessThan(closedAt);
      }
    });

    it('a failing job on a retired browser still closes it', async () => {
      const service = new BrowserService(1);
      const { held, job } = await startHeldCapture(service);
      await service.captureHtmlScreenshot('<p>2</p>');
      const [browserA] = launchedBrowsers;
      expect(browserA.close).not.toHaveBeenCalled();

      held.reject(new Error('page crashed'));
      await expect(job).rejects.toThrow('page crashed');
      expect(browserA.close).toHaveBeenCalledTimes(1);
    });

    it('close() also closes retired browsers', async () => {
      const service = new BrowserService(1);
      const { held, job } = await startHeldCapture(service);
      await service.captureHtmlScreenshot('<p>2</p>');
      const [browserA, browserB] = launchedBrowsers;

      await service.close();
      expect(browserA.close).toHaveBeenCalledTimes(1);
      expect(browserB.close).toHaveBeenCalledTimes(1);

      // The held job's late release after shutdown neither throws nor closes anything again
      held.resolve();
      await expect(job).resolves.toBeInstanceOf(Buffer);
      expect(browserA.close).toHaveBeenCalledTimes(1);
    });

    it('a disconnected browser is replaced and its late release leaves the new one open', async () => {
      const service = new BrowserService(20);
      const { held, job } = await startHeldCapture(service);
      const [browserA] = launchedBrowsers;
      browserA.isConnected.mockReturnValue(false);

      await service.captureHtmlScreenshot('<p>2</p>');
      const [, browserB] = launchedBrowsers;
      expect(browserB.newContext).toHaveBeenCalledTimes(1);

      held.resolve();
      await expect(job).resolves.toBeInstanceOf(Buffer);
      expect(browserB.close).not.toHaveBeenCalled();
      expect(await service.getBrowser()).toBe(browserB);
    });

    it('a browser that is dead right after every launch fails the job after three launches and is closed', async () => {
      mockPage.setContent = vi.fn().mockResolvedValue(undefined);
      vi.mocked(chromium.launch).mockImplementation(async () => {
        // Guards the test against an endless relaunch loop
        if (launchedBrowsers.length >= 6) throw new Error('relaunched without limit');
        const browser = { isConnected: vi.fn().mockReturnValue(false), newContext: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
        launchedBrowsers.push(browser);
        return browser as any;
      });
      const service = new BrowserService(20);

      await expect(service.captureHtmlScreenshot('<p>1</p>')).rejects.toThrow('Chromium disconnected right after launch');
      expect(launchedBrowsers).toHaveLength(3);
      for (const browser of launchedBrowsers) expect(browser.close).toHaveBeenCalledTimes(1);
    });

    it('a failed launch rejects that job and the next job launches again', async () => {
      mockPage.setContent = vi.fn().mockResolvedValue(undefined);
      vi.mocked(chromium.launch).mockRejectedValueOnce(new Error('launch failed'));
      const service = new BrowserService(20);

      await expect(service.captureHtmlScreenshot('<p>1</p>')).rejects.toThrow('launch failed');
      await expect(service.captureHtmlScreenshot('<p>2</p>')).resolves.toBeInstanceOf(Buffer);
      expect(chromium.launch).toHaveBeenCalledTimes(2);
    });
  });
});

describe('extractEraFacts (REV-141)', () => {
  const pageWith = (evaluate: (...args: unknown[]) => Promise<unknown>) => ({ evaluate: vi.fn(evaluate) }) as unknown as Page;

  it('returns the era facts', async () => {
    const raw = { contentWidth: 960, fullBleedShare: 0, bodyFont: 'Georgia' };
    await expect(new BrowserService().extractEraFacts(pageWith(async () => raw))).resolves.toEqual({ raw });
  });

  it('returns an error, never throws, when evaluation fails or returns nothing', async () => {
    const failed = await new BrowserService().extractEraFacts(pageWith(async () => { throw new Error('Execution context was destroyed'); }));
    expect(failed.error).toMatch(/Era facts collection failed: Execution context was destroyed/);
    const empty = await new BrowserService().extractEraFacts(pageWith(async () => null));
    expect(empty.error).toMatch(/no era facts/);
  });
});
