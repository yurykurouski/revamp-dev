/**
 * Deterministic extraction of the original website's own content (REV-23).
 *
 * `extractSiteContentInPage` is serialized and executed inside the crawled page via
 * page.evaluate(), so it must stay fully self-contained: no imports, no references to
 * module-level values. Everything it returns is copied verbatim from the DOM, never generated.
 */

export interface RawServiceItem {
  title: string;
  description?: string;
}

export interface RawTestimonial {
  text: string;
  author?: string;
}

export interface RawStructuredBusinessData {
  name?: string;
  telephone?: string;
  email?: string;
  address?: string;
  openingHours?: string;
  ratingValue?: number;
  reviewCount?: number;
  foundingYear?: number;
}

export interface RawSiteContent {
  language?: string;
  title?: string;
  metaDescription?: string;
  ogImage?: string;
  h1?: string;
  headings: string[];
  paragraphs: string[];
  serviceItems: RawServiceItem[];
  navItems: string[];
  testimonials: RawTestimonial[];
  images: string[];
  addressText?: string;
  workingHoursText?: string;
  structured?: RawStructuredBusinessData;
}

export function extractSiteContentInPage(): RawSiteContent {
  // Limits are declared inside the function: it runs in the page, where module scope does not exist
  const MAX_PARAGRAPHS = 12;
  const MAX_HEADINGS = 16;
  const MAX_SERVICE_ITEMS = 10;
  const MAX_TESTIMONIALS = 6;
  const MAX_IMAGES = 8;

  const clean = (value: string | null | undefined): string =>
    (value || '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();

  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };

  const uniquePush = (list: string[], value: string, max: number): void => {
    if (!value || list.length >= max) return;
    const lower = value.toLowerCase();
    if (!list.some((v) => v.toLowerCase() === lower)) list.push(value);
  };

  // Chrome such as cookie banners and navigation is never business content
  // Consent plugins also tag <body> or page wrappers (e.g. "cmplz-consent"), so a match only
  // counts when it is a real widget, not an ancestor of the page's main content.
  const inBoilerplate = (el: Element): boolean => {
    const match = el.closest(
      '[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], script, style, noscript',
    );
    if (!match || match === document.body || match === document.documentElement) return false;
    return !match.querySelector('h1, main, article');
  };

  // 1. Document meta
  const language = clean(document.documentElement.getAttribute('lang')) || undefined;
  const title = clean(document.title) || undefined;
  const metaDescription =
    clean(document.querySelector('meta[name="description"]')?.getAttribute('content')) || undefined;
  const ogImageRaw = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  let ogImage: string | undefined;
  if (ogImageRaw) {
    try {
      ogImage = new URL(ogImageRaw, document.baseURI).href;
    } catch {
      ogImage = undefined;
    }
  }

  // 2. Headings
  const h1El = Array.from(document.querySelectorAll('h1')).find((el) => clean(el.textContent) && !inBoilerplate(el));
  const h1 = h1El ? clean(h1El.textContent).slice(0, 200) : undefined;

  const headings: string[] = [];
  document.querySelectorAll('h2, h3').forEach((el) => {
    const text = clean(el.textContent);
    if (text.length >= 3 && text.length <= 120 && !inBoilerplate(el) && isVisible(el)) {
      uniquePush(headings, text, MAX_HEADINGS);
    }
  });

  // 3. Body paragraphs (about / descriptive copy). Schedules, price lists and contact blocks
  //    are data, not prose, so text dominated by digits or times is skipped.
  const looksLikeProse = (text: string): boolean => {
    const digits = (text.match(/\d/g) || []).length;
    const times = (text.match(/\d{1,2}[:.]\d{2}/g) || []).length;
    const words = text.split(' ').length;
    const isContactBlock = /(tel\.?|phone|e-?mail)\s*:|@[\w-]+\./i.test(text);
    return digits / text.length < 0.12 && times < 2 && words >= 8 && !isContactBlock;
  };
  const paragraphs: string[] = [];
  const collectParagraph = (el: Element): void => {
    const text = clean(el.textContent);
    if (
      text.length >= 60 &&
      text.length <= 600 &&
      looksLikeProse(text) &&
      !inBoilerplate(el) &&
      !el.closest('nav, footer')
    ) {
      uniquePush(paragraphs, text, MAX_PARAGRAPHS);
    }
  };
  document.querySelectorAll('p').forEach(collectParagraph);
  if (paragraphs.length < 2) {
    // Page builders often put copy in <div>/<span> leaves instead of <p>
    const leaves = Array.from(document.querySelectorAll('div, span, li, td')).filter(
      (el) => !el.querySelector('div, p, section, article, ul, ol, h1, h2, h3, h4, table, form'),
    );
    leaves.slice(0, 3000).forEach(collectParagraph);
  }

  // 4. Service items: headings / list items inside service-like containers, with their description
  const serviceItems: RawServiceItem[] = [];
  const serviceContainers = document.querySelectorAll(
    '[class*="service" i], [id*="service" i], [class*="uslug" i], [class*="usług" i], [class*="offer" i], [id*="offer" i], [class*="oferta" i], [class*="price" i], [class*="menu-item" i]:not(nav *)',
  );
  serviceContainers.forEach((container) => {
    if (inBoilerplate(container) || container.closest('nav, header, footer')) return;
    container.querySelectorAll('h2, h3, h4, h5, li, dt').forEach((el) => {
      if (serviceItems.length >= MAX_SERVICE_ITEMS) return;
      const titleText = clean(el.tagName === 'LI' ? el.firstChild?.textContent || el.textContent : el.textContent);
      if (titleText.length < 3 || titleText.length > 80) return;
      if (serviceItems.some((s) => s.title.toLowerCase() === titleText.toLowerCase())) return;

      let description: string | undefined;
      const sibling = el.nextElementSibling;
      if (sibling && /^(P|DD|DIV|SPAN)$/.test(sibling.tagName)) {
        const siblingText = clean(sibling.textContent);
        if (siblingText.length >= 15 && siblingText.length <= 300) description = siblingText;
      }
      serviceItems.push({ title: titleText, description });
    });
  });

  // 5. Primary navigation labels (site sections / offering categories)
  const navItems: string[] = [];
  document.querySelectorAll('nav a, header a, [role="navigation"] a').forEach((el) => {
    const text = clean(el.textContent);
    if (text.length >= 3 && text.length <= 40 && !/^(https?:|www\.|\+?\d[\d\s()-]{6,})/i.test(text)) {
      uniquePush(navItems, text, 16);
    }
  });

  // 6. Testimonials: the innermost review elements (review widgets nest item > content > text),
  //    skipping widget chrome such as "Verified by ..." or section titles.
  const testimonials: RawTestimonial[] = [];
  const reviewSelector =
    '[class*="testimonial" i], [class*="review" i], [class*="opini" i], [class*="otzyv" i], blockquote, [itemtype*="Review"], [itemprop="reviewBody"]';
  const widgetChrome = /trustindex|powered by|verified by|sprawdza|google reviews|recenzj[ai] google|write a review|napisz opini|see all|zobacz wszystk/i;
  document.querySelectorAll(reviewSelector).forEach((el) => {
    if (testimonials.length >= MAX_TESTIMONIALS || inBoilerplate(el)) return;
    if (el.querySelector(reviewSelector)) return; // not the innermost review element
    const fullText = clean(el.textContent);
    if (fullText.length < 40 || fullText.length > 2000 || fullText.split(' ').length < 8 || widgetChrome.test(fullText)) return;
    // Long reviews are clipped at a word boundary rather than dropped
    const text = fullText.length > 400 ? `${fullText.slice(0, 400).replace(/\s+\S*$/, '')}…` : fullText;
    if (testimonials.some((t) => t.text === text || t.text.includes(text) || text.includes(t.text))) return;

    const item = el.parentElement?.closest(reviewSelector) || el.parentElement || el;
    const authorEl = Array.from(
      item.querySelectorAll('[class*="author" i], [class*="name" i], cite, [itemprop="author"], strong'),
    ).find((candidate) => candidate !== el && !candidate.contains(el));
    const author = authorEl ? clean(authorEl.textContent).slice(0, 60) : undefined;
    testimonials.push({
      text,
      author: author && author.length >= 2 && !text.includes(author) ? author : undefined,
    });
  });

  // 7. Content images (large enough to be photos, not icons), incl. lazy and CSS backgrounds
  const images: string[] = [];
  const toAbsolute = (src: string | null | undefined): string | undefined => {
    if (!src || src.startsWith('data:') || /\.svg(\?|$)/i.test(src)) return undefined;
    try {
      return new URL(src, document.baseURI).href;
    } catch {
      return undefined;
    }
  };
  document.querySelectorAll('img').forEach((img) => {
    const el = img as HTMLImageElement;
    if (inBoilerplate(el) || el.closest('header, nav')) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(el.naturalWidth || 0, rect.width, el.width || 0);
    const height = Math.max(el.naturalHeight || 0, rect.height, el.height || 0);
    if (width < 300 || height < 180) return;
    const src = toAbsolute(
      el.currentSrc || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.src,
    );
    if (src) uniquePush(images, src, MAX_IMAGES);
  });
  if (images.length < MAX_IMAGES) {
    document
      .querySelectorAll('section, [class*="hero" i], [class*="banner" i], [class*="slide" i], [class*="bg" i], [style*="background"]')
      .forEach((el) => {
        if (images.length >= MAX_IMAGES || inBoilerplate(el)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 180) return;
        const match = window.getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
        const src = toAbsolute(match?.[1]);
        if (src) uniquePush(images, src, MAX_IMAGES);
      });
  }

  // 8. Address and opening hours from visible text
  const toLines = (text: string): string[] =>
    text
      .split(/\n+/)
      .map((l) => clean(l))
      .filter(Boolean);
  const contactLines = toLines(
    Array.from(
      document.querySelectorAll('footer, address, [class*="contact" i], [id*="contact" i], [class*="kontakt" i], [class*="footer" i]'),
    )
      .map((el) => (el as HTMLElement).innerText || el.textContent || '')
      .join('\n'),
  );
  // Contact blocks first, then the whole page as a fallback
  const lines = [...contactLines, ...toLines(document.body?.innerText || '')];

  const streetPattern =
    /\b(ul\.|al\.|pl\.|os\.|ulica|street|st\.|avenue|ave\.?|road|rd\.|blvd|boulevard|lane|str\.|straße|strasse|rue|via|calle|ул\.|пр\.|пр-т|просп\.|улица)\s*\S+/i;
  const postalPattern = /\b(\d{2}-\d{3}|\d{5}(-\d{4})?|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/;
  let addressText: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    if (line.length > 120) continue;
    if (streetPattern.test(line)) {
      const next = lines[i + 1] || '';
      addressText = postalPattern.test(line) || !postalPattern.test(next) || next.length > 60 ? line : `${line}, ${next}`;
      break;
    }
  }

  const hoursPattern =
    /(\b[\p{L}]{2,}\.?\s*[-–—]\s*[\p{L}]{2,}\.?|\b[\p{L}]{2,}\.?)\s*:?\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}/u;
  const hoursLines = lines
    .filter((l) => l.length <= 80 && hoursPattern.test(l))
    .filter((l, idx, all) => all.indexOf(l) === idx)
    .slice(0, 3);
  const workingHoursText = hoursLines.length > 0 ? hoursLines.join('; ') : undefined;

  // 9. Schema.org JSON-LD (LocalBusiness / Organization)
  let structured: RawStructuredBusinessData | undefined;
  const businessTypes = /business|organization|store|restaurant|clinic|dentist|shop|center|centre|service|salon|office|practice/i;
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    if (structured) return;
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || '');
    } catch {
      return;
    }
    const nodes: Array<Record<string, unknown>> = [];
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(collect);
      else if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        nodes.push(obj);
        if (obj['@graph']) collect(obj['@graph']);
      }
    };
    collect(data);

    const business = nodes.find((n) => {
      const type = ([] as unknown[]).concat(n['@type'] ?? []).join(' ');
      return businessTypes.test(type) && !/website|webpage|breadcrumb/i.test(type);
    });
    if (!business) return;

    const str = (v: unknown): string | undefined => (typeof v === 'string' && clean(v) ? clean(v) : undefined);
    const addressRaw = business['address'];
    let address: string | undefined;
    if (typeof addressRaw === 'string') address = clean(addressRaw);
    else if (addressRaw && typeof addressRaw === 'object') {
      const a = addressRaw as Record<string, unknown>;
      address = [a['streetAddress'], a['postalCode'], a['addressLocality']]
        .map((p) => (typeof p === 'string' ? clean(p) : ''))
        .filter(Boolean)
        .join(', ') || undefined;
    }

    const hoursRaw = business['openingHours'];
    const openingHours = Array.isArray(hoursRaw)
      ? hoursRaw.filter((h) => typeof h === 'string').join('; ')
      : str(hoursRaw);

    const rating = business['aggregateRating'] as Record<string, unknown> | undefined;
    const ratingValue = rating ? Number(rating['ratingValue']) : NaN;
    const reviewCount = rating ? Number(rating['reviewCount'] ?? rating['ratingCount']) : NaN;
    const founding = str(business['foundingDate']);
    const foundingYear = founding ? Number(founding.slice(0, 4)) : NaN;

    structured = {
      name: str(business['name']),
      telephone: str(business['telephone']),
      email: str(business['email']),
      address,
      openingHours: openingHours || undefined,
      ratingValue: Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : undefined,
      reviewCount: Number.isFinite(reviewCount) && reviewCount > 0 ? reviewCount : undefined,
      foundingYear: Number.isFinite(foundingYear) && foundingYear > 1800 ? foundingYear : undefined,
    };
  });

  return {
    language,
    title,
    metaDescription,
    ogImage,
    h1,
    headings,
    paragraphs,
    serviceItems,
    navItems,
    testimonials,
    images,
    addressText,
    workingHoursText,
    structured,
  };
}
