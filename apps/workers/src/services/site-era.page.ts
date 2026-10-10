// The facts the dated-site check (REV-114) reads from the rendered home page (REV-141): how wide its content blocks
// are and its body font. Runs inside the page through `page.evaluate`, so it is self-contained: nothing imported is
// used inside the function.

export interface RawEraFacts {
  /** Median width of the content blocks at the audit's 1440 px viewport, rounded */
  contentWidth?: number;
  /** Share of the content blocks at least 95% of the viewport wide */
  fullBleedShare?: number;
  /** The computed font-family of the first paragraph of body text */
  bodyFont?: string;
}

export function collectEraFactsInPage(): RawEraFacts {
  const MAX_BLOCKS = 40;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const CHROME = 'header, footer, nav, aside, [role="banner"], [role="contentinfo"], [role="navigation"], script, style, noscript, template, dialog, svg';
  // Old and page-builder sites build their header and footer from plain divs named after them
  const CHROME_CLASSES = /^(header|site-header|header[-_]wrapper|header[-_]container|footer|site-footer|footer[-_]wrapper|navbar|topbar|top[-_]bar)$/i;

  const shown = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
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

  // The page's content blocks, chosen as the layout walk (REV-104) chose them: wrappers with one big child are opened
  // until the page splits into several blocks, and a block much taller than the screen that holds several headed
  // blocks is a wrapper, not a section
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

  const facts: RawEraFacts = {};
  const widths = blocks.map((el) => Math.round(el.getBoundingClientRect().width)).sort((a, b) => a - b);
  if (widths.length > 0) {
    const mid = Math.floor(widths.length / 2);
    facts.contentWidth = widths.length % 2 ? widths[mid]! : Math.round((widths[mid - 1]! + widths[mid]!) / 2);
    facts.fullBleedShare = widths.filter((w) => w >= vw * 0.95).length / widths.length;
  }

  // The body font: the first shown paragraph of at least 40 characters in a block
  const textOf = (el: Element): string => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const paragraph = blocks
    .flatMap((block) => Array.from(block.querySelectorAll('p')))
    .find((p) => shown(p) && textOf(p).length >= 40);
  if (paragraph) facts.bodyFont = window.getComputedStyle(paragraph).fontFamily;
  return facts;
}
