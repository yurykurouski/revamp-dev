/**
 * Deterministic site complexity estimate (REV-38).
 *
 * `collectComplexitySignalsInPage` runs inside the crawled page via page.evaluate(), so it must stay
 * fully self-contained: no imports, no references to module-level values. It only reports raw DOM
 * facts; `classifySiteComplexity` turns them into a class in Node, where it is unit-testable.
 * No LLM is involved at any step.
 */
import type { ISiteComplexity, ISiteComplexitySignals, SiteComplexityClass } from '@revamp/shared-types';

export interface RawComplexitySignals {
  /** URL of the audited page after redirects */
  pageUrl: string;
  /** Absolute hrefs of every link on the page */
  links: string[];
  hasEcommerce: boolean;
  hasBooking: boolean;
  hasLogin: boolean;
  hasSearch: boolean;
  hasAppShell: boolean;
  sectionCount: number;
  pageHeight: number;
}

export function collectComplexitySignalsInPage(): RawComplexitySignals {
  const MAX_LINKS = 500;

  const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const links = anchors.slice(0, MAX_LINKS).map((a) => a.href);
  const rawHrefs = anchors.map((a) => (a.getAttribute('href') || '').trim().toLowerCase());
  const has = (selector: string): boolean => {
    try {
      return document.querySelector(selector) !== null;
    } catch {
      return false;
    }
  };
  const hrefMatches = (pattern: RegExp): boolean => rawHrefs.some((href) => pattern.test(href));
  const embeds = Array.from(document.querySelectorAll('iframe[src], script[src]')).map((el) =>
    (el.getAttribute('src') || '').toLowerCase(),
  );

  // Shops: cart/checkout links, add-to-cart controls, shop platform markers, or product listings
  const productItems = document.querySelectorAll(
    '[itemtype*="schema.org/Product" i], [data-product-id], li.product, .product-item, .product-card',
  ).length;
  const hasEcommerce =
    hrefMatches(/(^|[/?=_-])(cart|checkout|basket|koszyk|korzina|korzin|warenkorb)([/?#._-]|$)/) ||
    has(
      '.add_to_cart_button, [class*="add-to-cart" i], [name="add-to-cart"], form[action*="/cart" i], .woocommerce, [data-shopify], .shopify-section',
    ) ||
    productItems >= 3;

  // Online booking widgets or date pickers inside forms
  const BOOKING_PROVIDERS =
    /booksy|calendly|reservio|znanylekarz|doctolib|opentable|simplybook|setmore|fresha|treatwell|acuityscheduling|bookero|versum|yclients/;
  const hasBooking =
    embeds.some((src) => BOOKING_PROVIDERS.test(src)) ||
    rawHrefs.some((href) => BOOKING_PROVIDERS.test(href)) ||
    has('form input[type="date"], form input[type="datetime-local"], form input[type="time"]');

  // Customer accounts; WordPress admin links (wp-login.php, often left in the footer) do not count
  const hasLogin =
    has('input[type="password"]') ||
    rawHrefs.some(
      (href) =>
        !/wp-(login|admin)/.test(href) &&
        /(^|[/?=_-])(login|log-in|signin|sign-in|my-account|account|logowanie)([/?#._-]|$)/.test(href),
    );

  const hasSearch = has(
    'input[type="search"], form[role="search"], [role="search"] input, form input[name="s"], form input[name="q"], form input[name="search"]',
  );

  // Client-side routed web apps: hash routes, or an Angular app root
  const hashRoutes = rawHrefs.filter((href) => /^#!?\//.test(href)).length;
  const hasAppShell = hashRoutes >= 3 || has('[ng-version]');

  // Page sections: top-level <section> elements, or h2 headings on pages without them
  const sections = Array.from(document.querySelectorAll('section')).filter(
    (el) => !el.parentElement?.closest('section'),
  ).length;
  const h2Count = document.querySelectorAll('h2').length;

  return {
    pageUrl: window.location.href,
    links,
    hasEcommerce,
    hasBooking,
    hasLogin,
    hasSearch,
    hasAppShell,
    sectionCount: Math.max(sections, h2Count),
    pageHeight: Math.round(
      Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0),
    ),
  };
}

/** More internal pages than this and the site is no longer "small" */
export const SMALL_SITE_MAX_PAGES = 10;
/** A home page longer than this is not a simple brochure, even without subpages */
export const BROCHURE_MAX_SECTIONS = 20;
export const BROCHURE_MAX_HEIGHT_PX = 20000;
const MAX_LISTED_PAGES = 20;

/** Links to these are not content pages the MVP has to replace */
const ASSET_EXTENSION =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|7z|docx?|xlsx?|pptx?|odt|txt|csv|mp3|mp4|mov|avi|webm|xml|json|rss)$/i;
/** Legal and policy pages every site carries, one-pagers included */
const LEGAL_PAGE =
  /(privacy|polityka|prywatnosci|datenschutz|impressum|imprint|cookie|gdpr|rodo|regulamin|terms|legal-notice|mentions-legales|disclaimer|konfidencialnost|politika)/i;
/** Language switches (/en, /pl/, /en-us) point to the same page in another language */
const LANGUAGE_PATH = /^\/[a-z]{2}(-[a-z]{2})?\/?$/i;
/** Phone numbers and emails linked without a `tel:`/`mailto:` scheme resolve as relative paths */
const MISSING_SCHEME_CONTACT = /^\/[\d\s+().-]{6,}$|@/;
/** Tracking parameters never make a different page */
const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_[a-z]+|ref|lang)$/i;

const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** Normalizes a path so `/about`, `/about/` and `/about/index.html` count as one page */
const normalizePath = (pathname: string): string => {
  let path = pathname.replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/').replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
};

/**
 * Distinct same-origin pages linked from the audited page, excluding the page itself, in-page
 * anchors, `tel:`/`mailto:` and other non-HTTP links, other domains, files, legal pages and
 * language switches.
 */
export function collectInternalPages(pageUrl: string, links: string[]): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const host = bareHost(base.hostname);
  const self = normalizePath(base.pathname);
  const pages = new Set<string>();

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (bareHost(url.hostname) !== host) continue;

    const path = normalizePath(url.pathname);
    if (ASSET_EXTENSION.test(path) || LANGUAGE_PATH.test(path)) continue;

    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // Keep the raw path when it is not valid percent-encoding
    }
    if (LEGAL_PAGE.test(decoded) || MISSING_SCHEME_CONTACT.test(decoded)) continue;

    // Query strings can address real pages (e.g. WordPress `?page_id=12`); tracking ones cannot
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';

    const key = `${path}${query}`;
    if (key === self) continue;
    pages.add(key);
  }

  return [...pages];
}

/**
 * Classifies a site from the raw DOM signals of its home page:
 * - COMPLEX: a shop, customer accounts, a client-side web app, or more than 10 internal pages
 * - ONE_PAGE_BROCHURE: at most one internal page, no booking or search, and a home page of
 *   reasonable length; the Revamp MVP can replace these outright
 * - SMALL_MULTI_PAGE: everything in between
 * - UNKNOWN: the signals could not be collected
 */
export function classifySiteComplexity(raw: RawComplexitySignals | undefined): ISiteComplexity {
  if (!raw || !Array.isArray(raw.links)) {
    return { class: 'UNKNOWN', reasons: ['signals_unavailable'] };
  }

  const internalPages = collectInternalPages(raw.pageUrl, raw.links);
  const signals: ISiteComplexitySignals = {
    internalPageCount: internalPages.length,
    internalPages: internalPages.slice(0, MAX_LISTED_PAGES),
    hasEcommerce: Boolean(raw.hasEcommerce),
    hasBooking: Boolean(raw.hasBooking),
    hasLogin: Boolean(raw.hasLogin),
    hasSearch: Boolean(raw.hasSearch),
    hasAppShell: Boolean(raw.hasAppShell),
    sectionCount: Math.max(0, Math.round(Number(raw.sectionCount) || 0)),
    pageHeight: Math.max(0, Math.round(Number(raw.pageHeight) || 0)),
  };

  const complex: string[] = [];
  if (signals.hasEcommerce) complex.push('ecommerce');
  if (signals.hasLogin) complex.push('login');
  if (signals.hasAppShell) complex.push('app_shell');
  if (signals.internalPageCount > SMALL_SITE_MAX_PAGES) complex.push(`internal_pages:${signals.internalPageCount}`);
  if (complex.length > 0) {
    return { class: 'COMPLEX', signals, reasons: complex };
  }

  const multi: string[] = [];
  if (signals.internalPageCount > 1) multi.push(`internal_pages:${signals.internalPageCount}`);
  if (signals.hasBooking) multi.push('booking');
  if (signals.hasSearch) multi.push('search');
  if (signals.sectionCount > BROCHURE_MAX_SECTIONS) multi.push(`sections:${signals.sectionCount}`);
  if (signals.pageHeight > BROCHURE_MAX_HEIGHT_PX) multi.push(`page_height:${signals.pageHeight}`);
  if (multi.length > 0) {
    return { class: 'SMALL_MULTI_PAGE', signals, reasons: multi };
  }

  return {
    class: 'ONE_PAGE_BROCHURE',
    signals,
    reasons: [`internal_pages:${signals.internalPageCount}`, `sections:${signals.sectionCount}`],
  };
}

/** Whether a class earns the one-page brochure priority boost */
export const isOnePageBrochure = (cls: SiteComplexityClass | undefined): boolean => cls === 'ONE_PAGE_BROCHURE';
