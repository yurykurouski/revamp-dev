import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';
import { collectEraFactsInPage } from '../site-era.page.js';

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[site-era.page.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

afterAll(async () => {
  await browser?.close();
});

const blocks = (style: string) =>
  Array.from({ length: 3 }, (_, i) => `<section style="${style}"><h2>Section ${i}</h2><p>Some text in section ${i}.</p></section>`).join('');

describe.skipIf(!browser)('collectEraFactsInPage (real Chromium, REV-141)', () => {
  let context: BrowserContext;
  let page: Page;

  beforeEach(async () => {
    context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    page = await context.newPage();
  });
  afterEach(async () => {
    await context.close();
  });

  it('measures a narrow fixed page', async () => {
    await page.setContent(`<html><body style="margin:0">${blocks('width:900px;height:200px;margin:0 auto')}</body></html>`);
    const facts = await page.evaluate(collectEraFactsInPage);
    expect(facts.contentWidth).toBe(900);
    expect(facts.fullBleedShare).toBe(0);
  });

  it('measures full-bleed blocks', async () => {
    await page.setContent(`<html><body style="margin:0">${blocks('width:100%;height:200px')}</body></html>`);
    const facts = await page.evaluate(collectEraFactsInPage);
    expect(facts.fullBleedShare).toBe(1);
    expect(facts.contentWidth).toBeGreaterThanOrEqual(1368);
  });

  it('reads the body font from the first long paragraph', async () => {
    const long = 'A paragraph long enough to be read as the body text of this page.';
    await page.setContent(
      `<html><body style="margin:0"><section style="height:200px"><h2>Heading</h2><p>Short</p><p style="font-family: Georgia">${long}</p></section><section style="height:200px"><h2>Two</h2></section></body></html>`,
    );
    const facts = await page.evaluate(collectEraFactsInPage);
    expect(facts.bodyFont).toContain('Georgia');
  });

  it('returns nothing it cannot measure', async () => {
    await page.setContent('<html><body></body></html>');
    expect(await page.evaluate(collectEraFactsInPage)).toEqual({});
  });
});
