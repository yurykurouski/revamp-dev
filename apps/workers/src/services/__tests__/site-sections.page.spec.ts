import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';
import { collectSiteLayoutInPage } from '../site-layout.service.js';
import { collectSiteSectionsInPage } from '../site-sections.page.js';
import { readSiteSections } from '../site-sections.service.js';

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[site-sections.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

afterAll(async () => {
  await browser?.close();
});

// 1x1 PNG served for every https://img.test/ image, so images load and report currentSrc
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export const pageOf = (body: string, css = '') => `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<base href="https://falco.test/">
<style>body{margin:0;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#333}
section{padding:60px 40px;min-height:200px;box-sizing:border-box} h1,h2{font-family:Georgia,serif;color:#111} h2{font-size:32px}
${css}</style></head><body>${body}</body></html>`;

export const HEADER = `<header style="height:90px;display:flex;align-items:center;gap:20px;padding:0 40px">
  <img src="https://img.test/logo.png" alt="Falco-Dent" width="120" height="40">
  <nav style="display:flex;gap:16px"><a href="/">Start</a><a href="/oferta">Oferta</a><a href="/kontakt">Kontakt</a></nav>
  <a href="tel:+48123456789" style="background:#0a7;color:#fff;padding:10px 20px">Zadzwoń</a>
</header>`;

export const HERO = `<section style="min-height:500px;background:#123;color:#fff"><h1>Gabinet Stomatologiczny Falco-Dent</h1>
  <p>Nowoczesna stomatologia w centrum Krakowa od ponad dwudziestu lat.</p></section>`;

export const FOOTER = `<footer style="padding:40px;background:#222;color:#eee">
  <p>ul. Długa 5, 31-147 Kraków</p><p>Pon–Pt 9:00–18:00, Sob 9:00–13:00</p>
  <p><a href="mailto:recepcja@falcodent.pl">recepcja@falcodent.pl</a></p>
  <ul><li><a href="/polityka-prywatnosci">Polityka prywatności</a></li><li><a href="/regulamin">Regulamin</a></li></ul>
</footer>`;

describe.skipIf(!browser)('collectSiteSectionsInPage (real Chromium, REV-109)', () => {
  let context: BrowserContext;
  let page: Page;

  beforeEach(async () => {
    context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    await context.route(/^https?:\/\//, (route) =>
      route.request().url().startsWith('https://img.test/')
        ? route.fulfill({ contentType: 'image/png', body: TINY_PNG })
        : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }),
    );
    page = await context.newPage();
  });

  afterEach(async () => {
    await context.close();
  });

  const sectionsOf = async (html: string) => {
    await page.setContent(html, { waitUntil: 'load' });
    const layout = await page.evaluate(collectSiteLayoutInPage);
    const raw = await page.evaluate(collectSiteSectionsInPage);
    const reading = readSiteSections(raw, layout.blocks);
    if (reading.error) throw new Error(reading.error);
    return reading.sections!;
  };

  const expectCovered = (result: { coverage: { ratio: number; uncaptured: string[] } }) => {
    expect(result.coverage.ratio, `uncaptured: ${JSON.stringify(result.coverage.uncaptured)}`).toBeGreaterThanOrEqual(0.95);
  };

  it('reads the header with its logo, menu and call button, and the footer with address, hours and links', async () => {
    const result = await sectionsOf(pageOf(`${HEADER}${HERO}
      <section><h2>O gabinecie</h2><p>Leczymy dzieci i dorosłych, z pełną diagnostyką na miejscu.</p></section>${FOOTER}`));
    expect(result.sections.map((s) => s.role)).toEqual(['header', 'hero', 'content', 'footer']);
    const [header, hero, about, footer] = result.sections;
    expect(header!.images[0]!.src).toBe('https://img.test/logo.png');
    expect(header!.intro.links.map((l) => [l.label, l.kind])).toEqual([
      ['Start', 'link'], ['Oferta', 'link'], ['Kontakt', 'link'], ['Zadzwoń', 'phone'],
    ]);
    expect(header!.intro.links[1]!.href).toBe('https://falco.test/oferta');
    expect(hero!.intro).toMatchObject({ heading: 'Gabinet Stomatologiczny Falco-Dent', headingLevel: 1 });
    expect(about!.intro.text).toEqual(['Leczymy dzieci i dorosłych, z pełną diagnostyką na miejscu.']);
    expect(footer!.kind).toBe('contact');
    expect(footer!.extra).toEqual([{ type: 'text', text: ['ul. Długa 5, 31-147 Kraków', 'Pon–Pt 9:00–18:00, Sob 9:00–13:00'] }]);
    expect(footer!.intro.links.map((l) => l.label)).toEqual(['recepcja@falcodent.pl', 'Polityka prywatności', 'Regulamin']);
    expectCovered(result);
  });

  it('attaches a stray paragraph between two blocks to the nearer section', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>
      <p style="margin:0 40px 300px">Przyjmujemy również w soboty po wcześniejszym umówieniu.</p>
      <section><h2>Kontakt</h2><p>Zadzwoń lub napisz.</p></section>`));
    const services = result.sections.find((s) => s.intro.heading === 'Nasze usługi')!;
    expect(services.extra).toEqual([{ type: 'text', text: ['Przyjmujemy również w soboty po wcześniejszym umówieniu.'] }]);
    expect(result.coverage.uncaptured).toEqual([]);
    expectCovered(result);
  });

  it('leaves out the cookie banner and records the GDPR clause as noise', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>
      <div class="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;background:#000;color:#fff">
        Ta strona używa plików cookies. <button>Akceptuję</button></div>
      <footer style="padding:40px"><p>ul. Długa 5, Kraków</p>
        <p>Administratorem Twoich danych osobowych jest Falco-Dent sp. z o.o.</p>
        <p>© 2024 Falco-Dent. Wszelkie prawa zastrzeżone.</p></footer>`));
    const all = JSON.stringify(result.sections);
    expect(all).not.toContain('cookies');
    expect(all).not.toContain('Administratorem');
    expect(all).toContain('ul. Długa 5, Kraków');
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'noise', sample: expect.stringContaining('Administratorem Twoich danych') }),
    ]);
    expectCovered(result);
  });

  it('reads a header nested in the first block once, in the header section', async () => {
    const result = await sectionsOf(pageOf(`<div class="hero-wrap" style="min-height:700px;background:#123;color:#fff">
        <header style="height:90px;display:flex;gap:16px;padding:0 40px"><a href="/">Start</a><a href="/oferta">Oferta</a><a href="/kontakt">Kontakt</a></header>
        <h1 style="margin:120px 40px 0">Gabinet Falco-Dent</h1><p style="margin:0 40px">Stomatologia dla całej rodziny w Krakowie.</p></div>
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>`));
    const header = result.sections.find((s) => s.role === 'header')!;
    const hero = result.sections.find((s) => s.role === 'hero')!;
    expect(header.intro.links.map((l) => l.label)).toEqual(['Start', 'Oferta', 'Kontakt']);
    expect(JSON.stringify(hero)).not.toContain('Oferta');
    expect(hero.intro.heading).toBe('Gabinet Falco-Dent');
    expectCovered(result);
  });
});
