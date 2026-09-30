/**
 * In-page half of the site section reader (REV-109). `collectSiteSectionsInPage` runs inside the
 * crawled page via page.evaluate(), so it must stay fully self-contained: no imports, no references
 * to module-level values. It reads the header, the blocks REV-104's layout walk tagged with
 * `data-revamp-block`, and the footer, and only reports raw DOM facts; `readSiteSections`
 * (site-sections.service.ts) makes every decision in Node. No LLM is involved at any step.
 */

/** A box in page coordinates, px */
export interface RawBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface RawSiteLink {
  label: string;
  /** Absolute */
  href: string;
  /** Styled as a button: padding plus an opaque background or a border */
  button: boolean;
  /** The link has no text; its label comes from aria-label or title and is not page text */
  labelFromAttribute?: boolean;
}

export interface RawSiteImage {
  /** Absolute, never a data: URI */
  src: string;
  alt: string;
  box: RawBox;
  /** Corner radius of the image or its clipping parent, px */
  radius: number;
}

export interface RawSiteItem {
  title?: string;
  subtitle?: string;
  text: string[];
  image?: RawSiteImage;
  price?: string;
  rating?: number;
  links: RawSiteLink[];
  /** Carries an icon (svg, icon font, or a small image) */
  icon: boolean;
  box: RawBox;
}

/** Markup that names a group's arrangement or content outright */
export type RawGroupMarkup = 'accordion' | 'tabs' | 'slider' | 'person' | 'review';

export interface RawItemGroup {
  markup?: RawGroupMarkup;
  items: RawSiteItem[];
}

export interface RawSiteEmbed {
  kind: 'map' | 'video' | 'form' | 'widget';
  src?: string;
  box: RawBox;
}

export interface RawSiteBlock {
  role: 'header' | 'content' | 'footer';
  /** The REV-104 block index (`data-revamp-block`); absent for the header and footer */
  block?: number;
  box: RawBox;
  /** Around the eyebrow, heading and intro text */
  introBox?: RawBox;
  /** Around all visible content */
  contentBox?: RawBox;
  intro: { eyebrow?: string; heading?: string; headingLevel?: number; text: string[]; links: RawSiteLink[] };
  group?: RawItemGroup;
  extra: Array<{ type: 'text'; text: string[] } | { type: 'items'; group: RawItemGroup }>;
  /** Images outside the items */
  images: RawSiteImage[];
  backgroundImage?: string;
  embeds: RawSiteEmbed[];
  style: { background: string; color: string; textAlign: string; paddingTop: number; paddingBottom: number };
  /** Computed style of the first item's card */
  itemStyle?: { background: string; radius: number; borderWidth: number; boxShadow: string; textAlign: string };
}

/** Text outside every section, with its offset from the top of the page */
export interface RawTextRun {
  text: string;
  top: number;
}

export interface RawTypography {
  heading?: { family: string; size: number; weight: number; transform: string; color: string };
  body?: { family: string; size: number; weight: number; lineHeight: string; color: string };
  button?: { radius: number; background: string; borderWidth: number; transform: string; color: string };
}

export interface RawSiteSections {
  viewportWidth: number;
  viewportHeight: number;
  header?: RawSiteBlock;
  blocks: RawSiteBlock[];
  footer?: RawSiteBlock;
  typography: RawTypography;
  /** Characters of page text (visible text, plus hidden text inside sections) */
  pageChars: number;
  uncaptured: RawTextRun[];
}

export function collectSiteSectionsInPage(): RawSiteSections {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const MAX_ITEMS = 80;
  const MAX_RUNS = 200;
  const EXCLUDED = 'script, style, noscript, template, svg, .swiper-slide-duplicate, .slick-cloned';
  const CONTENT = 'h1, h2, h3, h4, h5, h6, p, img, video, li, a, button, blockquote, iframe, figure, input, textarea';
  const MAP_SRC = /google\.[a-z.]+\/maps|maps\.google|openstreetmap|mapy\.|yandex\.[a-z]+\/(map-widget|maps)/i;
  const VIDEO_SRC = /youtube\.com|youtu\.be|youtube-nocookie|vimeo\.com|wistia/i;
  const MAX_SCAN = 1500;
  // Slider libraries by their container; other slider classes are matched per token, see `inSlider`
  const SLIDER = '.swiper, .swiper-container, .slick-slider, .owl-carousel, .carousel, .splide, .flickity-enabled, .glide, rs-module, .rev_slider';
  const PRICE = /(?:(?:od|from|от|ад|nuo|ab)\s+)?\d[\d\s.,]*\s?(?:zł|pln|€|eur|\$|usd|₽|руб|byn|br\b|£|gbp|kč|czk)/i;

  // Soft hyphens and icon-font glyphs (private-use characters) are not copy
  const clean = (value: string | null | undefined): string =>
    (value || '').replace(/­/g, '').replace(/\p{Co}/gu, '').replace(/\s+/g, ' ').trim();
  const classOf = (el: Element): string => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  const boxOf = (el: Element): RawBox => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left + window.scrollX), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const unionOf = (boxes: RawBox[]): RawBox | undefined => {
    const drawn = boxes.filter((b) => b.width > 0 && b.height > 0);
    if (drawn.length === 0) return undefined;
    const top = Math.min(...drawn.map((b) => b.top));
    const left = Math.min(...drawn.map((b) => b.left));
    const bottom = Math.max(...drawn.map((b) => b.top + b.height));
    const right = Math.max(...drawn.map((b) => b.left + b.width));
    return { top, left, width: right - left, height: bottom - top };
  };
  const shown = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const absolute = (value: string | null | undefined): string | undefined => {
    const trimmed = (value || '').trim();
    if (!trimmed || /^(data:|javascript:|#)/i.test(trimmed)) return undefined;
    try {
      return new URL(trimmed, document.baseURI).href;
    } catch {
      return undefined;
    }
  };
  const radiusOf = (el: Element, width: number): number => {
    const value = window.getComputedStyle(el).borderTopLeftRadius;
    return value.endsWith('%') ? (parseFloat(value) / 100) * width : parseFloat(value) || 0;
  };
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
  // Copied from site-content.extractor.ts (in-page code cannot import)
  const inBoilerplate = (el: Element): boolean => {
    const match = el.closest('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], script, style, noscript');
    if (!match || match === document.body || match === document.documentElement) return false;
    return !match.querySelector('h1, main, article');
  };
  const excluded = (el: Element): boolean => el.closest(EXCLUDED) !== null || inBoilerplate(el);
  const displays = new Map<Element, string>();
  const isBlock = (el: Element): boolean => {
    let display = displays.get(el);
    if (display === undefined) {
      display = window.getComputedStyle(el).display;
      displays.set(el, display);
    }
    return !display.startsWith('inline') && display !== 'contents';
  };
  const blockOf = (el: Element, root: Element): Element => {
    let node: Element | null = el;
    while (node && node !== root && !isBlock(node)) node = node.parentElement;
    return node ?? root;
  };

  /** Text of `root` as one string per nearest block-level ancestor, in page order; text inside `skip` is left out */
  const runsOf = (root: Element, skip: Element[]): Array<{ el: Element; text: string }> => {
    const runs = new Map<Element, string[]>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) continue;
      if (excluded(parent) || skip.some((el) => el.contains(parent))) continue;
      const block = blockOf(parent, root);
      const parts = runs.get(block);
      if (parts) parts.push(node.nodeValue);
      else runs.set(block, [node.nodeValue]);
    }
    return Array.from(runs, ([el, parts]) => ({ el, text: clean(parts.join(' ')) })).filter((run) => run.text.length > 0);
  };

  const isButton = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    const padded = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) >= 16;
    const bordered = style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) >= 1;
    return (padded && (OPAQUE(style.backgroundColor) || bordered)) || /\bbtn\b|button/i.test(classOf(el));
  };
  const linkOf = (el: Element): RawSiteLink | undefined => {
    const href = absolute(el.getAttribute('href'));
    const text = clean(el.textContent);
    const label = text || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
    if (!href || !label) return undefined;
    return { label, href, button: isButton(el), ...(text ? {} : { labelFromAttribute: true }) };
  };
  /**
   * A block whose own text (not its nested blocks') is all inside links: a menu, a button row, a call
   * to action placed straight in a section. Its links are kept as links, not repeated as text.
   */
  const onlyLinks = (block: Element, root: Element): boolean => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let any = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.trim() || excluded(parent) || blockOf(parent, root) !== block) continue;
      if (!parent.closest('a[href]')) return false;
      any = true;
    }
    return any;
  };
  const linksIn = (root: Element, skip: Element[]): { links: RawSiteLink[]; standalone: Element[] } => {
    const anchors = Array.from(root.querySelectorAll('a[href]')).filter((a) => !excluded(a) && !skip.some((el) => el.contains(a)));
    const links = anchors.map(linkOf).filter((link): link is RawSiteLink => link !== undefined);
    const standalone = anchors.filter((a) => !a.querySelector('p, h1, h2, h3, h4, h5, h6, li, img') && onlyLinks(blockOf(a, root), root));
    return { links, standalone };
  };

  const imageOf = (el: Element): RawSiteImage | undefined => {
    const img = el as HTMLImageElement;
    const srcset = (img.getAttribute('data-srcset') || img.getAttribute('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0];
    const src = [img.currentSrc, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), srcset, img.getAttribute('src')]
      .map(absolute)
      .find((value) => value !== undefined);
    if (!src) return undefined;
    const box = boxOf(img);
    // A lazy image not loaded yet is drawn at its placeholder's size; its width and height attributes give the real one
    const width = Number(img.getAttribute('width'));
    const height = Number(img.getAttribute('height'));
    if (img.naturalWidth === 0 && width > 0 && height > 0) {
      box.width = width;
      box.height = height;
    }
    const parent = img.parentElement;
    const parentRadius = parent && window.getComputedStyle(parent).overflow === 'hidden' ? radiusOf(parent, boxOf(parent).width) : 0;
    return { src, alt: clean(img.getAttribute('alt')), box, radius: Math.round(Math.max(radiusOf(img, box.width), parentRadius)) };
  };
  const imagesIn = (root: Element, skip: Element[]): RawSiteImage[] =>
    Array.from(root.querySelectorAll('img'))
      .filter((img) => !excluded(img) && !skip.some((el) => el.contains(img)))
      .map(imageOf)
      .filter((image): image is RawSiteImage => image !== undefined && (image.box.width === 0 || image.box.width >= 40 || image.box.height >= 40))
      .slice(0, 40);

  const embedsIn = (root: Element): RawSiteEmbed[] => {
    const SELECTOR = 'iframe, video, form, .leaflet-container, .gm-style';
    const embeds: RawSiteEmbed[] = [];
    for (const el of Array.from(root.querySelectorAll(SELECTOR))) {
      if (excluded(el) || (el.parentElement && el.parentElement.closest(SELECTOR) && root.contains(el.parentElement.closest(SELECTOR)))) continue;
      if (el.tagName === 'FORM') {
        const action = absolute(el.getAttribute('action'));
        embeds.push({ kind: 'form', ...(action ? { src: action } : {}), box: boxOf(el) });
        continue;
      }
      const src = absolute(el.getAttribute('src') || el.getAttribute('data-src') || el.querySelector('source')?.getAttribute('src'));
      let kind: RawSiteEmbed['kind'];
      if (el.tagName === 'IFRAME') kind = src && MAP_SRC.test(src) ? 'map' : src && VIDEO_SRC.test(src) ? 'video' : 'widget';
      else if (el.tagName === 'VIDEO') kind = 'video';
      else kind = 'map';
      embeds.push({ kind, ...(src ? { src } : {}), box: boxOf(el) });
    }
    return embeds.slice(0, 20);
  };

  const backgroundImageOf = (root: Element): string | undefined => {
    const rootBox = root.getBoundingClientRect();
    const rootArea = rootBox.width * rootBox.height;
    for (const el of [root, ...Array.from(root.querySelectorAll('*')).slice(0, 300)]) {
      const match = window.getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (!match) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < rootArea * 0.6) continue;
      const src = absolute(match[1]);
      if (src) return src;
    }
    return undefined;
  };

  // Item groups: the largest group of repeated siblings, or one markup names outright
  type Found = { members: Element[]; covers: Element[]; markup?: RawGroupMarkup; weight: number; titles?: string[] };
  // Plain text elements are never items on their own; a list of paragraphs is text
  const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'A', 'BUTTON', 'LABEL', 'BR', 'SMALL', 'SUMMARY']);
  const ITEM_TAGS = new Set(['LI', 'DETAILS', 'ARTICLE', 'TR', 'FIGURE']);
  const hasImage = (el: Element) => el.tagName === 'IMG' || el.querySelector('img') !== null;
  const signature = (el: Element): string => {
    const tags = (list: Element[]) => Array.from(new Set(list.map((node) => node.tagName))).sort().join(',');
    const children = Array.from(el.children);
    return `${el.tagName}(${tags(children)}|${tags(children.flatMap((child) => Array.from(child.children)))})`;
  };
  const profile = (el: Element) => `${hasImage(el) ? 'i' : ''}${clean(el.textContent) ? 't' : ''}`;
  // An item holds more than one line of text, an image, a price, or is a list entry
  const composite = (el: Element) => ITEM_TAGS.has(el.tagName) || hasImage(el) || runsOf(el, []).length >= 2 || PRICE.test(clean(el.textContent));
  // A class token naming a slider; flags such as Elementor's `has_eae_slider` on every section do not
  const SLIDER_TOKEN = /slider|slideshow/i;
  const FLAG_TOKEN = /^(has|no|is|with|enable|disable)[-_]/i;
  /** The group sits in a slider inside the section; what wraps the section does not count */
  const inSlider = (el: Element, root: Element): boolean => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.matches(SLIDER)) return true;
      if (classOf(node).split(/\s+/).some((token) => SLIDER_TOKEN.test(token) && !FLAG_TOKEN.test(token))) return true;
      if (node === root) return false;
    }
    return false;
  };
  const markupOf = (parent: Element, members: Element[], root: Element): RawGroupMarkup | undefined => {
    if (
      members.every((m) => m.matches('details') || m.querySelector('details, [aria-expanded]') !== null) ||
      /accordion|toggle|faq/i.test(`${classOf(parent)} ${classOf(members[0]!)}`)
    ) {
      return 'accordion';
    }
    if (inSlider(parent, root)) return 'slider';
    if (members.every((m) => /schema\.org\/Person/i.test(m.getAttribute('itemtype') || ''))) return 'person';
    if (members.every((m) => /schema\.org\/Review/i.test(m.getAttribute('itemtype') || ''))) return 'review';
    return undefined;
  };

  const pickGroups = (root: Element, skip: Element[]): Found[] => {
    const found: Found[] = [];
    const taken = (el: Element) => skip.some((s) => s.contains(el) || el.contains(s));

    // Tabs: each tab with the panel it controls, hidden panels included
    for (const list of Array.from(root.querySelectorAll('[role="tablist"]'))) {
      const tabs = Array.from(list.querySelectorAll('[role="tab"]')).filter((tab) => !taken(tab));
      const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls') || ''));
      if (tabs.length < 2 || panels.some((panel) => !panel || !root.contains(panel))) continue;
      found.push({
        members: panels as Element[],
        covers: [list, ...(panels as Element[])],
        markup: 'tabs',
        titles: tabs.map((tab) => clean(tab.textContent)),
        weight: (panels as Element[]).reduce((sum, panel) => sum + clean(panel.textContent).length, 0),
      });
    }

    const parents = [root, ...Array.from(root.querySelectorAll('*')).slice(0, MAX_SCAN)];
    for (const parent of parents) {
      if (parent.children.length < 2 || excluded(parent) || TEXT_TAGS.has(parent.tagName) || parent.matches('[role="tablist"]')) continue;
      const bySignature = new Map<string, Element[]>();
      for (const child of Array.from(parent.children)) {
        // A link is text, unless it wraps a photo or a card: a gallery of linked images
        if (excluded(child) || (TEXT_TAGS.has(child.tagName) && !(child.tagName === 'A' && hasImage(child))) || taken(child)) continue;
        if (!clean(child.textContent) && !hasImage(child)) continue;
        const key = signature(child);
        const list = bySignature.get(key);
        if (list) list.push(child);
        else bySignature.set(key, [child]);
      }
      for (const members of Array.from(bySignature.values())) {
        if (members.length < 2) continue;
        // Most members must hold the same kinds of content: a text column beside a photo column is not a pair of cards
        const counts = new Map<string, number>();
        for (const m of members) counts.set(profile(m), (counts.get(profile(m)) ?? 0) + 1);
        if (Math.max(...Array.from(counts.values())) < members.length * 0.75) continue;
        const markup = markupOf(parent, members, root);
        if (!markup && members.filter(composite).length < members.length * 0.75) continue;
        const weight = members.reduce((sum, m) => sum + clean(m.textContent).length + (hasImage(m) ? 50 : 0), 0);
        found.push({ members, covers: members, ...(markup ? { markup } : {}), weight });
      }
    }

    // Cards laid out in rows (Elementor inner sections, Bootstrap rows): a group whose every member is a
    // row holding a group of the same cards is those cards, in page order
    const rowsFlattened = found.map((group): Found => {
      if (group.markup) return group;
      const inner = group.members.map((row) =>
        found
          .filter((other) => other !== group && other.members.every((member) => member !== row && row.contains(member)))
          .sort((a, b) => b.weight - a.weight)[0],
      );
      if (inner.some((g) => g === undefined)) return group;
      const cards = inner as Found[];
      const cardSignature = signature(cards[0]!.members[0]!);
      if (!cards.every((g) => g.members.every((member) => signature(member) === cardSignature))) return group;
      if (cards.reduce((sum, g) => sum + g.weight, 0) < group.weight * 0.75) return group;
      return { members: cards.flatMap((g) => g.members), covers: group.covers, weight: group.weight };
    });
    const ranked = rowsFlattened.sort((a, b) => b.weight - a.weight);
    const top = ranked[0];
    if (!top) return [];
    // Markup wins when its group holds at least half of the biggest group's content
    const main = ranked.find((g) => g.markup && g.weight >= top.weight / 2) ?? top;
    const apart = (a: Found, b: Found) => !a.covers.some((x) => b.covers.some((y) => x.contains(y) || y.contains(x)));
    const second = ranked.find((g) => g !== main && apart(g, main) && g.weight >= 40);
    return second ? [main, second] : [main];
  };

  const TITLE = 'h1, h2, h3, h4, h5, h6, summary, [aria-expanded], dt';
  const TITLE_FALLBACK = 'strong, b, [class*="title" i], [class*="name" i], [class*="author" i]';
  // A slide's position label ("1 / 5" on a Swiper slide) is not a rating
  const isSlideLabel = (node: Element): boolean =>
    node.matches('[role="group" i], [aria-roledescription="slide" i]') || /(^|[\s_-])slide($|[\s_-])|swiper-slide|slick-slide/i.test(classOf(node));
  const ratingOf = (el: Element): number | undefined => {
    const labels = [el, ...Array.from(el.querySelectorAll('[aria-label], [title]'))]
      .filter((node) => !isSlideLabel(node))
      .map((node) => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`)
      .join(' ');
    const scored = `${labels} ${clean(el.textContent)}`.match(/(?<![\d/.,])(\d(?:[.,]\d+)?)\s*(?:\/|na|z|из|of)\s*(5|10)(?![\d/])/i);
    if (scored) {
      const value = parseFloat((scored[1] ?? '').replace(',', '.'));
      return scored[2] === '10' ? value / 2 : value;
    }
    const glyphs = (clean(el.textContent).match(/★/g) || []).length;
    if (glyphs >= 1 && glyphs <= 5) return glyphs;
    const stars = Array.from(el.querySelectorAll('[class*="star" i]')).filter(
      (node) => node.querySelector('[class*="star" i]') === null && !/empty|half|outline|-o\b/i.test(classOf(node)),
    );
    return stars.length >= 1 && stars.length <= 5 ? stars.length : undefined;
  };

  /** The item's most prominent heading (h2 over h4), the first of its level; a smaller label before it is not the title */
  const headingOf = (member: Element): Element | null => {
    for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const found = Array.from(member.querySelectorAll(level)).find((h) => clean(h.textContent));
      if (found) return found;
    }
    return null;
  };
  const readItem = (member: Element, titleOverride?: string): RawSiteItem => {
    const titleEl =
      titleOverride !== undefined
        ? null
        : (headingOf(member) ??
          member.querySelector(TITLE) ??
          Array.from(member.querySelectorAll(TITLE_FALLBACK)).find((el) => {
            const text = clean(el.textContent);
            return text.length > 0 && text.length <= 80;
          }) ??
          null);
    const title = titleOverride ?? (titleEl ? clean(titleEl.textContent) : undefined);

    // A short line right next to the title: a role under a name, a date over a review
    let subtitleEl: Element | undefined;
    if (titleEl && !member.matches('details') && !titleEl.matches('summary, [aria-expanded]')) {
      let anchor: Element = titleEl;
      while (anchor.parentElement && anchor.parentElement !== member && !anchor.nextElementSibling && !anchor.previousElementSibling) {
        anchor = anchor.parentElement;
      }
      subtitleEl = [anchor.nextElementSibling, anchor.previousElementSibling].find((el): el is Element => {
        if (!el || el.querySelector('img, h1, h2, h3, h4, h5, h6')) return false;
        const text = clean(el.textContent);
        return text.length > 0 && text.length <= 60 && !PRICE.test(text);
      });
    }

    const { links, standalone } = linksIn(member, []);
    const skip = [...(titleEl ? [titleEl] : []), ...(subtitleEl ? [subtitleEl] : []), ...standalone];
    let text = runsOf(member, skip).map((run) => run.text);
    const images = Array.from(member.querySelectorAll('img'))
      .map(imageOf)
      .filter((image): image is RawSiteImage => image !== undefined)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    const image = images[0];
    let subtitle = subtitleEl ? clean(subtitleEl.textContent) : undefined;
    // With nothing else under the title, the short line is the item's text, not its subtitle
    if (subtitle && text.length === 0 && !image) {
      text = [subtitle];
      subtitle = undefined;
    }
    const price = clean(member.textContent).match(PRICE)?.[0]?.trim();
    const rating = ratingOf(member);
    const icon =
      member.querySelector('svg, i[class*="icon" i], i[class*="fa-" i], [class*="icon" i]') !== null ||
      (image !== undefined && image.box.width > 0 && image.box.width <= 96);
    return {
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      text,
      ...(image ? { image } : {}),
      ...(price ? { price } : {}),
      ...(rating !== undefined ? { rating } : {}),
      links,
      icon,
      box: boxOf(member),
    };
  };

  const readGroup = (found: Found): RawItemGroup => ({
    ...(found.markup ? { markup: found.markup } : {}),
    items: found.members.slice(0, MAX_ITEMS).map((member, i) => readItem(member, found.titles?.[i])),
  });

  // The element that paints the card: the member or a descendant nearly as big with a background, border or shadow
  const cardStyle = (member: Element): RawSiteBlock['itemStyle'] => {
    const areaOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
    const memberArea = areaOf(member);
    const card =
      [member, ...Array.from(member.querySelectorAll('*')).slice(0, 50)].find((el) => {
        if (areaOf(el) < memberArea * 0.8) return false;
        const s = window.getComputedStyle(el);
        return OPAQUE(s.backgroundColor) || (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) >= 1) || s.boxShadow !== 'none';
      }) ?? member;
    const s = window.getComputedStyle(card);
    return {
      background: OPAQUE(s.backgroundColor) ? s.backgroundColor : '',
      radius: radiusOf(card, boxOf(card).width),
      borderWidth: s.borderTopStyle === 'none' ? 0 : parseFloat(s.borderTopWidth) || 0,
      boxShadow: s.boxShadow,
      textAlign: s.textAlign,
    };
  };

  const closedStyle = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
  };
  /** Closed parts of a header or footer (dropdowns, a mobile menu): not shown, so not read and not page text */
  const closedParts = (root: Element): Element[] => {
    const closed: Element[] = [];
    for (const el of Array.from(root.querySelectorAll('*')).slice(0, MAX_SCAN)) {
      if (!closed.some((c) => c.contains(el)) && closedStyle(el)) closed.push(el);
    }
    return closed;
  };
  const inClosedPart = (el: Element, root: Element): boolean => {
    for (let node: Element | null = el; node && node !== root; node = node.parentElement) if (closedStyle(node)) return true;
    return false;
  };

  const readBlock = (root: Element, role: RawSiteBlock['role'], index: number | undefined, outside: Element[]): RawSiteBlock => {
    // Hidden text inside a section is content (collapsed answers, tabs); in the header and footer it is a closed menu
    const skip = role === 'content' ? outside : [...outside, ...closedParts(root)];
    const groups = role === 'content' ? pickGroups(root, skip) : [];
    const [main, second] = groups;
    const hidden = [...skip, ...groups.flatMap((g) => g.covers)];
    const { links, standalone } = linksIn(root, hidden);
    const firstMember = main?.members[0];
    const precedes = (el: Element) => !firstMember || Boolean(el.compareDocumentPosition(firstMember) & Node.DOCUMENT_POSITION_FOLLOWING);
    const headingEl =
      role === 'content'
        ? Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
            (h) => !hidden.some((el) => el.contains(h)) && !excluded(h) && precedes(h) && clean(h.textContent),
          )
        : undefined;
    const runs = runsOf(root, [...hidden, ...standalone, ...(headingEl ? [headingEl] : [])]);

    // Intro: what comes before the items; header and footer keep all their text as extra
    const introRuns = role === 'content' ? runs.filter((run) => precedes(run.el)) : [];
    let eyebrow: string | undefined;
    let eyebrowRun: (typeof runs)[number] | undefined;
    const firstRun = introRuns[0];
    if (headingEl && firstRun && firstRun.text.length <= 60 && firstRun.el.compareDocumentPosition(headingEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
      eyebrow = firstRun.text;
      eyebrowRun = firstRun;
      introRuns.shift();
    }
    // The eyebrow run itself, not every later line that happens to repeat its text
    const restRuns = runs.filter((run) => !introRuns.includes(run) && run !== eyebrowRun);

    const extra: RawSiteBlock['extra'] = [];
    const secondAt = second?.members[0];
    let secondPlaced = second === undefined;
    for (const run of restRuns) {
      if (!secondPlaced && secondAt && run.el.compareDocumentPosition(secondAt) & Node.DOCUMENT_POSITION_PRECEDING) {
        extra.push({ type: 'items', group: readGroup(second!) });
        secondPlaced = true;
      }
      const last = extra[extra.length - 1];
      if (last && last.type === 'text') last.text.push(run.text);
      else extra.push({ type: 'text', text: [run.text] });
    }
    if (!secondPlaced && second) extra.push({ type: 'items', group: readGroup(second) });

    const contentBox = unionOf(
      Array.from(root.querySelectorAll(CONTENT)).slice(0, 400).filter((el) => !excluded(el)).map(boxOf),
    );
    const box = boxOf(root);
    const styleEl = headingEl ?? root;
    const styleOf = window.getComputedStyle(styleEl);
    const headingLevel = headingEl ? Number(headingEl.tagName.slice(1)) : undefined;
    const backgroundImage = backgroundImageOf(root);
    const itemStyle = firstMember ? cardStyle(firstMember) : undefined;
    const introBox = unionOf([...(headingEl ? [boxOf(headingEl)] : []), ...introRuns.map((run) => boxOf(run.el))]);

    return {
      role,
      ...(index !== undefined ? { block: index } : {}),
      box,
      ...(introBox ? { introBox } : {}),
      ...(contentBox ? { contentBox } : {}),
      intro: {
        ...(eyebrow ? { eyebrow } : {}),
        ...(headingEl ? { heading: clean(headingEl.textContent), headingLevel } : {}),
        text: introRuns.map((run) => run.text),
        links,
      },
      ...(main ? { group: readGroup(main) } : {}),
      extra,
      images: imagesIn(root, hidden),
      ...(backgroundImage ? { backgroundImage } : {}),
      embeds: embedsIn(root),
      style: {
        background: backgroundOf(root),
        color: styleOf.color,
        textAlign: styleOf.textAlign,
        paddingTop: contentBox ? Math.max(0, contentBox.top - box.top) : 0,
        paddingBottom: contentBox ? Math.max(0, box.top + box.height - (contentBox.top + contentBox.height)) : 0,
      },
      ...(itemStyle ? { itemStyle } : {}),
    };
  };

  // The roots: the header, the blocks the layout walk tagged, the footer
  const blocks = Array.from(document.querySelectorAll('[data-revamp-block]')).sort(
    (a, b) => Number(a.getAttribute('data-revamp-block')) - Number(b.getAttribute('data-revamp-block')),
  );
  // Same pick as REV-104's header reading; a "header" that wraps content blocks is not the header
  const headerCandidate =
    Array.from(document.querySelectorAll('header, [role="banner"], #header, .header, .site-header, .navbar')).find(
      (node) => shown(node) && node.getBoundingClientRect().top < 200,
    ) ?? Array.from(document.querySelectorAll('nav')).find((node) => shown(node) && node.getBoundingClientRect().top < 200);
  const headerEl = headerCandidate && !blocks.some((b) => headerCandidate.contains(b)) ? headerCandidate : undefined;
  // Footers named only by an id or class token, as REV-104's layout walk leaves them out (its CHROME_CLASSES; copied, in-page code cannot import)
  const FOOTER_TOKEN = /^(footer|site-footer|footer[-_]wrapper)$/i;
  const namedFooters = Array.from(document.querySelectorAll('[id], [class]')).filter((el) =>
    [el.id, ...Array.from(el.classList)].some((token) => FOOTER_TOKEN.test(token)),
  );
  const footerCandidates = Array.from(new Set([...Array.from(document.querySelectorAll('footer, [role="contentinfo"]')), ...namedFooters])).filter(
    (el) => shown(el) && !el.closest('[data-revamp-block]') && !blocks.some((b) => el.contains(b)) && !(headerEl && headerEl.contains(el)),
  );
  // The last one in page order
  const footerEl = footerCandidates
    .filter((el) => !footerCandidates.some((other) => other !== el && other.contains(el)))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .pop();
  const chrome = [headerEl, footerEl].filter((el): el is Element => el !== undefined);

  // Site-wide typography
  const firstIn = (roots: Element[], selector: string, test: (el: Element) => boolean) =>
    roots.flatMap((root) => Array.from(root.querySelectorAll(selector))).find((el) => shown(el) && !excluded(el) && test(el));
  const fontOf = (el: Element) => {
    const s = window.getComputedStyle(el);
    return { family: s.fontFamily, size: parseFloat(s.fontSize) || 0, weight: Number(s.fontWeight) || 400, transform: s.textTransform, color: s.color, lineHeight: s.lineHeight };
  };
  const headingSample = firstIn(blocks, 'h2', (el) => clean(el.textContent).length > 0) ?? firstIn(blocks, 'h1', (el) => clean(el.textContent).length > 0);
  const bodySample = firstIn(blocks, 'p', (el) => clean(el.textContent).length >= 40);
  const buttonSample = firstIn([...chrome, ...blocks], 'a[href], button', (el) => clean(el.textContent).length > 0 && isButton(el));
  const typography: RawTypography = {};
  if (headingSample) {
    const { family, size, weight, transform, color } = fontOf(headingSample);
    typography.heading = { family, size, weight, transform, color };
  }
  if (bodySample) {
    const { family, size, weight, lineHeight, color } = fontOf(bodySample);
    typography.body = { family, size, weight, lineHeight, color };
  }
  if (buttonSample) {
    const s = window.getComputedStyle(buttonSample);
    typography.button = {
      radius: radiusOf(buttonSample, boxOf(buttonSample).width),
      background: s.backgroundColor,
      borderWidth: s.borderTopStyle === 'none' ? 0 : parseFloat(s.borderTopWidth) || 0,
      transform: s.textTransform,
      color: s.color,
    };
  }

  // Text accounting: all page text, split the same way the sections are read
  const roots = [...chrome, ...blocks];
  const floating = (el: Element): boolean => {
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      if (window.getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
  };
  let pageChars = 0;
  const uncaptured: RawTextRun[] = [];
  for (const run of runsOf(document.body, [])) {
    // Hidden text counts inside a section (collapsed answers, tabs, slides), not elsewhere
    const root = roots.find((r) => r.contains(run.el));
    if (root && chrome.includes(root) && inClosedPart(run.el, root)) continue;
    if (root) {
      pageChars += run.text.length;
      continue;
    }
    if (floating(run.el) || !shown(run.el)) continue;
    pageChars += run.text.length;
    if (uncaptured.length < MAX_RUNS) uncaptured.push({ text: run.text.slice(0, 300), top: boxOf(run.el).top });
  }

  return {
    viewportWidth: vw,
    viewportHeight: vh,
    ...(headerEl ? { header: readBlock(headerEl, 'header', undefined, []) } : {}),
    blocks: blocks.map((el) => readBlock(el, 'content', Number(el.getAttribute('data-revamp-block')), chrome)),
    ...(footerEl ? { footer: readBlock(footerEl, 'footer', undefined, []) } : {}),
    typography,
    pageChars,
    uncaptured,
  };
}
