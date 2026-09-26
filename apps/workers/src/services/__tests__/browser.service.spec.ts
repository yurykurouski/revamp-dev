import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserService, FULL_PAGE_MAX_HEIGHT, REVEAL_ANIMATIONS_CSS, EVALUATE_NAME_SHIM } from '../browser.service.js';
import { chromium } from 'playwright';

vi.mock('../axe.service.js', () => ({
  axeService: {
    scanPage: vi.fn().mockResolvedValue({
      a11yScore: 85,
      summary: { violationsCount: 2, contrastIssuesCount: 1, missingAltCount: 1, criticalViolations: [] },
      rawViolations: [],
    }),
  },
}));

vi.mock('../vitals.service.js', () => ({
  vitalsService: {
    collectVitals: vi.fn().mockResolvedValue({
      lcpSeconds: 1.8,
      lighthouseMetrics: { lcp: 1800, cls: 0.02, speedIndex: 1700 },
      standards: { hasSsl: true, hasViewport: true, hasTitle: true },
      performanceScore: 95,
      standardsScore: 100,
    }),
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

    mockBrowser = {
      isConnected: vi.fn().mockReturnValue(true),
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser);
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

  it('should close browser gracefully on close()', async () => {
    const service = new BrowserService(20);
    await service.getBrowser();
    await service.close();

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});
