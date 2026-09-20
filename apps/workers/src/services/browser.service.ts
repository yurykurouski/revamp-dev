import { chromium, Browser, BrowserContextOptions, Page } from 'playwright';

export interface ScreenshotResult {
  desktopBuffer: Buffer;
  mobileBuffer: Buffer;
}

export class BrowserService {
  private browser: Browser | null = null;
  private jobCount: number = 0;
  private readonly maxJobsPerBrowser: number;
  private isLaunching: Promise<Browser> | null = null;

  constructor(maxJobsPerBrowser: number = 20) {
    this.maxJobsPerBrowser = maxJobsPerBrowser;
  }

  /**
   * Retrieves or initializes the shared Chromium instance
   */
  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      if (this.jobCount >= this.maxJobsPerBrowser) {
        console.log(
          `[BrowserService] Reached ${this.jobCount} jobs. Restarting browser to prevent memory leaks...`,
        );
        await this.close();
      } else {
        return this.browser;
      }
    }

    if (this.isLaunching) {
      return this.isLaunching;
    }

    this.isLaunching = (async () => {
      console.log('[BrowserService] Launching fresh Headless Chromium instance...');
      const launched = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      this.browser = launched;
      this.jobCount = 0;
      this.isLaunching = null;
      return launched;
    })();

    return this.isLaunching;
  }

  /**
   * Safely navigates page to the target URL with 25s timeout and networkidle handling
   */
  private async navigateWithFallback(page: Page, url: string, timeoutMs: number = 25000): Promise<void> {
    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: timeoutMs,
      });
    } catch (error: unknown) {
      const isTimeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.message.includes('timeout'));
      if (isTimeout) {
        console.warn(
          `[BrowserService] networkidle timed out for ${url}. Falling back to domcontentloaded...`,
        );
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      } else {
        throw error;
      }
    }

    // Short stabilization wait for web fonts and animations
    await page.waitForTimeout(600);
  }

  /**
   * Captures Desktop (1440x900) and Mobile (375x812) screenshots with strict context isolation
   */
  async captureScreenshots(url: string): Promise<ScreenshotResult> {
    const browser = await this.getBrowser();
    this.jobCount++;

    let desktopBuffer: Buffer;
    let mobileBuffer: Buffer;

    // 1. Desktop Screenshot (1440x900 viewport height)
    const desktopOptions: BrowserContextOptions = {
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      deviceScaleFactor: 1,
    };

    const desktopContext = await browser.newContext(desktopOptions);
    try {
      const page = await desktopContext.newPage();
      await this.navigateWithFallback(page, url, 25000);
      desktopBuffer = await page.screenshot({
        type: 'png',
        fullPage: false, // first screen / above the fold
      });
    } finally {
      // Mandatory context isolation cleanup
      await desktopContext.close();
    }

    // 2. Mobile Screenshot (375x812 iPhone / Pixel emulation)
    const mobileOptions: BrowserContextOptions = {
      viewport: { width: 375, height: 812 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    };

    const mobileContext = await browser.newContext(mobileOptions);
    try {
      const page = await mobileContext.newPage();
      await this.navigateWithFallback(page, url, 25000);
      mobileBuffer = await page.screenshot({
        type: 'png',
        fullPage: false,
      });
    } finally {
      // Mandatory context isolation cleanup
      await mobileContext.close();
    }

    return {
      desktopBuffer,
      mobileBuffer,
    };
  }

  /**
   * Graceful cleanup of the browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      console.log('[BrowserService] Closing Chromium browser...');
      try {
        await this.browser.close();
      } catch (err) {
        console.warn('[BrowserService] Error closing browser:', err);
      }
      this.browser = null;
      this.jobCount = 0;
    }
  }
}

export const browserService = new BrowserService();
