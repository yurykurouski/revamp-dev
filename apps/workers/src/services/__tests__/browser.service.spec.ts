import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserService } from '../browser.service.js';
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

  it('should close browser gracefully on close()', async () => {
    const service = new BrowserService(20);
    await service.getBrowser();
    await service.close();

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});
