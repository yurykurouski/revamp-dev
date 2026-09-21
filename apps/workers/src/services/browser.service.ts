import { chromium, Browser, BrowserContextOptions, Page } from 'playwright';
import { axeService, AxeAuditResult } from './axe.service.js';
import { vitalsService, VitalsAuditResult } from './vitals.service.js';
import { RawBrandExtractionData } from './brand-extractor.service.js';

export interface ScreenshotResult {
  desktopBuffer: Buffer;
  mobileBuffer: Buffer;
}

export interface FullAuditCrawlingResult extends ScreenshotResult {
  a11yResult: AxeAuditResult;
  vitalsResult: VitalsAuditResult;
  rawBrandData: RawBrandExtractionData;
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

    // Short stabilization wait for web fonts and layout shifts
    await page.waitForTimeout(600);
  }

  /**
   * Extracts raw brand colors, fonts, logo candidates, and contacts directly from page DOM
   */
  async extractRawBrandData(page: Page): Promise<RawBrandExtractionData> {
    return page.evaluate(() => {
      const colors: string[] = [];
      const colorElements = document.querySelectorAll(
        'button, header, nav, a, h1, h2, h3, [class*="btn"], [class*="hero"], footer, body, input',
      );
      for (let i = 0; i < Math.min(colorElements.length, 60); i++) {
        const el = colorElements[i];
        if (!el) continue;
        try {
          const style = window.getComputedStyle(el);
          if (
            style.backgroundColor &&
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            style.backgroundColor !== 'transparent'
          ) {
            colors.push(style.backgroundColor);
          }
          if (style.color) {
            colors.push(style.color);
          }
          if (style.borderColor && style.borderColor !== 'rgba(0, 0, 0, 0)') {
            colors.push(style.borderColor);
          }
        } catch {
          // ignore styling access errors
        }
      }

      // Font families
      const fontFamilies: string[] = [];
      try {
        const bodyFont = window.getComputedStyle(document.body).fontFamily;
        if (bodyFont) fontFamilies.push(bodyFont);
        const heading = document.querySelector('h1, h2');
        if (heading) {
          const hFont = window.getComputedStyle(heading).fontFamily;
          if (hFont) fontFamilies.push(hFont);
        }
      } catch {
        // ignore
      }

      // Favicon
      let faviconUrl: string | undefined = undefined;
      const iconLink = document.querySelector(
        'link[rel*="icon"], link[rel*="apple-touch-icon"]',
      ) as HTMLLinkElement | null;
      if (iconLink && iconLink.href) {
        faviconUrl = iconLink.href;
      }

      // Logo candidate
      let logoUrl: string | undefined = undefined;
      const logoImg = document.querySelector(
        'header img[class*="logo" i], header img[id*="logo" i], header img[alt*="logo" i], nav img[class*="logo" i], nav img[id*="logo" i], a[href="/"] img, header img, nav img',
      ) as HTMLImageElement | null;
      if (logoImg && logoImg.src && !logoImg.src.startsWith('data:image/svg')) {
        logoUrl = logoImg.src;
      }

      // Contact phone
      let phone: string | undefined = undefined;
      const telLink = document.querySelector('a[href^="tel:"]') as HTMLAnchorElement | null;
      if (telLink) {
        phone = telLink.getAttribute('href')?.replace(/^tel:/i, '').trim();
      }
      if (!phone) {
        const textBlocks = Array.from(
          document.querySelectorAll('header, footer, [class*="contact"], [class*="phone"]'),
        )
          .map((el) => el.textContent || '')
          .join(' ');
        const phoneMatch = textBlocks.match(
          /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,4}/,
        );
        if (phoneMatch && phoneMatch[0] && phoneMatch[0].replace(/\D/g, '').length >= 7) {
          phone = phoneMatch[0].trim();
        }
      }

      // Contact email
      let email: string | undefined = undefined;
      const mailLink = document.querySelector('a[href^="mailto:"]') as HTMLAnchorElement | null;
      if (mailLink) {
        email = mailLink.getAttribute('href')?.replace(/^mailto:/i, '').split('?')[0]?.trim();
      }

      // Physical address
      let address: string | undefined = undefined;
      const addressEl = document.querySelector('[itemprop="address"], address, [class*="address"]');
      if (addressEl && addressEl.textContent) {
        address = addressEl.textContent.trim().replace(/\s+/g, ' ');
      }

      // Working hours
      let workingHours: string | undefined = undefined;
      const hoursEl = document.querySelector(
        '[itemprop="openingHours"], [class*="hours"], [class*="schedule"]',
      );
      if (hoursEl && hoursEl.textContent) {
        workingHours = hoursEl.textContent.trim().replace(/\s+/g, ' ');
      }

      // Social Links
      const socialLinks: Array<{ platform: string; url: string }> = [];
      const links = document.querySelectorAll('a[href]');
      const platforms = [
        { name: 'telegram', regex: /t\.me|telegram/i },
        { name: 'whatsapp', regex: /wa\.me|whatsapp/i },
        { name: 'vk', regex: /vk\.com/i },
        { name: 'instagram', regex: /instagram\.com/i },
        { name: 'facebook', regex: /facebook\.com/i },
        { name: 'linkedin', regex: /linkedin\.com/i },
        { name: 'youtube', regex: /youtube\.com/i },
      ];
      for (let i = 0; i < links.length; i++) {
        const href = links[i]?.getAttribute('href') || '';
        for (const p of platforms) {
          if (p.regex.test(href) && !socialLinks.some((s) => s.platform === p.name)) {
            socialLinks.push({ platform: p.name, url: href });
          }
        }
      }

      // Services
      const services: string[] = [];
      const serviceHeadings = document.querySelectorAll(
        '[class*="service"] h2, [class*="service"] h3, [class*="service"] h4, [class*="service"] li',
      );
      for (let i = 0; i < Math.min(serviceHeadings.length, 8); i++) {
        const txt = serviceHeadings[i]?.textContent?.trim();
        if (txt && txt.length > 2 && txt.length < 80) {
          services.push(txt);
        }
      }

      return {
        colors,
        fontFamilies,
        faviconUrl,
        logoUrl,
        phone,
        email,
        address,
        workingHours,
        socialLinks,
        services,
      };
    });
  }

  /**
   * Captures Desktop (1440x900) and Mobile (375x812) screenshots
   */
  async captureScreenshots(url: string): Promise<ScreenshotResult> {
    const full = await this.captureFullAudit(url);
    return {
      desktopBuffer: full.desktopBuffer,
      mobileBuffer: full.mobileBuffer,
    };
  }

  /**
   * Executes complete crawler pass: Desktop & Mobile screenshots, Axe-core WCAG audit, Core Web Vitals, and Brand DNA
   */
  async captureFullAudit(url: string): Promise<FullAuditCrawlingResult> {
    const browser = await this.getBrowser();
    this.jobCount++;

    let desktopBuffer: Buffer;
    let mobileBuffer: Buffer;
    let a11yResult: AxeAuditResult;
    let vitalsResult: VitalsAuditResult;
    let rawBrandData: RawBrandExtractionData;

    // 1. Desktop Screenshot (1440x900)
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
        fullPage: false,
      });
      // Extract brand data on Desktop viewport where full layout is present
      rawBrandData = await this.extractRawBrandData(page);
    } finally {
      await desktopContext.close();
    }

    // 2. Mobile Screenshot (375x812), A11y WCAG scan, and Core Web Vitals
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

      // Screenshot first screen
      mobileBuffer = await page.screenshot({
        type: 'png',
        fullPage: false,
      });

      // Deterministic Core Web Vitals & Web Standards
      vitalsResult = await vitalsService.collectVitals(page, url);

      // Deterministic WCAG 2.1 AA Axe-core audit
      a11yResult = await axeService.scanPage(page);
    } finally {
      await mobileContext.close();
    }

    return {
      desktopBuffer,
      mobileBuffer,
      a11yResult,
      vitalsResult,
      rawBrandData,
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
