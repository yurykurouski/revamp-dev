// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BROCHURE_MAX_HEIGHT_PX,
  BROCHURE_MAX_SECTIONS,
  RawComplexitySignals,
  SMALL_SITE_MAX_PAGES,
  classifySiteComplexity,
  collectComplexitySignalsInPage,
  collectInternalPages,
  isOnePageBrochure,
} from '../site-complexity.service.js';

const HOME = 'https://www.dental-studio.pl/';

const signals = (overrides: Partial<RawComplexitySignals> = {}): RawComplexitySignals => ({
  pageUrl: HOME,
  links: [],
  hasEcommerce: false,
  hasBooking: false,
  hasLogin: false,
  hasSearch: false,
  hasAppShell: false,
  sectionCount: 6,
  pageHeight: 4800,
  ...overrides,
});

describe('collectInternalPages (REV-38)', () => {
  it('ignores in-page anchors, tel:, mailto:, javascript: and the page itself', () => {
    expect(
      collectInternalPages(HOME, [
        'https://www.dental-studio.pl/#about',
        'https://www.dental-studio.pl/#contact',
        'https://www.dental-studio.pl/',
        'https://www.dental-studio.pl/index.html',
        'https://www.dental-studio.pl',
        'tel:+48221234567',
        'mailto:info@dental-studio.pl',
        'javascript:void(0)',
      ]),
    ).toEqual([]);
  });

  it('ignores other domains but treats www and the bare host as the same site', () => {
    expect(
      collectInternalPages(HOME, [
        'https://facebook.com/dentalstudio',
        'https://maps.google.com/?q=dental',
        'https://booksy.com/pl-pl/123',
        'https://dental-studio.pl/cennik',
      ]),
    ).toEqual(['/cennik']);
  });

  it('counts one page per path regardless of trailing slashes, index files and hashes', () => {
    expect(
      collectInternalPages(HOME, [
        'https://www.dental-studio.pl/uslugi',
        'https://www.dental-studio.pl/uslugi/',
        'https://www.dental-studio.pl/uslugi/index.php',
        'https://www.dental-studio.pl/uslugi#implanty',
        'https://www.dental-studio.pl/zespol/',
      ]),
    ).toEqual(['/uslugi', '/zespol']);
  });

  it('skips files, legal pages and language switches', () => {
    expect(
      collectInternalPages(HOME, [
        'https://www.dental-studio.pl/cennik.pdf',
        'https://www.dental-studio.pl/wp-content/uploads/photo.JPG',
        'https://www.dental-studio.pl/polityka-prywatnosci',
        'https://www.dental-studio.pl/privacy-policy/',
        'https://www.dental-studio.pl/impressum',
        'https://www.dental-studio.pl/cookies',
        'https://www.dental-studio.pl/en/',
        'https://www.dental-studio.pl/de',
        'https://www.dental-studio.pl/en-us',
      ]),
    ).toEqual([]);
  });

  it('skips phone numbers and emails linked without a tel:/mailto: scheme', () => {
    expect(
      collectInternalPages(HOME, ['601 327 512', '+48 (22) 123-45-67', 'info@dental-studio.pl', '/umow-wizyte']),
    ).toEqual(['/umow-wizyte']);
  });

  it('keeps query strings that address pages but drops tracking parameters', () => {
    expect(
      collectInternalPages(HOME, [
        'https://www.dental-studio.pl/?page_id=12',
        'https://www.dental-studio.pl/?page_id=12&utm_source=fb',
        'https://www.dental-studio.pl/?utm_campaign=spring',
        'https://www.dental-studio.pl/?fbclid=abc',
      ]),
    ).toEqual(['/?page_id=12']);
  });

  it('resolves relative links against the page and survives malformed input', () => {
    expect(collectInternalPages('https://site.lt/apie', ['/kontaktai', 'paslaugos', 'http://[bad'])).toEqual([
      '/kontaktai',
      '/paslaugos',
    ]);
    expect(collectInternalPages('not a url', ['/a'])).toEqual([]);
  });
});

describe('classifySiteComplexity (REV-38)', () => {
  it('returns UNKNOWN when no signals were collected', () => {
    expect(classifySiteComplexity(undefined)).toEqual({ class: 'UNKNOWN', reasons: ['signals_unavailable'] });
    expect(classifySiteComplexity({ pageUrl: HOME } as RawComplexitySignals).class).toBe('UNKNOWN');
  });

  it('classes a single landing page with anchor-only navigation as a one-page brochure', () => {
    const result = classifySiteComplexity(
      signals({
        links: [`${HOME}#services`, `${HOME}#hours`, `${HOME}#contact`, 'tel:+48221234567', 'https://instagram.com/x'],
      }),
    );
    expect(result.class).toBe('ONE_PAGE_BROCHURE');
    expect(result.signals).toMatchObject({ internalPageCount: 0, internalPages: [], sectionCount: 6, pageHeight: 4800 });
    expect(result.reasons).toEqual(['internal_pages:0', 'sections:6']);
    expect(isOnePageBrochure(result.class)).toBe(true);
  });

  it('allows one extra internal page (e.g. a gallery) on a brochure site', () => {
    const result = classifySiteComplexity(signals({ links: [`${HOME}galeria`, `${HOME}polityka-prywatnosci`] }));
    expect(result.class).toBe('ONE_PAGE_BROCHURE');
    expect(result.signals?.internalPageCount).toBe(1);
  });

  it('classes a site with a few internal pages as small multi-page', () => {
    const result = classifySiteComplexity(
      signals({ links: [`${HOME}uslugi`, `${HOME}zespol`, `${HOME}cennik`, `${HOME}kontakt`] }),
    );
    expect(result.class).toBe('SMALL_MULTI_PAGE');
    expect(result.reasons).toEqual(['internal_pages:4']);
    expect(isOnePageBrochure(result.class)).toBe(false);
  });

  it('treats online booking and search as more than a brochure', () => {
    expect(classifySiteComplexity(signals({ hasBooking: true })).reasons).toEqual(['booking']);
    expect(classifySiteComplexity(signals({ hasBooking: true })).class).toBe('SMALL_MULTI_PAGE');
    expect(classifySiteComplexity(signals({ hasSearch: true })).class).toBe('SMALL_MULTI_PAGE');
  });

  it('treats a very long home page as more than a brochure', () => {
    expect(classifySiteComplexity(signals({ sectionCount: BROCHURE_MAX_SECTIONS })).class).toBe('ONE_PAGE_BROCHURE');
    expect(classifySiteComplexity(signals({ sectionCount: BROCHURE_MAX_SECTIONS + 1 })).reasons).toEqual([
      `sections:${BROCHURE_MAX_SECTIONS + 1}`,
    ]);
    expect(classifySiteComplexity(signals({ pageHeight: BROCHURE_MAX_HEIGHT_PX + 1 })).class).toBe('SMALL_MULTI_PAGE');
  });

  it('classes shops, customer accounts and web apps as complex', () => {
    expect(classifySiteComplexity(signals({ hasEcommerce: true }))).toMatchObject({
      class: 'COMPLEX',
      reasons: ['ecommerce'],
    });
    expect(classifySiteComplexity(signals({ hasLogin: true })).reasons).toEqual(['login']);
    expect(classifySiteComplexity(signals({ hasAppShell: true })).reasons).toEqual(['app_shell']);
    // Complex signals win over booking/search
    expect(classifySiteComplexity(signals({ hasEcommerce: true, hasBooking: true })).class).toBe('COMPLEX');
  });

  it('classes a site with more than the small-site page limit as complex', () => {
    const many = Array.from({ length: SMALL_SITE_MAX_PAGES + 1 }, (_, i) => `${HOME}page-${i}`);
    const exact = many.slice(0, SMALL_SITE_MAX_PAGES);
    expect(classifySiteComplexity(signals({ links: exact })).class).toBe('SMALL_MULTI_PAGE');
    const result = classifySiteComplexity(signals({ links: many }));
    expect(result.class).toBe('COMPLEX');
    expect(result.reasons).toEqual([`internal_pages:${SMALL_SITE_MAX_PAGES + 1}`]);
  });

  it('lists at most 20 internal pages but counts them all', () => {
    const links = Array.from({ length: 30 }, (_, i) => `${HOME}p${i}`);
    const result = classifySiteComplexity(signals({ links }));
    expect(result.signals?.internalPageCount).toBe(30);
    expect(result.signals?.internalPages).toHaveLength(20);
  });

  it('sanitizes non-numeric section counts and heights', () => {
    const result = classifySiteComplexity(
      signals({ sectionCount: Number.NaN, pageHeight: -5 } as unknown as Partial<RawComplexitySignals>),
    );
    expect(result.signals).toMatchObject({ sectionCount: 0, pageHeight: 0 });
    expect(result.class).toBe('ONE_PAGE_BROCHURE');
  });
});

describe('collectComplexitySignalsInPage (REV-38)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('reports a plain brochure page without shop, booking, login, search or app signals', () => {
    document.body.innerHTML = `
      <nav><a href="#services">Services</a><a href="#contact">Contact</a><a href="tel:+4812">Call</a></nav>
      <section><h2>Services</h2></section>
      <section><h2>About</h2><section><h3>Nested</h3></section></section>
      <section id="contact"><h2>Contact</h2><form><input name="email" /><textarea></textarea></form></section>
    `;
    const raw = collectComplexitySignalsInPage();
    expect(raw).toMatchObject({
      hasEcommerce: false,
      hasBooking: false,
      hasLogin: false,
      hasSearch: false,
      hasAppShell: false,
      sectionCount: 3,
    });
    expect(raw.links).toHaveLength(3);
    expect(typeof raw.pageUrl).toBe('string');
    expect(typeof raw.pageHeight).toBe('number');
  });

  it('detects a shop from cart links or add-to-cart controls', () => {
    document.body.innerHTML = '<a href="/cart">Cart</a>';
    expect(collectComplexitySignalsInPage().hasEcommerce).toBe(true);

    document.body.innerHTML = '<button class="btn add-to-cart">Buy</button>';
    expect(collectComplexitySignalsInPage().hasEcommerce).toBe(true);

    // "a la carte" menus are not a cart
    document.body.innerHTML = '<a href="/menu-a-la-carte">Menu</a>';
    expect(collectComplexitySignalsInPage().hasEcommerce).toBe(false);
  });

  it('detects online booking widgets and date pickers', () => {
    document.body.innerHTML = '<iframe src="https://booksy.com/widget/123"></iframe>';
    expect(collectComplexitySignalsInPage().hasBooking).toBe(true);

    document.body.innerHTML = '<form><input type="date" name="visit" /></form>';
    expect(collectComplexitySignalsInPage().hasBooking).toBe(true);
  });

  it('detects login and search', () => {
    document.body.innerHTML = '<form><input type="password" /></form>';
    expect(collectComplexitySignalsInPage().hasLogin).toBe(true);

    document.body.innerHTML = '<a href="/my-account/">Account</a>';
    expect(collectComplexitySignalsInPage().hasLogin).toBe(true);

    // A WordPress admin link in the footer is not a customer login
    document.body.innerHTML = '<a href="https://ortodontka.pl/wp-login.php">Log in</a>';
    expect(collectComplexitySignalsInPage().hasLogin).toBe(false);

    document.body.innerHTML = '<form role="search"><input name="s" /></form>';
    expect(collectComplexitySignalsInPage().hasSearch).toBe(true);
  });

  it('detects hash-routed web apps', () => {
    document.body.innerHTML = '<a href="#/home">Home</a><a href="#/orders">Orders</a><a href="#!/settings">Settings</a>';
    expect(collectComplexitySignalsInPage().hasAppShell).toBe(true);
  });

  it('falls back to h2 headings when the page has no section elements', () => {
    document.body.innerHTML = '<div><h2>A</h2></div><div><h2>B</h2></div><div><h2>C</h2></div><div><h2>D</h2></div>';
    expect(collectComplexitySignalsInPage().sectionCount).toBe(4);
  });
});
