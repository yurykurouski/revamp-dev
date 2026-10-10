import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finishMvpPage } from '../mvp-page-finish.js';
import { VALID } from './fixtures/page-gen/page.js';

// A finished model-designed page in real Chromium (REV-138): it runs only the scripts code adds (booking, tracker)
// without errors, and every request goes to Google Fonts, the site's own images or the tracker's API.

const API = 'https://api.revamp.test/api/v1';
const ALLOWED_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://falco-dent.pl', 'https://api.revamp.test']);

const html = finishMvpPage(VALID, {
  businessName: 'Falco-Dent',
  language: 'pl',
  services: ['Implanty'],
  contacts: { phone: '+48 600 100 200', address: 'ul. Długa 5, Kraków' },
  seo: { description: 'Gabinet stomatologiczny w Krakowie' },
  logoUrl: 'https://falco-dent.pl/logo.png',
  theme: { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#f5f7fa', text: '#111111', fontHeading: 'serif', fontBody: 'sans-serif' },
  publicApiUrl: API,
});

describe('a finished page in Chromium (REV-138)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('runs without errors or dialogs and loads only allowed hosts', async () => {
    const page = await browser.newPage();
    const requested: string[] = [];
    const errors: string[] = [];
    let dialogs = 0;
    await page.route('**/*', (route) => {
      requested.push(route.request().url());
      return route.abort();
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });

    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(200);

    expect(errors).toEqual([]);
    expect(dialogs).toBe(0);
    const outside = requested.filter((url) => !url.startsWith('data:') && !ALLOWED_ORIGINS.has(new URL(url).origin));
    expect(outside).toEqual([]);
    // The booking form and its script are live
    expect(await page.locator('#booking form').count()).toBe(1);
    await page.close();
  }, 30_000);
});
