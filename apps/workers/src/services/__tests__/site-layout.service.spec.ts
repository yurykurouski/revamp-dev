import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { SiteLayoutSchema } from '@revamp/validation';
import { EVALUATE_NAME_SHIM } from '../browser.service.js';
import {
  DENSITY_AIRY_MIN,
  DENSITY_COMPACT_MAX,
  RawLayoutBlock,
  RawSiteLayout,
  classifyBlock,
  collectSiteLayoutInPage,
  densityOf,
  heroTone,
  luminance,
  parseRgb,
  readSiteLayout,
  chroma,
} from '../site-layout.service.js';

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.warn('[site-layout.spec] Chromium unavailable, skipping real-browser fixtures:', err);
}

afterAll(async () => {
  await browser?.close();
});

const block = (overrides: Partial<RawLayoutBlock> = {}): RawLayoutBlock => ({
  top: 900,
  height: 600,
  hint: '',
  heading: '',
  imageCount: 0,
  formCount: 0,
  mapEmbed: false,
  quoteCount: 0,
  priceCount: 0,
  textLength: 400,
  paddingY: 120,
  ...overrides,
});

const raw = (overrides: Partial<RawSiteLayout> = {}): RawSiteLayout => ({
  viewportWidth: 1440,
  viewportHeight: 900,
  pageHeight: 5000,
  blocks: [
    block({ top: 80, height: 700, heading: 'Dental Studio Kraków' }),
    block({ heading: 'Nasze usługi' }),
    block({ heading: 'Opinie pacjentów' }),
    block({ heading: 'Kontakt', mapEmbed: true }),
  ],
  hero: {
    headingAlign: 'center',
    headingCenterX: 720,
    headingWidth: 600,
    headingColor: 'rgb(15, 23, 42)',
    background: 'rgb(255, 255, 255)',
    slider: false,
    backgroundMedia: false,
  },
  header: { navLinkCount: 5, logoCenterX: 120, sticky: true, hasCta: true },
  ...overrides,
});

describe('classifyBlock (REV-104)', () => {
  it('names a section by its heading, in the languages of the audited sites', () => {
    expect(classifyBlock(block({ heading: 'Our Services' }))).toBe('services');
    expect(classifyBlock(block({ heading: 'Usługi stomatologiczne' }))).toBe('services');
    expect(classifyBlock(block({ heading: 'Наши услуги' }))).toBe('services');
    expect(classifyBlock(block({ heading: 'Паслугі' }))).toBe('services');
    expect(classifyBlock(block({ heading: 'Mūsų paslaugos' }))).toBe('services');
    expect(classifyBlock(block({ heading: 'O nas' }))).toBe('about');
    expect(classifyBlock(block({ heading: 'Пра нас' }))).toBe('about');
    expect(classifyBlock(block({ heading: 'O kancelarii' }))).toBe('about');
    expect(classifyBlock(block({ heading: 'Galeria realizacji' }))).toBe('gallery');
    expect(classifyBlock(block({ heading: 'Отзывы клиентов' }))).toBe('reviews');
    expect(classifyBlock(block({ heading: 'What our clients say' }))).toBe('reviews');
    // "What patients say about us" names reviews, not the about section
    expect(classifyBlock(block({ heading: 'Co mówią o nas pacjenci?' }))).toBe('reviews');
    expect(classifyBlock(block({ heading: 'Cennik' }))).toBe('pricing');
    expect(classifyBlock(block({ heading: 'Nasz zespół' }))).toBe('team');
    expect(classifyBlock(block({ heading: 'Częste pytania' }))).toBe('faq');
    expect(classifyBlock(block({ heading: 'Kontakt i dojazd' }))).toBe('contact');
  });

  it('prefers the heading over ids and classes, and falls back to them', () => {
    expect(classifyBlock(block({ heading: 'Opinie', hint: 'section-services' }))).toBe('reviews');
    expect(classifyBlock(block({ heading: 'Witamy w gabinecie', hint: 'about-us elementor-section' }))).toBe('about');
    expect(classifyBlock(block({ heading: '', hint: 'testimonials-slider' }))).toBe('reviews');
    expect(classifyBlock(block({ heading: 'Kim jesteśmy?', hint: 'o-nas' }))).toBe('about');
  });

  it('falls back to the structure when nothing names the block', () => {
    expect(classifyBlock(block({ mapEmbed: true }))).toBe('map');
    expect(classifyBlock(block({ mapEmbed: true, formCount: 1 }))).toBe('contact');
    expect(classifyBlock(block({ formCount: 1 }))).toBe('contact');
    expect(classifyBlock(block({ quoteCount: 3 }))).toBe('reviews');
    expect(classifyBlock(block({ priceCount: 5 }))).toBe('pricing');
    expect(classifyBlock(block({ imageCount: 8, textLength: 100 }))).toBe('gallery');
    expect(classifyBlock(block({ imageCount: 4, textLength: 2000 }))).toBe('other');
    expect(classifyBlock(block())).toBe('other');
  });

  it('names a "why us" section features (REV-109)', () => {
    expect(classifyBlock(block({ heading: 'Co nas wyróżnia' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Dlaczego my?' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Why choose us' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Почему мы' }))).toBe('features');
    expect(classifyBlock(block({ heading: 'Nasze atuty' }))).toBe('features');
    // Existing kinds keep their words
    expect(classifyBlock(block({ heading: 'O nas' }))).toBe('about');
    expect(classifyBlock(block({ heading: 'Nasz zespół' }))).toBe('team');
  });
});

describe('colors (REV-104)', () => {
  it('parses rgb() and rgba() computed colors', () => {
    expect(parseRgb('rgb(255, 0, 10)')).toEqual({ r: 255, g: 0, b: 10 });
    expect(parseRgb('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseRgb('transparent')).toBeUndefined();
    expect(parseRgb(undefined)).toBeUndefined();
  });

  it('measures luminance and chroma', () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(chroma({ r: 128, g: 128, b: 128 })).toBe(0);
    expect(chroma({ r: 248, g: 250, b: 252 })).toBeLessThan(0.05);
    expect(chroma({ r: 37, g: 99, b: 235 })).toBeGreaterThan(0.7);
  });

  it('reads the first screen tone from its background and text', () => {
    const tone = (background: string, headingColor = 'rgb(15, 23, 42)', media = false) =>
      heroTone({ background, headingColor, backgroundMedia: media, slider: false });
    expect(tone('rgb(255, 255, 255)')).toBe('light');
    expect(tone('rgb(248, 250, 252)')).toBe('light');
    expect(tone('rgb(224, 242, 254)')).toBe('tinted');
    expect(tone('rgb(15, 23, 42)', 'rgb(255, 255, 255)')).toBe('dark');
    expect(tone('rgb(120, 20, 60)', 'rgb(255, 255, 255)')).toBe('brand');
    expect(tone('rgb(37, 99, 235)', 'rgb(255, 255, 255)')).toBe('brand');
    // A photo behind the copy has no color of its own: light text means it is dark
    expect(tone('rgb(255, 255, 255)', 'rgb(255, 255, 255)', true)).toBe('dark');
    expect(tone('rgb(255, 255, 255)', 'rgb(20, 20, 20)', true)).toBe('light');
  });
});

describe('densityOf (REV-104)', () => {
  it('uses the median white space of the sections', () => {
    expect(densityOf([block({ paddingY: 20 }), block({ paddingY: 40 }), block({ paddingY: 400 })])).toBe('compact');
    expect(densityOf([block({ paddingY: DENSITY_AIRY_MIN + 40 }), block({ paddingY: 300 })])).toBe('airy');
    expect(densityOf([block({ paddingY: DENSITY_COMPACT_MAX }), block({ paddingY: DENSITY_AIRY_MIN })])).toBe('comfortable');
    expect(densityOf([])).toBe('comfortable');
  });
});

describe('readSiteLayout (REV-104)', () => {
  it('reads the sections after the first screen in page order, with the hero and header', () => {
    const reading = readSiteLayout(raw());
    expect(reading.error).toBeUndefined();
    expect(reading.layout).toEqual({
      sections: [
        { kind: 'services', heading: 'Nasze usługi' },
        { kind: 'reviews', heading: 'Opinie pacjentów' },
        { kind: 'contact', heading: 'Kontakt' },
      ],
      hero: { media: 'none', align: 'center', tone: 'light' },
      nav: { itemCount: 5, centeredLogo: false, sticky: true, hasCta: true },
      density: 'comfortable',
    });
    expect(SiteLayoutSchema.safeParse(reading.layout).success).toBe(true);
  });

  it('merges a section split over consecutive blocks', () => {
    const reading = readSiteLayout(
      raw({ blocks: [block({ top: 0 }), block({ heading: 'Usługi' }), block({ hint: 'services-grid' }), block({ heading: 'O nas' })] }),
    );
    expect(reading.layout?.sections.map((section) => section.kind)).toEqual(['services', 'about']);
  });

  it('reads the photo beside the headline, and its side', () => {
    const hero = { ...raw().hero!, headingAlign: 'start', headingCenterX: 400, headingWidth: 520 };
    expect(readSiteLayout(raw({ hero: { ...hero, sideMediaCenterX: 1050 } })).layout?.hero).toEqual({
      media: 'side',
      mediaSide: 'right',
      align: 'left',
      tone: 'light',
    });
    expect(readSiteLayout(raw({ hero: { ...hero, headingCenterX: 1000, sideMediaCenterX: 380 } })).layout?.hero.mediaSide).toBe('left');
  });

  it('prefers a slider, then a backdrop photo, over a side photo', () => {
    const hero = raw().hero!;
    expect(readSiteLayout(raw({ hero: { ...hero, slider: true, backgroundMedia: true, sideMediaCenterX: 1000 } })).layout?.hero.media).toBe('slider');
    expect(readSiteLayout(raw({ hero: { ...hero, backgroundMedia: true, sideMediaCenterX: 1000 } })).layout?.hero.media).toBe('background');
  });

  it('counts a heading as centred by its alignment or its position', () => {
    const hero = raw().hero!;
    expect(readSiteLayout(raw({ hero: { ...hero, headingAlign: 'start', headingCenterX: 720, headingWidth: 500 } })).layout?.hero.align).toBe('center');
    expect(readSiteLayout(raw({ hero: { ...hero, headingAlign: 'left', headingCenterX: 300, headingWidth: 500 } })).layout?.hero.align).toBe('left');
    // A full-width heading is centred on the screen whatever its text does
    expect(readSiteLayout(raw({ hero: { ...hero, headingAlign: 'left', headingCenterX: 720, headingWidth: 1300 } })).layout?.hero.align).toBe('left');
  });

  it('reads a centred logo, and a page without a header', () => {
    expect(readSiteLayout(raw({ header: { navLinkCount: 6, logoCenterX: 730, sticky: false, hasCta: false } })).layout?.nav).toEqual({
      itemCount: 6,
      centeredLogo: true,
      sticky: false,
      hasCta: false,
    });
    expect(readSiteLayout(raw({ header: undefined })).layout?.nav).toEqual({ itemCount: 0, centeredLogo: false, sticky: false, hasCta: false });
  });

  it('keeps at most 20 sections', () => {
    const blocks = [block({ top: 0 }), ...Array.from({ length: 30 }, (_, i) => block({ heading: i % 2 ? 'Usługi' : 'Opinie' }))];
    expect(readSiteLayout(raw({ blocks })).layout?.sections).toHaveLength(20);
  });

  it('reports why a layout could not be read instead of inventing one', () => {
    expect(readSiteLayout(undefined)).toEqual({ error: 'The page layout could not be collected' });
    expect(readSiteLayout({ ...raw(), blocks: 'x' as never }).error).toBe('The page layout could not be collected');
    expect(readSiteLayout(raw({ blocks: [block()] })).error).toBe('The page splits into 1 block; no sections to read');
    expect(readSiteLayout(raw({ blocks: [] })).error).toBe('The page splits into 0 blocks; no sections to read');
    expect(readSiteLayout(raw({ hero: undefined })).error).toBe('No block starts on the first screen');
  });
});

// Two home pages with different structures, measured in a real browser
const PHOTO_SITE = `<!doctype html><html><head><style>
  body { margin: 0; font-family: sans-serif; }
  header { position: sticky; top: 0; height: 80px; display: flex; justify-content: space-between; align-items: center; padding: 0 40px; background: #fff; }
  header nav a { margin-left: 24px; }
  .cta { background: #e11d48; color: #fff; padding: 10px 16px; }
  section { padding: 4px 40px; }
  .hero { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; min-height: 600px; background: #0f172a; }
  .hero h1 { color: #fff; font-size: 56px; text-align: left; }
  .hero img { width: 100%; height: 480px; display: block; background: #999; }
  .gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .gallery img { width: 100%; height: 200px; display: block; background: #ccc; }
</style></head><body>
  <header><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="120" height="40" alt="logo">
    <nav><a href="#g">Galeria</a><a href="#u">Usługi</a><a href="#o">O nas</a><a href="#k">Kontakt</a><a class="cta" href="#k">Zadzwoń</a></nav></header>
  <main>
    <section class="hero"><div><h1>Restauracja Pod Lipą</h1><p>Kuchnia polska od 1998 roku.</p></div>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></section>
    <section id="galeria"><h2>Galeria</h2><div class="gallery">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></div></section>
    <section><h2>Menu i usługi</h2><p>Obiady, catering, przyjęcia okolicznościowe.</p><p>Sala na 80 osób.</p></section>
    <section><h2>O nas</h2><p>Rodzinna restauracja w centrum miasta.</p></section>
    <section><h2>Kontakt</h2><form><input name="n"><button>Wyślij</button></form></section>
  </main>
  <footer style="height:200px">© Pod Lipą</footer>
</body></html>`;

const TEXT_SITE = `<!doctype html><html><head><style>
  body { margin: 0; font-family: serif; }
  .top { height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .wrap > div { padding: 200px 40px; }
  .intro { text-align: center; background: #fff; }
  .intro h1 { font-size: 48px; color: #111; }
</style></head><body>
  <div role="banner" class="top"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="50" alt="logo"><a href="#x">Start</a></div>
  <div class="wrap">
    <div class="intro"><h1>Kancelaria Radcy Prawnego</h1><p>Prawo rodzinne i gospodarcze.</p></div>
    <div id="o-nas"><h2>O kancelarii</h2><p>Od 2005 roku doradzamy firmom i osobom prywatnym.</p></div>
    <div><h2>Opinie klientów</h2><blockquote>Rzetelna pomoc.</blockquote><blockquote>Polecam.</blockquote></div>
    <div><h2>Specjalizacje</h2><p>Prawo pracy, umowy, spory sądowe.</p></div>
  </div>
</body></html>`;

describe.skipIf(!browser)('collectSiteLayoutInPage (real Chromium, REV-104)', () => {
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

  const layoutOf = async (html: string) => {
    await page.setContent(html);
    return readSiteLayout(await page.evaluate(collectSiteLayoutInPage));
  };

  it('reads an image-led page: photo beside a dark hero, sections in order, a menu with a button', async () => {
    const { layout, error } = await layoutOf(PHOTO_SITE);
    expect(error).toBeUndefined();
    expect(layout!.sections.map((section) => section.kind)).toEqual(['gallery', 'services', 'about', 'contact']);
    expect(layout!.hero).toEqual({ media: 'side', mediaSide: 'right', align: 'left', tone: 'dark' });
    expect(layout!.nav).toEqual({ itemCount: 5, centeredLogo: false, sticky: true, hasCta: true });
    expect(layout!.density).toBe('compact');
  });

  it('reads a text-led page: centred light hero, a centred logo, airy sections', async () => {
    const { layout, error } = await layoutOf(TEXT_SITE);
    expect(error).toBeUndefined();
    expect(layout!.sections.map((section) => section.kind)).toEqual(['about', 'reviews', 'services']);
    expect(layout!.hero).toEqual({ media: 'none', align: 'center', tone: 'light' });
    expect(layout!.nav.centeredLogo).toBe(true);
    expect(layout!.nav.itemCount).toBe(1);
    expect(layout!.density).toBe('airy');
  });

  it('does not take a header or footer built from plain divs for a section', async () => {
    const { layout, error } = await layoutOf(`<!doctype html><body style="margin:0">
      <div class="header" style="height:120px"><a href="#a">Start</a><a href="#b">Oferta</a><a href="#c">Kontakt</a></div>
      <div class="hero" style="height:600px"><h1>Serwis opon</h1></div>
      <div style="height:500px"><h2>Oferta</h2><p>Wymiana opon.</p></div>
      <div id="footer" style="height:300px">© Serwis</div>
    </body>`);
    expect(error).toBeUndefined();
    expect(layout!.sections.map((section) => section.kind)).toEqual(['services']);
    expect(layout!.nav.itemCount).toBe(3);
  });

  it('reports a page that does not split into sections', async () => {
    const { layout, error } = await layoutOf('<!doctype html><body><p>Coming soon</p></body>');
    expect(layout).toBeUndefined();
    expect(error).toMatch(/no sections to read/);
  });

  it('tags each block it reads with its index, for the section reader (REV-109)', async () => {
    await page.setContent(PHOTO_SITE);
    const layout = await page.evaluate(collectSiteLayoutInPage);
    const tags = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-revamp-block]')).map((el) => el.getAttribute('data-revamp-block')),
    );
    expect(tags).toEqual(layout.blocks.map((_, index) => String(index)));
    // A second walk replaces the tags instead of adding to them
    await page.evaluate(collectSiteLayoutInPage);
    expect(await page.evaluate(() => document.querySelectorAll('[data-revamp-block]').length)).toBe(layout.blocks.length);
  });
});
