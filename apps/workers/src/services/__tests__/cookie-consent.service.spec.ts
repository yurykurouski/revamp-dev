import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import {
  CookieConsentService,
  CONSENT_PLATFORMS,
  ACCEPT_PHRASES,
  normaliseLabel,
} from '../cookie-consent.service.js';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';

// Fast timings so the fixtures do not wait on the production retry delay
const FAST = { timeoutMs: 3000, retryDelayMs: 50, settleMs: 0 };

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[cookie-consent.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

describe.skipIf(!browser)('CookieConsentService (real Chromium fixtures)', () => {
  let context: BrowserContext;
  let page: Page;
  const service = new CookieConsentService();

  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await browser?.close();
  });

  beforeEach(async () => {
    context = await browser!.newContext({ viewport: { width: 1024, height: 768 } });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    page = await context.newPage();
  });

  afterEach(async () => {
    await context.close();
  });

  /** Marks the page as accepted when the given button is clicked */
  const recordClick = (selector: string) => `
    <script>
      document.querySelector(${JSON.stringify(selector)}).addEventListener('click', (e) => {
        window.__accepted = e.currentTarget.id || e.currentTarget.textContent.trim();
        document.getElementById('banner').remove();
      });
    </script>`;

  it('accepts a OneTrust banner through its accept button', async () => {
    await page.setContent(`
      <main><h1>Dental clinic</h1></main>
      <div id="banner"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px">
        <p>We use cookies to improve your experience.</p>
        <button id="onetrust-pc-btn-handler">Cookie settings</button>
        <button id="onetrust-accept-btn-handler">Accept All Cookies</button>
      </div></div>
      ${recordClick('#onetrust-accept-btn-handler')}`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:cmp:onetrust');
    expect(await page.evaluate(() => (window as unknown as { __accepted: string }).__accepted)).toBe(
      'onetrust-accept-btn-handler',
    );
    expect(await page.locator('#onetrust-banner-sdk').count()).toBe(0);
  });

  it('waits for a banner that animates out after the click', async () => {
    await page.setContent(`
      <div id="banner"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;width:100%;height:300px;transition:transform 0.6s">
        <p>Cookies</p><button id="onetrust-accept-btn-handler">Accept All Cookies</button>
      </div></div>
      <script>
        document.getElementById('onetrust-accept-btn-handler').addEventListener('click', () => {
          const banner = document.getElementById('onetrust-banner-sdk');
          banner.style.transform = 'translateY(100%)';
          setTimeout(() => { banner.style.display = 'none'; }, 600);
        });
      </script>`);

    await expect(service.dismiss(page, { ...FAST, settleMs: 1500 })).resolves.toBe('dismissed:cmp:onetrust');
    expect(await page.locator('#onetrust-banner-sdk').isVisible()).toBe(false);
  });

  it('falls back to the platform API when the banner has no clickable accept button', async () => {
    await page.setContent(`
      <div id="didomi-notice" style="position:fixed;bottom:0;width:100%;height:80px">Cookies</div>
      <script>
        window.Didomi = { setUserAgreeToAll() { window.__apiCalled = true; document.getElementById('didomi-notice').remove(); } };
      </script>`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:cmp:didomi');
    expect(await page.evaluate(() => (window as unknown as { __apiCalled: boolean }).__apiCalled)).toBe(true);
  });

  it('clicks a Polish accept button matched by text', async () => {
    await page.setContent(`
      <main><h1>Klinika</h1><button>Umów wizytę</button></main>
      <div id="banner" class="rodo-bar" style="position:fixed;bottom:0;width:100%">
        <p>Ta strona używa plików cookie.</p>
        <button>Ustawienia</button>
        <button id="pl-accept">Akceptuję wszystkie</button>
      </div>
      ${recordClick('#pl-accept')}`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:text');
    expect(await page.evaluate(() => (window as unknown as { __accepted: string }).__accepted)).toBe('pl-accept');
  });

  it('clicks a Russian accept button matched by text', async () => {
    await page.setContent(`
      <div id="banner" style="position:fixed;bottom:0;width:100%">
        <span>Мы используем файлы куки для улучшения работы сайта.</span>
        <a href="#" id="ru-accept" role="button">Принять</a>
      </div>
      ${recordClick('#ru-accept')}`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:text');
    expect(await page.evaluate(() => (window as unknown as { __accepted: string }).__accepted)).toBe('ru-accept');
  });

  it('clicks a styled <div> button whose label lacks diacritics (hand-rolled banner)', async () => {
    await page.setContent(`
      <div id="banner" class="cookie__container" style="position:fixed;bottom:0;width:100%">
        <p>Strona korzysta z plików cookie.</p>
        <div class="cookie__buttons"><div class="btn btn-more cookie__btn" id="div-accept">Akceptuje</div></div>
      </div>
      ${recordClick('#div-accept')}`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:text');
    expect(await page.evaluate(() => (window as unknown as { __accepted: string }).__accepted)).toBe('div-accept');
  });

  it('does not click matching buttons outside consent UI', async () => {
    await page.setContent(`
      <main><h1>Order form</h1><p>Please review your order.</p><button id="ok">OK</button><button>Accept</button></main>
      <script>
        document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { window.__clicked = true; }));
      </script>`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('not_found');
    expect(await page.evaluate(() => (window as unknown as { __clicked?: boolean }).__clicked)).toBeUndefined();
  });

  it('clicks an accept button inside a consent iframe', async () => {
    const frameHtml = `
      <p>This site uses cookies for analytics.</p>
      <button onclick="parent.postMessage('accepted', '*')">I agree</button>`;
    await page.setContent(`
      <main><h1>Bakery</h1></main>
      <iframe id="cmp" srcdoc="${frameHtml.replace(/"/g, '&quot;')}"
        style="position:fixed;bottom:0;width:100%;height:150px;border:0"></iframe>
      <script>
        window.addEventListener('message', (e) => {
          if (e.data === 'accepted') { window.__accepted = true; document.getElementById('cmp').remove(); }
        });
      </script>`);
    await page.frameLocator('#cmp').locator('button').waitFor();

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:iframe-text');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __accepted?: boolean }).__accepted))
      .toBe(true);
  });

  it('hides a leftover consent overlay and lifts the scroll lock', async () => {
    await page.setContent(`
      <body style="overflow:hidden">
        <header style="position:sticky;top:0"><a href="/cookies" class="cookie-policy-link">Cookie policy</a></header>
        <main style="height:3000px"><h1>Salon</h1></main>
        <div class="cookie-wall" style="position:fixed;inset:0;background:rgba(0,0,0,.6)">
          <div class="cookie-wall__box"><p>We need your consent to use cookies.</p><span>Choose in settings</span></div>
        </div>
      </body>`);

    await expect(service.dismiss(page, FAST)).resolves.toBe('dismissed:overlay');
    expect(await page.locator('.cookie-wall').isVisible()).toBe(false);
    expect(await page.locator('header').isVisible()).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('auto');
  });

  it('is a no-op when the page has no cookie banner', async () => {
    await page.setContent(`<main><h1>Plumber</h1><p>Call us today.</p><button>Book now</button></main>`);
    const before = await page.content();

    await expect(service.dismiss(page, FAST)).resolves.toBe('not_found');
    expect(await page.content()).toBe(before);
  });

  it('handles a banner injected shortly after load', async () => {
    await page.setContent(`
      <script>
        setTimeout(() => {
          document.body.insertAdjacentHTML('beforeend',
            '<div id="banner" class="cky-consent-container" style="position:fixed;bottom:0;width:100%">' +
            '<p>Cookies</p><button class="cky-btn-accept">Accept All</button></div>');
          document.querySelector('.cky-btn-accept').addEventListener('click', () => document.getElementById('banner').remove());
        }, 20);
      </script>`);

    await expect(service.dismiss(page, { ...FAST, retryDelayMs: 150 })).resolves.toBe('dismissed:cmp:cookieyes');
  });
});

describe('CookieConsentService (mocked page)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockPage = (evaluate: () => Promise<unknown>) => {
    const mainFrame = { evaluate: vi.fn(evaluate), isDetached: () => false, url: () => 'https://example.com' };
    return {
      evaluate: vi.fn(evaluate),
      mainFrame: vi.fn(() => mainFrame),
      frames: vi.fn(() => [mainFrame]),
      waitForTimeout: vi.fn((ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 5)))),
      waitForFunction: vi.fn().mockResolvedValue(true),
      url: vi.fn(() => 'https://example.com'),
    };
  };

  it('returns timeout when detection stalls, without throwing', async () => {
    const page = mockPage(() => new Promise(() => {}));
    const service = new CookieConsentService();

    const started = Date.now();
    await expect(service.dismiss(page as never, { timeoutMs: 50 })).resolves.toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('never throws when the page is gone', async () => {
    const page = mockPage(() => Promise.reject(new Error('Target closed')));
    page.mainFrame.mockImplementation(() => {
      throw new Error('Target closed');
    });
    const service = new CookieConsentService();

    await expect(service.dismiss(page as never, { timeoutMs: 500, retryDelayMs: 1 })).resolves.toBe('error');
  });

  it('skips uncommitted frames and does not let a stuck frame use up the budget', async () => {
    const page = mockPage(() => Promise.resolve(null));
    page.mainFrame().evaluate.mockResolvedValue(false);
    const uncommitted = { evaluate: vi.fn(() => new Promise(() => {})), isDetached: () => false, url: () => '' };
    const stuck = { evaluate: vi.fn(() => new Promise(() => {})), isDetached: () => false, url: () => 'https://ads.example' };
    const consent = { evaluate: vi.fn(() => Promise.resolve(true)), isDetached: () => false, url: () => 'https://cmp.example' };
    page.frames.mockReturnValue([page.mainFrame(), uncommitted, stuck, consent] as never);
    const service = new CookieConsentService();

    await expect(service.dismiss(page as never, { timeoutMs: 3000, settleMs: 0 })).resolves.toBe('dismissed:iframe-text');
    expect(uncommitted.evaluate).not.toHaveBeenCalled();
    expect(stuck.evaluate).toHaveBeenCalledTimes(1);
  });

  it('waits, bounded by settleMs, for the consent UI to go only after a dismissal', async () => {
    const page = mockPage(() => Promise.resolve('onetrust'));
    const service = new CookieConsentService();

    await expect(service.dismiss(page as never, { settleMs: 321 })).resolves.toBe('dismissed:cmp:onetrust');
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, { timeout: 321, polling: 100 });

    const noBanner = mockPage(() => Promise.resolve(null));
    noBanner.mainFrame().evaluate.mockResolvedValue(false);
    await expect(service.dismiss(noBanner as never, { retryDelayMs: 1 })).resolves.toBe('not_found');
    expect(noBanner.waitForFunction).not.toHaveBeenCalled();
  });

  it('still resolves when the consent UI never disappears', async () => {
    const page = mockPage(() => Promise.resolve('onetrust'));
    page.waitForFunction.mockRejectedValue(new Error('Timeout 50ms exceeded'));
    const service = new CookieConsentService();

    await expect(service.dismiss(page as never, { settleMs: 50 })).resolves.toBe('dismissed:cmp:onetrust');
  });

  it('covers every consent platform and dashboard language named in REV-33', () => {
    expect(CONSENT_PLATFORMS.map((p) => p.name)).toEqual([
      'onetrust', 'cookiebot', 'didomi', 'quantcast', 'usercentrics', 'cookieyes',
      'complianz', 'osano', 'iubenda', 'termly', 'trustarc',
    ]);
    for (const phrase of ['accept all', 'akceptuję', 'zgadzam się', 'принять', 'прыняць', 'sutinku', 'ok', 'alle akzeptieren', 'tout accepter', 'прийняти']) {
      expect(ACCEPT_PHRASES).toContain(phrase);
    }
  });

  it('normalises labels: case, punctuation, whitespace and diacritics', () => {
    expect(normaliseLabel('  AKCEPTUJĘ! ')).toBe(normaliseLabel('Akceptuje'));
    expect(normaliseLabel("J'accepte")).toBe('jaccepte');
    expect(normaliseLabel('Accept\n  all ✓')).toBe('accept all');
    expect(normaliseLabel('Принять всё')).toBe(normaliseLabel('принять все'));
    expect(normaliseLabel(undefined)).toBe('');
  });
});
