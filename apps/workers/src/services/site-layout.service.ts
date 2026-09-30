/**
 * Reads the original home page's layout deterministically (REV-104): its sections in page order, the
 * first screen's arrangement, the header and the white space. The MVP layout is derived from it.
 *
 * `collectSiteLayoutInPage` runs inside the crawled page via page.evaluate(), so it must stay fully
 * self-contained: no imports, no references to module-level values. It only reports raw DOM facts
 * (boxes, headings, counts, computed colors); `readSiteLayout` turns them into an `ISiteLayout` in
 * Node, where it is unit-testable. No LLM is involved at any step.
 */
import type { ISiteLayout, ISiteLayoutSection, SiteHeroTone, SiteSectionKind } from '@revamp/shared-types';
import { SITE_LAYOUT_MAX_SECTIONS, SiteLayoutSchema } from '@revamp/validation';

/** One top-level block of the page, as the DOM shows it */
export interface RawLayoutBlock {
  /** Offset from the top of the page, px */
  top: number;
  height: number;
  /** Lowercased ids, classes and aria-label of the block and its first descendants with an id */
  hint: string;
  /** The block's first heading */
  heading: string;
  imageCount: number;
  formCount: number;
  mapEmbed: boolean;
  /** Quotes and review markup (blockquote, q, schema.org Review) */
  quoteCount: number;
  /** Prices written with a currency */
  priceCount: number;
  textLength: number;
  /** White space above the first and below the last visible content, px */
  paddingY: number;
}

export interface RawSiteHero {
  /** Computed text-align of the main heading */
  headingAlign: string;
  /** Horizontal center and width of the heading's text (not its box) */
  headingCenterX: number;
  headingWidth: number;
  headingColor: string;
  /** First opaque background color behind the heading */
  background: string;
  slider: boolean;
  /** A photo or video fills the first screen behind the copy */
  backgroundMedia: boolean;
  /** Horizontal center of the largest photo beside the copy */
  sideMediaCenterX?: number;
}

export interface RawSiteHeader {
  navLinkCount: number;
  logoCenterX?: number;
  sticky: boolean;
  hasCta: boolean;
}

export interface RawSiteLayout {
  viewportWidth: number;
  viewportHeight: number;
  pageHeight: number;
  blocks: RawLayoutBlock[];
  hero?: RawSiteHero;
  header?: RawSiteHeader;
}

export function collectSiteLayoutInPage(): RawSiteLayout {
  const MAX_BLOCKS = 40;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const CHROME = 'header, footer, nav, aside, [role="banner"], [role="contentinfo"], [role="navigation"], script, style, noscript, template, dialog, svg';
  const SLIDER =
    '.swiper, .swiper-container, .slick-slider, .owl-carousel, .carousel, .splide, .flickity-enabled, .glide, rs-module, .rev_slider, [class*="slider" i], [class*="slideshow" i]';
  const CONTENT = 'h1, h2, h3, h4, h5, h6, p, img, video, li, a, button, blockquote, iframe, figure, input, textarea';

  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left, width: r.width, height: r.height };
  };
  const shown = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Old and page-builder sites build their header and footer from plain divs named after them
  const CHROME_CLASSES = /^(header|site-header|header[-_]wrapper|header[-_]container|footer|site-footer|footer[-_]wrapper|navbar|topbar|top[-_]bar)$/i;
  const isChrome = (el: Element): boolean =>
    el.matches(CHROME) || [el.id, ...Array.from(el.classList)].some((token) => CHROME_CLASSES.test(token));
  // A cookie banner or chat widget floats over the page and is not part of it
  const floats = (el: Element): boolean => window.getComputedStyle(el).position === 'fixed';
  const bigChildren = (el: Element): Element[] =>
    Array.from(el.children).filter((child) => {
      if (isChrome(child) || floats(child) || !shown(child)) return false;
      const r = child.getBoundingClientRect();
      return r.height >= 80 && r.width >= vw * 0.5;
    });
  const hasSectionHeading = (el: Element): boolean => el.querySelector('h1, h2') !== null;

  // Wrappers with one big child are opened until the page splits into several blocks
  let container: Element = document.querySelector('main') || document.body;
  let blocks: Element[] = [];
  for (let depth = 0; depth < 15; depth++) {
    const children = bigChildren(container);
    const [only] = children;
    if (children.length === 1 && only) {
      container = only;
      continue;
    }
    blocks = children;
    break;
  }
  // A block much taller than the screen that holds several headed blocks is a wrapper, not a section
  for (let pass = 0; pass < 4; pass++) {
    let split = false;
    blocks = blocks.flatMap((block) => {
      if (block.getBoundingClientRect().height < vh * 1.2) return [block];
      const children = bigChildren(block);
      if (children.filter(hasSectionHeading).length < 2) return [block];
      split = true;
      return children;
    });
    if (!split) break;
  }
  blocks = blocks.slice(0, MAX_BLOCKS);
  // The section reader (REV-109) reads the same blocks, so both agree on where sections begin
  document.querySelectorAll('[data-revamp-block]').forEach((el) => el.removeAttribute('data-revamp-block'));
  blocks.forEach((el, index) => el.setAttribute('data-revamp-block', String(index)));

  const textOf = (el: Element | null): string => ((el as HTMLElement | null)?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const classOf = (el: Element): string => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  const PRICE = /\d[\d\s.,]*\s?(zł|pln|€|eur|\$|usd|₽|руб|byn|бел\.?\s?руб|br\b|£|gbp|kč|czk)/gi;

  const readBlock = (el: Element): RawLayoutBlock => {
    const box = rectOf(el);
    const ided = Array.from(el.querySelectorAll('[id]')).slice(0, 5);
    const hint = [el, ...ided]
      .map((node) => `${node.id} ${classOf(node)} ${node.getAttribute('aria-label') || ''}`)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const heading = Array.from(el.querySelectorAll('h1, h2, h3')).find(shown) ?? null;
    const images = Array.from(el.querySelectorAll('img, video, picture')).filter((node) => {
      const r = node.getBoundingClientRect();
      return r.width >= 80 && r.height >= 60;
    }).length;
    const text = textOf(el);
    let contentTop = Infinity;
    let contentBottom = -Infinity;
    for (const node of Array.from(el.querySelectorAll(CONTENT)).slice(0, 400)) {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      contentTop = Math.min(contentTop, r.top + window.scrollY);
      contentBottom = Math.max(contentBottom, r.bottom + window.scrollY);
    }
    const paddingY = Number.isFinite(contentTop) ? Math.max(0, contentTop - box.top) + Math.max(0, box.bottom - contentBottom) : 0;
    return {
      top: Math.round(box.top),
      height: Math.round(box.height),
      hint,
      heading: textOf(heading).slice(0, 100),
      imageCount: images,
      formCount: el.querySelectorAll('form').length,
      mapEmbed:
        el.querySelector(
          'iframe[src*="google.com/maps" i], iframe[src*="maps.google" i], iframe[src*="openstreetmap" i], iframe[src*="yandex" i][src*="map" i], iframe[src*="mapy." i], .leaflet-container, .gm-style',
        ) !== null,
      quoteCount: el.querySelectorAll('blockquote, q, [itemtype*="schema.org/Review" i]').length,
      priceCount: Math.min(50, (text.match(PRICE) || []).length),
      textLength: text.length,
      paddingY: Math.round(paddingY),
    };
  };

  // The first screen: its main heading, its photo and its background
  const OPAQUE = (color: string) => {
    const match = color.match(/rgba?\(([^)]+)\)/);
    if (!match) return false;
    const parts = (match[1] ?? '').split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || Number(parts[3]) >= 0.5;
  };
  const backgroundOf = (el: Element | null): string => {
    for (let node = el; node; node = node.parentElement) {
      const color = window.getComputedStyle(node).backgroundColor;
      if (OPAQUE(color)) return color;
    }
    return 'rgb(255, 255, 255)';
  };
  let hero: RawSiteHero | undefined;
  const first = blocks[0];
  if (first && first.getBoundingClientRect().top + window.scrollY < vh) {
    const headings = Array.from(first.querySelectorAll('h1, h2, h3, [class*="title" i], [class*="heading" i]')).filter(shown);
    const heading =
      headings.find((node) => node.tagName === 'H1') ??
      headings.sort((a, b) => parseFloat(window.getComputedStyle(b).fontSize) - parseFloat(window.getComputedStyle(a).fontSize))[0];
    const range = document.createRange();
    if (heading) range.selectNodeContents(heading);
    const textBox = heading ? range.getBoundingClientRect() : first.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    const firstArea = firstBox.width * Math.min(firstBox.height, vh);
    const covers = (node: Element) => {
      const r = node.getBoundingClientRect();
      return r.width * Math.min(r.height, vh) >= firstArea * 0.6;
    };
    const candidates = [first, ...Array.from(first.querySelectorAll('*')).slice(0, 300)];
    const backgroundMedia =
      candidates.some((node) => /url\(/.test(window.getComputedStyle(node).backgroundImage) && covers(node)) ||
      Array.from(first.querySelectorAll('img, video, picture')).some((node) => shown(node) && covers(node));
    let sideMediaCenterX: number | undefined;
    let sideArea = 0;
    for (const node of Array.from(first.querySelectorAll('img, video, picture'))) {
      const r = node.getBoundingClientRect();
      if (r.width < vw * 0.25 || r.height < 150 || covers(node)) continue;
      if (r.width * r.height > sideArea) {
        sideArea = r.width * r.height;
        sideMediaCenterX = r.left + r.width / 2;
      }
    }
    hero = {
      headingAlign: heading ? window.getComputedStyle(heading).textAlign : 'start',
      headingCenterX: Math.round(textBox.left + textBox.width / 2),
      headingWidth: Math.round(textBox.width),
      headingColor: heading ? window.getComputedStyle(heading).color : 'rgb(0, 0, 0)',
      background: backgroundOf(heading ?? first),
      slider: first.matches(SLIDER) || first.querySelector(SLIDER) !== null,
      backgroundMedia,
      ...(sideMediaCenterX !== undefined ? { sideMediaCenterX: Math.round(sideMediaCenterX) } : {}),
    };
  }

  // The header: its menu, logo, stickiness and a filled button
  let header: RawSiteHeader | undefined;
  const headerEl =
    Array.from(document.querySelectorAll('header, [role="banner"], #header, .header, .site-header, .navbar')).find((node) => shown(node) && node.getBoundingClientRect().top < 200) ??
    Array.from(document.querySelectorAll('nav')).find((node) => shown(node) && node.getBoundingClientRect().top < 200);
  if (headerEl) {
    const menu = headerEl.querySelector('nav') || headerEl;
    const labels = new Set(
      Array.from(menu.querySelectorAll('a[href]'))
        .filter((a) => shown(a) && !/^(tel|mailto):/i.test(a.getAttribute('href') || ''))
        .map((a) => textOf(a))
        .filter((label) => label.length > 0 && label.length <= 40),
    );
    const logo = Array.from(headerEl.querySelectorAll('img, svg, [class*="logo" i]')).find(shown);
    const logoBox = logo?.getBoundingClientRect();
    let sticky = false;
    for (let node: Element | null = headerEl; node && node !== document.body; node = node.parentElement) {
      const position = window.getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') sticky = true;
    }
    const headerBackground = backgroundOf(headerEl);
    const hasCta = Array.from(headerEl.querySelectorAll('a, button')).some((node) => {
      if (!shown(node) || !textOf(node)) return false;
      const color = window.getComputedStyle(node).backgroundColor;
      return OPAQUE(color) && color !== headerBackground;
    });
    header = {
      navLinkCount: labels.size,
      ...(logoBox ? { logoCenterX: Math.round(logoBox.left + logoBox.width / 2) } : {}),
      sticky,
      hasCta,
    };
  }

  return {
    viewportWidth: vw,
    viewportHeight: vh,
    pageHeight: Math.round(Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0)),
    blocks: blocks.map(readBlock),
    ...(hero ? { hero } : {}),
    ...(header ? { header } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Node side: raw facts to an ISiteLayout
// ---------------------------------------------------------------------------------------------

/**
 * Words that name a section, in the languages of the audited sites (en, pl, ru, be, uk, lt, de).
 * Checked in this order, first against the heading and then against the block's ids and classes.
 */
/** "Why us" headings, in the languages of the audited sites (REV-109) */
export const WHY_US_WORDS =
  /why (us|choose)|dlaczego (my|warto|nas)|co nas wyróżnia|nasze (atuty|zalety)|\bzalety\b|advantages|преимуществ|почему (мы|выбирают)|чаму (мы|выбіраюць)|перавагі|переваги|чому (ми|обирають)|kodėl (mes|verta)|privalum|warum wir|vorteile/;

const SECTION_WORDS: Array<[SiteSectionKind, RegExp]> = [
  ['reviews', /review|testimonial|opini|recenzj|отзыв|водгук|відгук|atsiliepim|bewertung|kundenstimmen|(mówią|piszą|pacjenci|klienci) o nas|говорят о нас|what (our )?(clients|customers) say/],
  ['faq', /\bfaq\b|pytania|вопрос|пытанн|питанн|dažniausi|klausim|frequently asked|häufige fragen/],
  ['pricing', /pric|cennik|\bceny\b|цены|цена|прайс|стоимост|кошт|вартіст|kainos|kainoraš|preise|tarif|тариф/],
  ['features', WHY_US_WORDS],
  ['team', /\bteam\b|zesp[oó][lł]|kadra|lekarz|специалист|спецыяліст|команд|каманд|врач|doctors|our (staff|specialists)|personel|komanda|gydytoj/],
  ['gallery', /galler|galeri|галере|галерэ|portfolio|портфолио|realizacj|наши работы|нашы працы|our work|zdj[eę]cia|фото|photos|darbai/],
  ['about', /about|\bo (nas|firmie|mnie|kancelarii|klinice|gabinecie|salonie|restauracji|studiu)\b|о нас|о компании|пра нас|про нас|apie (mus|mane|įmonę)|über uns|who we are|our story|historia|история|гісторыя|кто мы/],
  ['services', /servic|us[lł]ug|ofert|offer|what we do|услуг|паслуг|послуг|paslaug|leistung|treatment|zabieg|процедур|zakres|specjalizac|направлени/],
  ['contact', /contact|kontakt|контакт|dojazd|\badres|address|find us|reach us|как добраться|як дабрацца|susisiek|rezerwac|reservation|booking|запис/],
];

const kindFromWords = (text: string): SiteSectionKind | undefined =>
  text ? SECTION_WORDS.find(([, words]) => words.test(text))?.[0] : undefined;

/** What a block is: named by its heading, else its ids and classes, else its structure */
export function classifyBlock(block: RawLayoutBlock): SiteSectionKind {
  // Ids and classes separate words with dashes and underscores (`o-nas`, `our_team`)
  const named = kindFromWords(block.heading.toLowerCase()) ?? kindFromWords(block.hint.toLowerCase().replace(/[-_]+/g, ' '));
  if (named) return named;
  if (block.mapEmbed) return block.formCount > 0 ? 'contact' : 'map';
  if (block.formCount > 0) return 'contact';
  if (block.quoteCount >= 2) return 'reviews';
  if (block.priceCount >= 3) return 'pricing';
  if (block.imageCount >= 4 && block.textLength < block.imageCount * 120) return 'gallery';
  return 'other';
}

type Rgb = { r: number; g: number; b: number };

export function parseRgb(color: string | undefined): Rgb | undefined {
  const match = color?.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!match) return undefined;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

/** WCAG relative luminance, 0 (black) to 1 (white) */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * How colorful a color is, 0 (grey) to 1. Chroma rather than HSL saturation, which calls near-white
 * and near-black tints fully saturated.
 */
export function chroma({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Light text on a first screen means it sits on something dark, whatever the page's own background says */
const LIGHT_TEXT = 0.6;

export function heroTone(hero: Pick<RawSiteHero, 'background' | 'headingColor' | 'backgroundMedia' | 'slider'>): SiteHeroTone {
  const text = parseRgb(hero.headingColor);
  const lightText = text !== undefined && luminance(text) >= LIGHT_TEXT;
  if (hero.backgroundMedia || hero.slider) return lightText ? 'dark' : 'light';
  const background = parseRgb(hero.background) ?? { r: 255, g: 255, b: 255 };
  const lum = luminance(background);
  const colorfulness = chroma(background);
  // White or a barely tinted white; a pale color is a tint
  if (lum >= 0.85 && colorfulness < 0.06) return lightText ? 'dark' : 'light';
  if (lum >= 0.4) return 'tinted';
  return colorfulness >= 0.3 ? 'brand' : 'dark';
}

/** Median white space of a section below which the page reads as compact, and above which as airy, px */
export const DENSITY_COMPACT_MAX = 64;
export const DENSITY_AIRY_MIN = 160;

export function densityOf(blocks: RawLayoutBlock[]): ISiteLayout['density'] {
  const paddings = blocks.map((block) => block.paddingY).sort((a, b) => a - b);
  if (paddings.length === 0) return 'comfortable';
  const middle = Math.floor(paddings.length / 2);
  const upper = paddings[middle] ?? 0;
  const median = paddings.length % 2 ? upper : ((paddings[middle - 1] ?? upper) + upper) / 2;
  if (median < DENSITY_COMPACT_MAX) return 'compact';
  if (median > DENSITY_AIRY_MIN) return 'airy';
  return 'comfortable';
}

/** How far from the middle of the screen text or a logo may sit and still count as centred */
const CENTER_TOLERANCE = 0.06;

export type SiteLayoutReading = { layout: ISiteLayout; error?: undefined } | { layout?: undefined; error: string };

/**
 * Turns the raw DOM facts into the site's layout, or says why they don't describe one. A layout is
 * only read when the page splits into at least two blocks and the first one starts on the first
 * screen; anything less is reported as an error, never filled in.
 */
export function readSiteLayout(raw: RawSiteLayout | undefined): SiteLayoutReading {
  if (!raw || !Array.isArray(raw.blocks) || !(raw.viewportWidth > 0)) {
    return { error: 'The page layout could not be collected' };
  }
  if (raw.blocks.length < 2) {
    return { error: `The page splits into ${raw.blocks.length} block${raw.blocks.length === 1 ? '' : 's'}; no sections to read` };
  }
  if (!raw.hero) {
    return { error: 'No block starts on the first screen' };
  }

  const vw = raw.viewportWidth;
  const sections: ISiteLayoutSection[] = [];
  for (const block of raw.blocks.slice(1)) {
    const kind = classifyBlock(block);
    // One section is often split over several blocks (a heading row, then the cards)
    if (sections.at(-1)?.kind === kind) continue;
    sections.push({ kind, ...(block.heading ? { heading: block.heading.slice(0, 100) } : {}) });
  }

  const { hero } = raw;
  const media = hero.slider ? 'slider' : hero.backgroundMedia ? 'background' : hero.sideMediaCenterX !== undefined ? 'side' : 'none';
  const centered =
    /center/.test(hero.headingAlign) ||
    (Math.abs(hero.headingCenterX - vw / 2) <= vw * CENTER_TOLERANCE && hero.headingWidth < vw * 0.8);
  const header = raw.header;

  const layout = SiteLayoutSchema.parse({
    sections: sections.slice(0, SITE_LAYOUT_MAX_SECTIONS),
    hero: {
      media,
      ...(media === 'side' ? { mediaSide: hero.sideMediaCenterX! < hero.headingCenterX ? 'left' : 'right' } : {}),
      align: centered ? 'center' : 'left',
      tone: heroTone(hero),
    },
    nav: {
      itemCount: Math.min(100, Math.max(0, Math.round(header?.navLinkCount ?? 0))),
      centeredLogo: header?.logoCenterX !== undefined && Math.abs(header.logoCenterX - vw / 2) <= vw * CENTER_TOLERANCE,
      sticky: Boolean(header?.sticky),
      hasCta: Boolean(header?.hasCta),
    },
    density: densityOf(raw.blocks.slice(1)),
  });
  return { layout };
}
