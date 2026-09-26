// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractSiteContentInPage } from '../site-content.extractor.js';

const DENTAL_PAGE = `
  <html lang="pl">
    <head>
      <title>Warsaw Dental Center: Najlepsza klinika w Warszawie</title>
      <meta name="description" content="Nowoczesne centrum stomatologiczne. Pełen zakres usług." />
      <meta property="og:image" content="/uploads/clinic.jpg" />
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"WebSite","name":"WDC site"},
          {"@type":"Dentist","name":"Warsaw Dental Center","telephone":"+48 22 542 18 04",
           "address":{"streetAddress":"ulica Topiel 11","postalCode":"00-342","addressLocality":"Warszawa"},
           "openingHours":["Mo-Fr 09:00-21:00"],
           "aggregateRating":{"ratingValue":"4.9","reviewCount":"312"},
           "foundingDate":"2009-03-01"}
        ]}
      </script>
    </head>
    <body class="home cmplz-consent-banner-hidden">
      <header><nav><a href="/">Kontakt</a><a href="/uslugi">Usługi</a><a href="/zespol">Zespół</a></nav></header>
      <div class="cmplz-cookiebanner"><p>Ta strona używa plików cookie, aby zapewnić najlepszą jakość korzystania z serwisu.</p></div>
      <main>
        <h1>Najlepsza klinika stomatologiczna w Warszawie</h1>
        <h2>Twoje zdrowie zaczyna się od uśmiechu</h2>
        <p>W Warsaw Dental Center zapewniamy szeroki zakres profesjonalnych zabiegów, aby zadbać o Twoje zdrowie jamy ustnej.</p>
        <p>Pon-Pt: 09:00 – 21:00 Sobota: 09:00 – 15:00 Niedziela: nieczynne, zapraszamy w tygodniu</p>
        <section class="services-list">
          <h3>Implanty zębowe</h3>
          <p>Trwałe, nowoczesne rozwiązanie dla brakujących zębów.</p>
          <h3>Licówki</h3>
          <p>Cienkie, estetyczne nakładki ceramiczne lub kompozytowe.</p>
        </section>
        <div class="ti-widget ti-review-widget">
          <div class="ti-review-item">
            <div class="ti-review-header"><span class="ti-name">Abhijit Chatterjee</span></div>
            <span class="ti-verified-review">Trustindex sprawdza, czy pierwotnym źródłem recenzji jest Google.</span>
            <div class="ti-review-content">I have been a patient of Warsaw Dental Center for the past two years and every visit was great.</div>
          </div>
        </div>
        <img src="/uploads/team.jpg" width="800" height="600" alt="team" />
        <img src="/icons/tooth.png" width="32" height="32" alt="icon" />
      </main>
      <footer>
        <p>Warsaw Dental Center</p>
      </footer>
    </body>
  </html>`;

const MALL_PAGE = `
  <html lang="pl">
    <head><title>Strona główna - Bemowo</title></head>
    <body>
      <nav><a href="/sklepy">Sklepy</a><a href="/restauracje">RESTAURACJE</a><a href="tel:+48225697290">+48 22 569 72 90</a></nav>
      <h2>Wyjątkowe miejsce na zakupy!</h2>
      <p>W Galerii Bemowo znajdziesz wszystko, czego potrzebujesz: sklepy, restauracje i usługi w jednym miejscu.</p>
      <footer>
        <div>Galeria Handlowa Bemowo</div>
        <div>ul. Powstańców Śląskich 126</div>
        <div>01-466 Warszawa</div>
        <div>Poniedziałek: 10:00 – 21:00</div>
        <div>Poniedziałek: 10:00 – 21:00</div>
        <div>Kon­takt dla me­diów: tel: 505 995 592 e-mail: media@example.com, zapraszamy do kontaktu</div>
      </footer>
    </body>
  </html>`;

function loadPage(html: string, url = 'https://clinic.example/'): void {
  window.happyDOM.setURL(url);
  document.write(html);
}

describe('extractSiteContentInPage (REV-23)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '';
  });

  describe('dental clinic page', () => {
    beforeEach(() => loadPage(DENTAL_PAGE));

    it('extracts document meta, headings and the language', () => {
      const content = extractSiteContentInPage();

      expect(content.language).toBe('pl');
      expect(content.title).toBe('Warsaw Dental Center: Najlepsza klinika w Warszawie');
      expect(content.metaDescription).toBe('Nowoczesne centrum stomatologiczne. Pełen zakres usług.');
      expect(content.ogImage).toBe('https://clinic.example/uploads/clinic.jpg');
      expect(content.h1).toBe('Najlepsza klinika stomatologiczna w Warszawie');
      expect(content.headings).toContain('Twoje zdrowie zaczyna się od uśmiechu');
    });

    it('keeps real prose but skips schedules and cookie banners', () => {
      const content = extractSiteContentInPage();

      expect(content.paragraphs).toContain(
        'W Warsaw Dental Center zapewniamy szeroki zakres profesjonalnych zabiegów, aby zadbać o Twoje zdrowie jamy ustnej.',
      );
      expect(content.paragraphs.some((p) => p.includes('09:00'))).toBe(false);
      expect(content.paragraphs.some((p) => p.includes('cookie'))).toBe(false);
    });

    it('does not treat a consent class on <body> as boilerplate for the whole page', () => {
      const content = extractSiteContentInPage();

      expect(content.h1).toBeDefined();
      expect(content.serviceItems.length).toBeGreaterThan(0);
    });

    it('pairs service titles with their own descriptions', () => {
      const content = extractSiteContentInPage();

      expect(content.serviceItems).toEqual([
        { title: 'Implanty zębowe', description: 'Trwałe, nowoczesne rozwiązanie dla brakujących zębów.' },
        { title: 'Licówki', description: 'Cienkie, estetyczne nakładki ceramiczne lub kompozytowe.' },
      ]);
    });

    it('extracts real testimonials with their author and skips widget chrome', () => {
      const content = extractSiteContentInPage();

      expect(content.testimonials).toEqual([
        {
          text: 'I have been a patient of Warsaw Dental Center for the past two years and every visit was great.',
          author: 'Abhijit Chatterjee',
        },
      ]);
    });

    it('reads schema.org LocalBusiness data from JSON-LD @graph', () => {
      const content = extractSiteContentInPage();

      expect(content.structured).toEqual({
        name: 'Warsaw Dental Center',
        telephone: '+48 22 542 18 04',
        email: undefined,
        address: 'ulica Topiel 11, 00-342, Warszawa',
        openingHours: 'Mo-Fr 09:00-21:00',
        ratingValue: 4.9,
        reviewCount: 312,
        foundingYear: 2009,
      });
    });

    it('keeps large content images and drops icons', () => {
      const content = extractSiteContentInPage();

      expect(content.images).toContain('https://clinic.example/uploads/team.jpg');
      expect(content.images.some((src) => src.includes('tooth.png'))).toBe(false);
    });

    it('collects navigation labels', () => {
      expect(extractSiteContentInPage().navItems).toEqual(['Kontakt', 'Usługi', 'Zespół']);
    });
  });

  describe('shopping mall page', () => {
    beforeEach(() => loadPage(MALL_PAGE, 'https://mall.example/'));

    it('finds a street address across lines and joins the postal code', () => {
      expect(extractSiteContentInPage().addressText).toBe('ul. Powstańców Śląskich 126, 01-466 Warszawa');
    });

    it('extracts de-duplicated opening hours', () => {
      expect(extractSiteContentInPage().workingHoursText).toBe('Poniedziałek: 10:00 – 21:00');
    });

    it('skips phone numbers in navigation and contact blocks in prose', () => {
      const content = extractSiteContentInPage();

      expect(content.navItems).toEqual(['Sklepy', 'RESTAURACJE']);
      expect(content.paragraphs.some((p) => p.includes('media@example.com'))).toBe(false);
    });

    it('returns no structured data when the page has no JSON-LD', () => {
      expect(extractSiteContentInPage().structured).toBeUndefined();
    });
  });
});
