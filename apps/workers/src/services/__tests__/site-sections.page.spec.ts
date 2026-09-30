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

  it('reads an Elementor-style card grid in nested wrappers', async () => {
    const card = (name: string, i: number) => `
      <div class="elementor-column elementor-element elementor-element-a${i}f3" style="flex:1"><div class="elementor-widget-wrap">
        <div class="elementor-widget elementor-widget-image-box"><div class="elementor-widget-container" style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);padding:16px">
          <img src="https://img.test/s${i}.png" alt="${name}" width="300" height="200" style="display:block;width:100%;height:auto">
          <h3>${name}</h3><p>Pełna diagnostyka, plan leczenia i opieka po zabiegu ${name.toLowerCase()} w naszym gabinecie.</p><p>od ${150 + i * 50} zł</p>
        </div></div>
      </div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section class="elementor-section elementor-element-3f2a1b" style="background:#f5f7fa">
        <div class="elementor-container"><div class="elementor-column"><div class="elementor-widget-wrap"><div class="elementor-widget"><div class="elementor-widget-container"><h2>Nasze usługi</h2></div></div></div></div></div>
        <div class="elementor-container" style="display:flex;gap:24px">${['Implanty', 'Ortodoncja', 'Wybielanie'].map(card).join('')}</div>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasze usługi')!;
    expect(s.kind).toBe('services');
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(3);
    expect(s.items.map((i) => [i.title, i.price])).toEqual([['Implanty', 'od 150 zł'], ['Ortodoncja', 'od 200 zł'], ['Wybielanie', 'od 250 zł']]);
    expect(s.items[0]!.text).toEqual(['Pełna diagnostyka, plan leczenia i opieka po zabiegu implanty w naszym gabinecie.']);
    expect(s.items[0]!.image!.src).toBe('https://img.test/s0.png');
    expect(s.itemStyle).toMatchObject({ background: '#ffffff', radius: 12, shadow: true });
    expect(s.style.background).toBe('#f5f7fa');
    expectCovered(result);
  });

  it('reads a Divi-style team with round portraits', async () => {
    const people = [
      ['dr Anna Nowak', 'Ortodonta'], ['dr Jan Kowalski', 'Chirurg stomatolog'], ['lek. Ewa Wiśniewska', 'Endodonta'],
      ['dr Piotr Zieliński', 'Implantolog'], ['Maria Lewandowska', 'Higienistka'], ['Karolina Wójcik', 'Asystentka'],
    ];
    const member = ([name, role]: string[], i: number) => `
      <div class="et_pb_column et_pb_column_1_3" style="width:30%;text-align:center"><div class="et_pb_module et_pb_team_member et_pb_team_member_${i}">
        <div class="et_pb_team_member_image" style="border-radius:50%;overflow:hidden;width:160px;height:160px;margin:0 auto"><img src="https://img.test/p${i}.jpg" alt="${name}" width="160" height="160" style="display:block"></div>
        <div class="et_pb_team_member_description"><h4 class="et_pb_module_header">${name}</h4><p class="et_pb_member_position">${role}</p>
          <div><p>Absolwentka Uniwersytetu Jagiellońskiego, pracuje z pacjentami od lat.</p></div></div>
      </div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <div class="et_pb_section et_pb_section_3" style="padding:60px 40px">
        <div class="et_pb_row"><div class="et_pb_column"><div class="et_pb_text"><div class="et_pb_text_inner"><h2>Poznaj nas</h2></div></div></div></div>
        <div class="et_pb_row" style="display:flex;flex-wrap:wrap;gap:20px">${people.map(member).join('')}</div>
      </div>`));
    const s = result.sections.find((x) => x.intro.heading === 'Poznaj nas')!;
    expect(s.kind).toBe('team');
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(3);
    expect(s.items).toHaveLength(6);
    expect(s.items[0]).toMatchObject({ title: 'dr Anna Nowak', subtitle: 'Ortodonta', text: ['Absolwentka Uniwersytetu Jagiellońskiego, pracuje z pacjentami od lat.'] });
    expect(s.items[0]!.image!.src).toBe('https://img.test/p0.jpg');
    expect(s.itemStyle!.imageShape).toBe('round');
    expect(s.itemStyle!.align).toBe('center');
    expectCovered(result);
  });

  it('reads an FAQ accordion with collapsed answers', async () => {
    const qa = [
      ['Czy leczenie kanałowe boli?', 'Zabieg wykonujemy w znieczuleniu, więc jest bezbolesny.'],
      ['Ile trwa wizyta kontrolna?', 'Około trzydziestu minut, razem z przeglądem.'],
      ['Czy przyjmujecie dzieci?', 'Tak, od trzeciego roku życia.'],
    ];
    const result = await sectionsOf(pageOf(`${HERO}
      <section id="faq"><h2>Najczęściej zadawane pytania</h2><div class="accordion">
        ${qa.map(([q, a]) => `<div class="accordion-item"><button class="accordion-button" aria-expanded="false">${q}</button><div class="accordion-body" style="display:none"><p>${a}</p></div></div>`).join('')}
      </div></section>`));
    const s = result.sections.find((x) => x.kind === 'faq')!;
    expect(s.arrangement).toBe('accordion');
    expect(s.items.map((i) => [i.title, i.text])).toEqual(qa.map(([q, a]) => [q, [a]]));
    expectCovered(result);
  });

  it('reads a details-based accordion too', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Pytania</h2>
        <details><summary>Czy są raty?</summary><p>Tak, raty 0% do dwunastu miesięcy.</p></details>
        <details><summary>Czy jest parking?</summary><p>Tak, bezpłatny, przy wejściu.</p></details>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Pytania')!;
    expect(s.arrangement).toBe('accordion');
    expect(s.items.map((i) => i.title)).toEqual(['Czy są raty?', 'Czy jest parking?']);
  });

  it('reads a swiper slider without its cloned slides', async () => {
    const slide = (quote: string, name: string, cls = 'swiper-slide') => `
      <div class="${cls}" style="width:400px;flex-shrink:0"><div class="stars" aria-label="Ocena 5/5"><span class="star"></span><span class="star"></span><span class="star"></span><span class="star"></span><span class="star"></span></div>
      <blockquote>${quote}</blockquote><p class="author">${name}</p></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="overflow:hidden"><h2>Opinie pacjentów</h2><div class="swiper"><div class="swiper-wrapper" style="display:flex">
        ${slide('Klon slajdu, nie opinia.', 'Klon', 'swiper-slide swiper-slide-duplicate')}
        ${slide('Bezbolesne leczenie i miła obsługa.', 'Anna K.')}${slide('Polecam każdemu, świetni lekarze.', 'Tomasz W.')}${slide('Szybka wizyta, bez kolejek.', 'Ewa M.')}
        ${slide('Klon slajdu, nie opinia.', 'Klon', 'swiper-slide swiper-slide-duplicate')}
      </div></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Opinie pacjentów')!;
    expect(s.kind).toBe('reviews');
    expect(s.arrangement).toBe('slider');
    expect(s.items.map((i) => [i.title, i.text, i.rating])).toEqual([
      ['Anna K.', ['Bezbolesne leczenie i miła obsługa.'], 5],
      ['Tomasz W.', ['Polecam każdemu, świetni lekarze.'], 5],
      ['Ewa M.', ['Szybka wizyta, bez kolejek.'], 5],
    ]);
    expect(JSON.stringify(result)).not.toContain('Klon');
    expectCovered(result);
  });

  it('does not take a slide position label ("1 / 5") for a rating (Falco-Dent)', async () => {
    const slide = (n: number, text: string) =>
      `<div class="swiper-slide" role="group" aria-label="${n} / 5" style="width:400px;flex-shrink:0"><p>${text}</p></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="overflow:hidden"><h2>Nasze zabiegi</h2><div class="swiper"><div class="swiper-wrapper" style="display:flex">
        ${slide(1, 'Estetyczne nakładki ortodontyczne')}${slide(2, 'Stomatologia estetyczna i licówki')}${slide(3, 'Zabiegi laserowe i profilaktyka')}
        ${slide(4, 'Implanty i protetyka na miejscu')}${slide(5, 'NOWOŚĆ! Medycyna estetyczna')}
      </div></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasze zabiegi')!;
    expect(s.arrangement).toBe('slider');
    expect(s.items).toHaveLength(5);
    expect(s.items.map((i) => i.rating)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('leaves out icon-font glyphs (private-use characters) from the copy (Dentalux)', async () => {
    const card = (title: string, text: string) =>
      `<div style="flex:1"><span class="et-pb-icon">\ue900</span><h4>${title}</h4><p>${text}</p></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Udogodnienia</h2><div style="display:flex;gap:20px">
        ${card('Elastyczne godziny', 'Wydłużyliśmy godziny pracy.')}${card('Dogodna lokalizacja', 'Blisko stacji metra.')}${card('Leczenie na raty', 'Raty z MediRaty.')}
      </div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Udogodnienia')!;
    expect(s.items.map((i) => [i.title, i.text])).toEqual([
      ['Elastyczne godziny', ['Wydłużyliśmy godziny pracy.']],
      ['Dogodna lokalizacja', ['Blisko stacji metra.']],
      ['Leczenie na raty', ['Raty z MediRaty.']],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/\p{Co}/u);
  });

  it('leaves slider arrows and their hidden labels out of the copy (Falco-Dent, Dentalux)', async () => {
    const quote = (text: string, name: string) => `<div class="slick-slide" style="width:400px;flex-shrink:0"><p>${text}</p><h4>${name}</h4></div>`;
    const result = await sectionsOf(pageOf(`<a class="skip-link screen-reader-text" href="#content"
        style="position:absolute;clip:rect(0,0,0,0);clip-path:inset(50%);width:1px;height:1px;overflow:hidden">Skip to content</a>${HERO}
      <section style="overflow:hidden"><h2>Opinie</h2><div class="slick-slider">
        <button class="slick-prev slick-arrow" style="width:28px;height:28px;overflow:hidden;text-indent:-999px">Previous</button>
        <div class="slick-track" style="display:flex">${quote('Świetny gabinet i miła obsługa.', 'Anna K.')}${quote('Bezbolesne leczenie kanałowe.', 'Marta B.')}</div>
        <button class="slick-next slick-arrow" style="width:28px;height:28px;overflow:hidden;text-indent:-999px">Next</button>
      </div></section>
      <section><h2>Aktualności</h2><p>Kolejne wyróżnienie dla naszego gabinetu w tym roku.</p>
        <a class="et-pb-arrow-prev" href="#"><span style="display:none">Poprzedni</span></a><a class="et-pb-arrow-next" href="#"><span style="display:none">Dalej</span></a></section>`));
    const text = JSON.stringify(result.sections);
    for (const word of ['Skip to content', 'Previous', 'Next', 'Poprzedni', 'Dalej']) expect(text).not.toContain(word);
    expect(result.sections.find((x) => x.intro.heading === 'Opinie')!.items.map((i) => i.title)).toEqual(['Anna K.', 'Marta B.']);
  });

  it('leaves screen-reader-only text such as a skip link out of the copy (Falco-Dent)', async () => {
    const result = await sectionsOf(pageOf(`<div class="site"><a class="skip-link screen-reader-text" href="#content"
        style="position:absolute;clip:rect(1px,1px,1px,1px);clip-path:inset(50%);width:1px;height:1px;overflow:hidden">Skip to content</a>
      <div id="wrap">${HEADER}${HERO}<section><h2>O nas</h2><p>Gabinet działa od 1995 roku na Bielanach.</p></section></div></div>`));
    expect(JSON.stringify(result.sections)).not.toContain('Skip to content');
    expect(result.coverage.uncaptured).toEqual([]);
  });

  it('does not count Tailwind "start" classes as rating stars (Elefant)', async () => {
    const post = (title: string) => `<div class="group flex flex-col items-start justify-between" style="flex:1">
      <div class="mt-8 flex items-center sm:justify-start text-xs"><time>07 sierpnia 2025</time></div>
      <h3 class="mt-4 flex sm:justify-start sm:text-start">${title}</h3><p class="mt-5 sm:text-start">Zapraszamy wszystkich pacjentów.</p>
      <div class="mt-4 relative flex items-center sm:justify-start"></div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Wydarzenia</h2><div style="display:flex;gap:20px">${post('Turniej ElefantCup')}${post('Dzień Dziecka')}${post('Walentynki')}</div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Wydarzenia')!;
    expect(s.items.map((i) => i.title)).toEqual(['Turniej ElefantCup', 'Dzień Dziecka', 'Walentynki']);
    expect(s.items.map((i) => i.rating)).toEqual([undefined, undefined, undefined]);
  });

  it('reads cards laid out in rows under an intro row as one grid, with the intro as the heading (Dentalux offer)', async () => {
    const card = (title: string, text: string) =>
      `<div class="col" style="flex:1;background:#f3f4f6;padding:20px"><div class="icon"><span class="et-pb-icon">\ue900</span></div><div><h4><a href="/oferta">${title}</a></h4></div><div><p>${text}</p></div></div>`;
    const row = (a: string, b: string) => `<div class="row" style="display:flex;gap:40px;margin:20px 0">${a}${b}</div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><div class="row"><div class="col"><div><h2 style="font-size:52px">Dowiedz się, jak możemy zadbać o Twój uśmiech</h2></div><div><p>Odkryj pełną ofertę zabiegów w naszych placówkach</p></div></div></div>
        ${row(card('Implanty', 'Zabiegi implantologiczne od 1994 roku.'), card('Stomatologia zachowawcza', 'Nowoczesne leczenie próchnicy.'))}
        ${row(card('Profilaktyka', 'Skaling, piaskowanie i fluoryzacja.'), card('Endodoncja', 'Leczenie kanałowe pod mikroskopem.'))}
        ${row(card('Ortodoncja', 'Aparaty stałe i nakładkowe.'), card('Stomatologia dziecięca', 'Wizyty adaptacyjne dla najmłodszych.'))}
      </section>`));
    const s = result.sections.find((x) => x.intro.heading?.startsWith('Dowiedz się'))!;
    expect(s.intro.text).toEqual(['Odkryj pełną ofertę zabiegów w naszych placówkach']);
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(2);
    expect(s.items.map((i) => [i.title, i.text])).toEqual([
      ['Implanty', ['Zabiegi implantologiczne od 1994 roku.']],
      ['Stomatologia zachowawcza', ['Nowoczesne leczenie próchnicy.']],
      ['Profilaktyka', ['Skaling, piaskowanie i fluoryzacja.']],
      ['Endodoncja', ['Leczenie kanałowe pod mikroskopem.']],
      ['Ortodoncja', ['Aparaty stałe i nakładkowe.']],
      ['Stomatologia dziecięca', ['Wizyty adaptacyjne dla najmłodszych.']],
    ]);
    expect(s.itemStyle?.background).toBe('#f3f4f6');
    expectCovered(result);
  });

  it('leaves out a hidden responsive copy of content shown elsewhere on the page (Dentalux)', async () => {
    const box = (heading: string) => `<div class="promo" style="background:#fbcfe8;padding:30px"><h4>30 lat dbamy o uśmiech Warszawy</h4>
      <h3>${heading}</h3><h2>Cieszymy się, że jesteś!</h2><h5>Centrum przy ul. Racławickiej 131 zapewnia pełną opiekę stomatologiczną.</h5></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><div style="display:none">${box('Dentysta Warszawa Mokotów – Centrum Dentalux')}</div>
        <h2>Nasza oferta</h2><p>Leczenie zachowawcze, protetyka i implanty w jednym miejscu.</p></section>
      <section>${box('Dentysta Warszawa Mokotów Centrum Dentalux')}</section>`));
    const offer = result.sections.find((x) => x.intro.heading === 'Nasza oferta')!;
    expect(JSON.stringify(offer)).not.toContain('Cieszymy');
    expect(JSON.stringify(result.sections).match(/Cieszymy się/g)).toHaveLength(1);
    expectCovered(result);
  });

  it('takes a small label above a larger heading for the eyebrow, and the larger one for the heading (Falco-Dent)', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><div><div class="title-container"><h2 style="font-size:20px"><span>O</span><span> </span><span>NAS</span></h2></div></div>
        <div><h2 style="font-size:36px">Poznaj gabinet stomatologiczny Falco-Dent</h2></div>
        <p>Gabinet stomatologiczny Falco-Dent powstał w 1995 roku z pasji do stomatologii.</p></section>
      <section><h2 style="font-size:32px">Kontakt</h2><h3 style="font-size:20px">Zapraszamy od poniedziałku do piątku</h3><p>Dzwoń lub pisz.</p></section>`));
    const about = result.sections.find((x) => x.intro.heading === 'Poznaj gabinet stomatologiczny Falco-Dent')!;
    expect(about.intro.eyebrow).toBe('O NAS');
    expect(about.intro.text).toEqual(['Gabinet stomatologiczny Falco-Dent powstał w 1995 roku z pasji do stomatologii.']);
    // A smaller line under the heading stays copy
    const contact = result.sections.find((x) => x.intro.heading === 'Kontakt')!;
    expect(contact.intro.eyebrow).toBeUndefined();
    expect(contact.intro.text).toEqual(['Zapraszamy od poniedziałku do piątku', 'Dzwoń lub pisz.']);
  });

  it('keeps a button whose label sits in a block inside it as a link, not also as text (Falco-Dent)', async () => {
    const button = (label: string) => `<div class="btn-wrap" style="display:inline-block"><a href="https://g.page/r/falco/review"
      style="display:inline-block;padding:20px 60px;background:#173784;color:#fff"><span style="display:block">${label}</span></a></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Opinie</h2><p>Zobacz, co mówią o nas pacjenci po wizycie.</p>
        <div>${button('Zobacz więcej opinii')}</div><div>${button('Dodaj nową opinię')}</div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Opinie')!;
    expect(s.intro.links.map((l) => l.label)).toEqual(['Zobacz więcej opinii', 'Dodaj nową opinię']);
    expect(JSON.stringify({ text: s.intro.text, extra: s.extra })).not.toContain('Zobacz więcej opinii');
    expect(JSON.stringify({ text: s.intro.text, extra: s.extra })).not.toContain('Dodaj nową opinię');
  });

  it('reads two rows of three cards under a heading row as one grid of six (Dentalux amenities)', async () => {
    const card = (title: string, text: string) =>
      `<div class="col" style="flex:1"><div class="icon"><span>\ue900</span></div><div><h3><strong>${title}</strong></h3><p>${text}</p></div></div>`;
    const row = (cards: string) => `<div class="row" style="display:flex;gap:40px;margin:20px 0">${cards}</div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><div class="row"><div class="col"><div><h2>Zadbaliśmy o udogodnienia</h2></div></div></div>
        ${row(card('Elastyczne godziny', 'Wydłużyliśmy godziny pracy.') + card('Dogodna lokalizacja', 'Blisko stacji metra.') + card('Raty', 'Leczenie na raty.'))}
        ${row(card('Klimatyzacja', 'Klimatyzowane gabinety.') + card('Internet', 'Bezpłatne Wi-Fi.') + card('Dostępność', 'Wygodne podjazdy.'))}
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Zadbaliśmy o udogodnienia')!;
    expect(s.columns).toBe(3);
    expect(s.items.map((i) => i.title)).toEqual(['Elastyczne godziny', 'Dogodna lokalizacja', 'Raty', 'Klimatyzacja', 'Internet', 'Dostępność']);
    expect(s.extra).toEqual([]);
  });

  it('takes a label of up to 60 characters above a larger heading for the eyebrow (Dentalux)', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h4 style="font-size:14px">30 lat dbamy o uśmiech Warszawy – a teraz Twój</h4>
        <h1 style="font-size:48px">Dentysta Warszawa Mokotów</h1><h2 style="font-size:32px">Cieszymy się, że jesteś!</h2><p>Zapewniamy pełną opiekę.</p></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Dentysta Warszawa Mokotów')!;
    expect(s.intro.eyebrow).toBe('30 lat dbamy o uśmiech Warszawy – a teraz Twój');
    expect(s.intro.text).toEqual(['Cieszymy się, że jesteś!', 'Zapewniamy pełną opiekę.']);
  });

  it('reads the cards of a carousel beside an intro column as the items (Elefant offer)', async () => {
    const card = (title: string, text: string) => `<div class="px-2 group flex flex-col" style="width:268px;flex-shrink:0">
      <div><div style="overflow:hidden"><img src="https://img.test/${title.length}.jpg" alt="" style="width:252px;height:168px"></div>
        <div><h3><a href="/oferta/${title.length}"><span>${title}</span></a></h3></div></div>
      <div><p>${text}</p><div><a href="/oferta/${title.length}" style="display:inline-flex;padding:8px 16px;border:1px solid #c0c"><span><img src="https://img.test/icon.png" alt="" style="width:20px;height:20px"></span> Więcej</a></div></div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:24px">
        <div><div><h2 style="font-size:48px">OFERTA</h2><h3 style="font-size:30px">Usługi skierowane do dzieci, młodzieży i dorosłych.</h3>
          <p>Każdego dnia mali i więksi pacjenci otrzymują profesjonalne wsparcie.</p>
          <div><a href="/oferta" style="display:inline-flex;padding:8px 16px;background:#c0c;color:#fff"><span><img src="https://img.test/icon.png" alt="" style="width:20px;height:20px"></span> Zobacz nasze usługi</a></div></div></div>
        <div><div style="overflow:hidden"><div><button aria-label="Poprzedni"><svg width="20" height="20"></svg></button><button aria-label="Następny"><svg width="20" height="20"></svg></button></div>
          <div style="display:flex">${card('Leczenie zachowawcze', 'Zapobieganie i leczenie próchnicy u dzieci.')}${card('Profilaktyka', 'Lakowanie bruzd i lakierowanie zębów.')}
            ${card('Narkoza i sedacja wziewna', 'Gaz rozweselający, bezpieczny i skuteczny.')}${card('Chirurgia', 'Bezpieczne zabiegi chirurgiczne dla dzieci.')}${card('Ortodoncja', 'Aparaty dla dzieci i młodzieży.')}</div></div></div>
      </div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'OFERTA')!;
    expect(s.intro.text).toEqual(['Usługi skierowane do dzieci, młodzieży i dorosłych.', 'Każdego dnia mali i więksi pacjenci otrzymują profesjonalne wsparcie.']);
    expect(s.intro.links.map((l) => l.label)).toEqual(['Zobacz nasze usługi']);
    // Cards running past the edge of a clipping box, on one row, are a carousel
    expect(s.arrangement).toBe('slider');
    expect(s.items.map((i) => [i.title, i.text, i.links.map((l) => l.label)])).toEqual([
      ['Leczenie zachowawcze', ['Zapobieganie i leczenie próchnicy u dzieci.'], ['Leczenie zachowawcze', 'Więcej']],
      ['Profilaktyka', ['Lakowanie bruzd i lakierowanie zębów.'], ['Profilaktyka', 'Więcej']],
      ['Narkoza i sedacja wziewna', ['Gaz rozweselający, bezpieczny i skuteczny.'], ['Narkoza i sedacja wziewna', 'Więcej']],
      ['Chirurgia', ['Bezpieczne zabiegi chirurgiczne dla dzieci.'], ['Chirurgia', 'Więcej']],
      ['Ortodoncja', ['Aparaty dla dzieci i młodzieży.'], ['Ortodoncja', 'Więcej']],
    ]);
  });

  it('reads a "why us" icon list as features', async () => {
    const point = (title: string, text: string) => `<li><svg width="32" height="32"><circle cx="16" cy="16" r="16"/></svg><h3>${title}</h3><p>${text}</p></li>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Co nas wyróżnia</h2><ul style="display:grid;grid-template-columns:repeat(2,1fr);list-style:none;padding:0">
        ${point('Doświadczenie', 'Ponad 20 lat praktyki.')}${point('Nowoczesny sprzęt', 'Mikroskop i tomograf na miejscu.')}
        ${point('Raty 0%', 'Leczenie na wygodne raty.')}${point('Bez bólu', 'Znieczulenie komputerowe.')}
      </ul></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Co nas wyróżnia')!;
    expect(s.kind).toBe('features');
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(2);
    expect(s.items.map((i) => i.title)).toEqual(['Doświadczenie', 'Nowoczesny sprzęt', 'Raty 0%', 'Bez bólu']);
    expectCovered(result);
  });

  it('keeps a lazy image by its data-src, never the placeholder', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Gabinet</h2><p>Nowe wnętrze od 2023 roku, z osobną salą zabiegową.</p>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://img.test/lazy.jpg" alt="Wnętrze" width="600" height="400"></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Gabinet')!;
    expect(s.images).toEqual([{ src: 'https://img.test/lazy.jpg', alt: 'Wnętrze', width: 600, height: 400 }]);
  });

  it('reads tabs with their panels, hidden ones included', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Cennik</h2><div role="tablist"><button role="tab" aria-controls="t1">Protetyka</button><button role="tab" aria-controls="t2">Chirurgia</button></div>
        <div id="t1" role="tabpanel"><p>Korona porcelanowa od 1200 zł</p></div>
        <div id="t2" role="tabpanel" hidden><p>Ekstrakcja zęba od 250 zł</p></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Cennik')!;
    expect(s.arrangement).toBe('tabs');
    expect(s.items.map((i) => [i.title, i.text])).toEqual([['Protetyka', ['Korona porcelanowa od 1200 zł']], ['Chirurgia', ['Ekstrakcja zęba od 250 zł']]]);
    expectCovered(result);
  });

  it('keeps plain paragraphs in their own divs as text, not a list of items', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>O gabinecie</h2>
        <div><p>Gabinet działa od 1998 roku w centrum Krakowa.</p></div>
        <div><p>Leczymy dzieci i dorosłych, z pełną diagnostyką na miejscu.</p></div>
        <div><p>Współpracujemy z pracownią protetyczną na miejscu.</p></div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'O gabinecie')!;
    expect(s.arrangement).toBe('text');
    expect(s.items).toEqual([]);
    expect(s.intro.text).toHaveLength(3);
  });

  it('reads text beside an image at 60/40, with the side and split', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="display:flex;align-items:center;padding:60px 0">
        <div style="width:60%;padding:0 40px;box-sizing:border-box"><h2>O gabinecie</h2>
          <p>Gabinet działa od 1998 roku w centrum Krakowa, tuż przy Rynku Głównym.</p>
          <p>Leczymy dzieci i dorosłych, z pełną diagnostyką i pracownią protetyczną na miejscu.</p></div>
        <div style="width:40%"><img src="https://img.test/room.jpg" alt="Gabinet" width="576" height="400" style="display:block;width:100%;height:auto"></div>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'O gabinecie')!;
    expect(s.arrangement).toBe('media-beside-text');
    expect(s.mediaSide).toBe('right');
    expect(s.style.split).toBeCloseTo(0.42, 1);
    expect(s.images[0]!.src).toBe('https://img.test/room.jpg');
    expectCovered(result);
  });

  it('reads identical Elementor columns with text and a photo as media beside text, not two cards', async () => {
    const column = (inner: string) => `<div class="elementor-column" style="width:50%"><div class="elementor-widget-wrap"><div class="elementor-widget">${inner}</div></div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section style="display:flex;align-items:center">
        ${column('<h2>Nasza historia</h2><p>Od ponad dwudziestu lat dbamy o uśmiechy mieszkańców Krakowa i okolic.</p>')}
        ${column('<img src="https://img.test/team.jpg" alt="" width="640" height="420" style="display:block;width:100%;height:auto">')}
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasza historia')!;
    expect(s.items).toEqual([]);
    expect(s.arrangement).toBe('media-beside-text');
    expect(s.mediaSide).toBe('right');
  });

  it('reads a map embed and a form', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section id="kontakt" style="display:grid;grid-template-columns:2fr 3fr;min-height:500px;padding:0">
        <div style="padding:40px"><h2>Kontakt</h2><form action="/wyslij"><input name="email" placeholder="E-mail"><textarea name="m"></textarea><button>Wyślij</button></form></div>
        <iframe src="https://www.google.com/maps/embed?pb=xyz" style="border:0;width:100%;height:500px"></iframe>
      </section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Kontakt')!;
    expect(s.kind).toBe('contact');
    expect(s.embeds).toEqual([{ kind: 'form', src: 'https://falco.test/wyslij' }, { kind: 'map', src: 'https://www.google.com/maps/embed?pb=xyz' }]);
    expect(s.arrangement).toBe('embed');
  });

  it('reads a photo banner with its call to action, and the site typography', async () => {
    const result = await sectionsOf(pageOf(`${HEADER}
      <section style="background:url(https://img.test/bg.jpg) center/cover;min-height:600px;color:#fff;text-align:center">
        <h1 style="color:#fff">Piękny uśmiech zaczyna się tutaj</h1><p>Konsultacja online w dwie minuty.</p>
        <a class="btn" href="/rezerwacja" style="display:inline-block;background:#e91e63;padding:12px 24px;color:#fff;border-radius:4px;text-transform:uppercase">Umów wizytę</a>
      </section>
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze, protetyka i implanty, wszystko w jednym miejscu.</p></section>`));
    const hero = result.sections.find((x) => x.role === 'hero')!;
    expect(hero.arrangement).toBe('banner');
    expect(hero.style).toMatchObject({ backgroundImage: 'https://img.test/bg.jpg', textColor: '#ffffff', align: 'center' });
    expect(hero.intro.links).toEqual([{ label: 'Umów wizytę', href: 'https://falco.test/rezerwacja', kind: 'cta' }]);
    expect(result.typography).toEqual({
      heading: { family: 'Georgia', size: 32, weight: 700, uppercase: false, color: '#111111' },
      body: { family: 'Arial', size: 16, weight: 400, lineHeight: 1.5, color: '#333333' },
      button: { radius: 0, filled: true, uppercase: false, background: '#00aa77', color: '#ffffff' },
    });
    expectCovered(result);
  });

  it('does not take a has_eae_slider flag class for a slider (Falco-Dent)', async () => {
    const card = (name: string) => `<div class="elementor-column has_eae_slider" style="flex:1"><div class="elementor-widget-wrap">
      <h3>${name}</h3><p>Pełna diagnostyka i plan leczenia: ${name.toLowerCase()} w naszym gabinecie.</p></div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section class="has_eae_slider elementor-section"><h2>Nasze usługi</h2>
        <div class="elementor-container" style="display:flex;gap:24px">${['Implanty', 'Ortodoncja', 'Wybielanie'].map(card).join('')}</div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasze usługi')!;
    expect(s.arrangement).toBe('card-grid');
    expect(s.items.map((i) => i.title)).toEqual(['Implanty', 'Ortodoncja', 'Wybielanie']);
  });

  it('reads cards laid out in rows as one grid, not as a list of rows (Falco-Dent)', async () => {
    const person = (name: string, i: number) => `<div class="elementor-column" style="flex:1"><div class="elementor-widget-wrap">
      <img src="https://img.test/p${i}.jpg" alt="" width="200" height="200" style="display:block">
      <h2 style="font-size:20px">${name}</h2><div>Stomatologia zachowawcza i endodoncja, protetyka.</div></div></div>`;
    const row = (names: string[], from: number) => `<section class="elementor-inner-section"><div class="elementor-container" style="display:flex;gap:24px">
      ${names.map((n, i) => person(n, from + i)).join('')}</div></section>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasi specjaliści</h2>
        ${row(['Anna Nowak', 'Jan Kowalski', 'Ewa Wiśniewska'], 0)}${row(['Piotr Zieliński', 'Maria Lewandowska', 'Karolina Wójcik'], 3)}</section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasi specjaliści')!;
    expect(s.items.map((i) => i.title)).toEqual(['Anna Nowak', 'Jan Kowalski', 'Ewa Wiśniewska', 'Piotr Zieliński', 'Maria Lewandowska', 'Karolina Wójcik']);
    expect(s.arrangement).toBe('card-grid');
    expect(s.columns).toBe(3);
    expectCovered(result);
  });

  it('reads photos wrapped in links as a gallery (Falco-Dent)', async () => {
    const photo = (i: number) => `<a class="grid-item" href="https://img.test/big${i}.jpg" style="display:block;width:300px"><img src="https://img.test/g${i}.jpg" alt="" width="300" height="300" style="display:block"></a>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasz gabinet</h2><div style="display:flex;flex-wrap:wrap;width:1200px">${[0, 1, 2, 3, 4, 5, 6, 7].map(photo).join('')}</div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasz gabinet')!;
    expect(s.arrangement).toBe('gallery');
    expect(s.items.map((i) => i.image?.src)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => `https://img.test/g${i}.jpg`));
  });

  it('reads only the shown menu of a header, not its closed dropdowns and mobile menu (Falco-Dent)', async () => {
    const sub = Array.from({ length: 50 }, (_, i) => `<li><a href="/oferta/${i}">Usługa numer ${i} w ofercie gabinetu</a></li>`).join('');
    const result = await sectionsOf(pageOf(`<header style="height:90px;display:flex;gap:16px;padding:0 40px">
        <nav><ul style="display:flex;gap:16px;list-style:none"><li><a href="/">Start</a></li>
          <li><a href="/oferta">Oferta</a><ul class="sub-menu" style="display:none">${sub}</ul></li><li><a href="/kontakt">Kontakt</a></li></ul></nav>
        <div class="mobile-menu" style="display:none"><a href="/">Start</a><a href="/oferta">Oferta</a><a href="/kontakt">Kontakt</a></div></header>
      ${HERO}<section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>`));
    const header = result.sections.find((s) => s.role === 'header')!;
    expect(header.intro.links.map((l) => l.label)).toEqual(['Start', 'Oferta', 'Kontakt']);
    expect(header.truncated).toBeUndefined();
    expectCovered(result);
  });

  it('titles an item by its most prominent heading, not a smaller one before it (Elefant)', async () => {
    const person = (name: string, i: number) => `<div style="width:250px"><img src="https://img.test/d${i}.jpg" alt="${name}" width="200" height="200" style="display:block">
      <div><h4>Lek. dent.</h4><a href="/zespol/${i}"><h2 style="font-size:20px">${name}</h2></a><h4>Warszawski Uniwersytet Medyczny</h4></div></div>`;
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasz zespół</h2><div style="display:flex;gap:24px">${['Joanna Gradoń', 'Anna Nowak', 'Ewa Wiśniewska'].map(person).join('')}</div></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasz zespół')!;
    expect(s.items.map((i) => i.title)).toEqual(['Joanna Gradoń', 'Anna Nowak', 'Ewa Wiśniewska']);
    expect(s.items[0]).toMatchObject({ subtitle: 'Warszawski Uniwersytet Medyczny', text: ['Lek. dent.'] });
    expectCovered(result);
  });

  it('reads a footer named only by its class, the way the layout walk leaves it out', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>
      <div class="footer-wrapper" style="padding:40px;background:#222;color:#eee"><p>ul. Długa 5, Kraków</p><p><a href="tel:+48123456789">+48 123 456 789</a></p></div>`));
    const footer = result.sections.find((s) => s.role === 'footer')!;
    expect(footer.kind).toBe('contact');
    expect(footer.intro.links).toEqual([{ label: '+48 123 456 789', href: 'tel:+48123456789', kind: 'phone' }]);
    expect(JSON.stringify(result.sections.find((s) => s.intro.heading === 'Nasze usługi'))).not.toContain('Długa');
    expectCovered(result);
  });

  it('takes the last footer in page order when a named one comes before a footer element', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><h2>Nasze usługi</h2><p>Leczenie zachowawcze i protetyka.</p></section>
      <div class="site-footer" style="padding:40px"><p>Zapisz się do newslettera gabinetu.</p></div>
      <footer style="padding:40px"><p><a href="tel:+48123456789">+48 123 456 789</a></p></footer>`));
    const footer = result.sections.find((s) => s.role === 'footer')!;
    expect(footer.intro.links.map((l) => l.kind)).toEqual(['phone']);
  });

  it('keeps a later line that repeats the eyebrow text', async () => {
    const result = await sectionsOf(pageOf(`${HERO}
      <section><p>Umów wizytę</p><h2>Nasze usługi</h2>
        <div style="display:flex;gap:24px">${['Implanty', 'Ortodoncja', 'Protetyka'].map((t) => `<div style="flex:1"><h3>${t}</h3><p>Pełna diagnostyka i plan leczenia na miejscu.</p></div>`).join('')}</div>
        <p>Umów wizytę</p></section>`));
    const s = result.sections.find((x) => x.intro.heading === 'Nasze usługi')!;
    expect(s.intro.eyebrow).toBe('Umów wizytę');
    expect(s.items).toHaveLength(3);
    expect(s.extra).toEqual([{ type: 'text', text: ['Umów wizytę'] }]);
  });
});
