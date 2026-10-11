import { describe, expect, it } from 'vitest';
import { pageReviewRenderer, REVIEW_VIEWPORTS } from '../mvp-page-review.js';
import { VALID } from './fixtures/page-gen/page.js';

// The self-review's renderer (REV-143): the page as it will be published, minus the tracker, at desktop and mobile width

const THEME = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#f5f7fa', text: '#111111', fontHeading: 'serif', fontBody: 'sans-serif' };
const FINISH = {
  businessName: 'Falco-Dent',
  language: 'pl',
  services: ['Implanty'],
  contacts: { phone: '+48 600 100 200', address: 'ul. Długa 5, Kraków' },
  seo: { description: 'Gabinet stomatologiczny w Krakowie' },
  logoUrl: 'https://falco-dent.pl/logo.png',
  publicApiUrl: 'https://api.revamp.test/api/v1',
};

function fakeBrowser() {
  const calls: Array<{ html: string; options: unknown }> = [];
  return {
    calls,
    browser: {
      captureHtmlScreenshot: async (html: string, options: unknown) => {
        calls.push({ html, options });
        return Buffer.from(`shot-${calls.length}`);
      },
    },
  };
}

describe('pageReviewRenderer (REV-143)', () => {
  it('renders the finished page at 1440 and 390 px, full page, without the tracker', async () => {
    const { calls, browser } = fakeBrowser();
    const shots = await pageReviewRenderer(FINISH, browser)(VALID, THEME);

    expect(REVIEW_VIEWPORTS).toEqual({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } });
    expect(calls.map((c) => c.options)).toEqual([
      { width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true },
      { width: 390, height: 844, deviceScaleFactor: 1, fullPage: true },
    ]);
    const html = calls[0]!.html;
    expect(calls[1]!.html).toBe(html);
    expect(html).toContain('+48 600 100 200');
    expect(html).not.toContain('{{phone}}');
    expect(html).not.toContain('api.revamp.test');
    expect(shots).toEqual({ desktop: Buffer.from('shot-1'), mobile: Buffer.from('shot-2') });
  });

  it('renders a lead with no verified contacts', async () => {
    const { calls, browser } = fakeBrowser();
    await pageReviewRenderer({ ...FINISH, contacts: {} }, browser)(VALID, THEME);
    expect(calls[0]!.html).toContain('id="booking"');
  });
});
