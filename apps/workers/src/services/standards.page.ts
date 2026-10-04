import type { IStandardsChecks } from '@revamp/shared-types';

/** The standards checks read from the DOM; the favicon may still be found at `/favicon.ico` */
export type RawStandards = Required<Pick<IStandardsChecks, 'viewport' | 'title' | 'metaDescription' | 'singleH1' | 'structuredData' | 'openGraph'>> & {
  faviconLink: boolean;
};

/**
 * The page's web standards and SEO checks (REV-102, REV-118), read from a document. Self-contained: the audit runs it
 * in the page through `page.evaluate` (the document defaults to the page's own), and the MVP check runs it on the
 * published HTML in happy-dom (`checkMvpStandards`), so both are scored by the same checks. No imports and no
 * module-level values inside: it is serialized into the page. Attribute values are compared in code, not with
 * case-insensitive selectors, which happy-dom does not support.
 */
export function readStandardsInDocument(doc?: Document): RawStandards {
  const d = doc ?? document;
  const attr = (el: Element, name: string) => (el.getAttribute(name) ?? '').trim();
  /** Some `tag` whose `key` attribute passes `test` (lower-cased) has a non-empty `value` attribute */
  const tagWith = (tag: string, key: string, test: (v: string) => boolean, value: string) =>
    Array.from(d.querySelectorAll(tag)).some((el) => test(attr(el, key).toLowerCase()) && attr(el, value).length > 0);
  // Any Schema.org JSON-LD object with a type, or microdata pointing at schema.org
  const typed = (node: unknown): boolean =>
    Array.isArray(node)
      ? node.some(typed)
      : !!node && typeof node === 'object' && (!!(node as Record<string, unknown>)['@type'] || typed((node as Record<string, unknown>)['@graph']));
  const hasJsonLd = Array.from(d.querySelectorAll('script[type="application/ld+json"]')).some((script) => {
    try {
      return typed(JSON.parse(script.textContent || ''));
    } catch {
      return false;
    }
  });
  const microdata = Array.from(d.querySelectorAll('[itemtype]')).some((el) => attr(el, 'itemtype').toLowerCase().includes('schema.org'));
  const h1s = Array.from(d.querySelectorAll('h1')).filter((h1) => (h1.textContent ?? '').trim().length > 0);
  return {
    viewport: tagWith('meta', 'name', (v) => v === 'viewport', 'content'),
    title: (d.title ?? '').trim().length > 0,
    metaDescription: tagWith('meta', 'name', (v) => v === 'description', 'content'),
    singleH1: h1s.length === 1,
    faviconLink: tagWith('link', 'rel', (v) => v.split(/\s+/).includes('icon') || v === 'apple-touch-icon', 'href'),
    structuredData: hasJsonLd || microdata,
    openGraph: tagWith('meta', 'property', (v) => v.startsWith('og:'), 'content'),
  };
}
