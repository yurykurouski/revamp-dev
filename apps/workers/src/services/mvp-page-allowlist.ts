// What a model-written page may contain (REV-136): an allowlist, not a denylist. A browser and the server-side
// parser read some markup differently (`<noscript>`, `<template shadowrootmode>`, rawtext elements, foreign
// content), so anything outside a small set of plain content elements and attributes is rejected rather than
// understood. Names are compared in lowercase.

export const HTML_ELEMENTS = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'style',
  'header', 'footer', 'main', 'nav', 'section', 'article', 'aside', 'div', 'span', 'p', 'address',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br', 'wbr',
  'a', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'mark', 'sub', 'sup', 'abbr', 'time', 'q', 'cite', 'code', 'pre', 'del', 'ins',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'blockquote', 'img', 'picture', 'source',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary', 'button',
]);

/** Inline SVG for icons and shapes: no script, no foreign content, no filters, no animation, no images */
export const SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text', 'tspan',
  'defs', 'symbol', 'use', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'title', 'desc',
]);

const GLOBAL_ATTRIBUTES = new Set(['id', 'class', 'style', 'title', 'lang', 'dir', 'role', 'hidden', 'tabindex', 'translate']);

const HTML_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'hreflang']),
  img: new Set(['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding', 'fetchpriority']),
  source: new Set(['srcset', 'sizes', 'media', 'type', 'width', 'height']),
  meta: new Set(['charset', 'name', 'content', 'property']),
  link: new Set(['rel', 'href', 'crossorigin']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'reversed', 'type']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  details: new Set(['open']),
  button: new Set(['type']),
};

const SVG_ATTRIBUTES = new Set([
  'viewbox', 'xmlns', 'xmlns:xlink', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry',
  'fx', 'fy', 'd', 'points', 'transform', 'preserveaspectratio', 'focusable', 'href', 'xlink:href',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'mask', 'opacity', 'vector-effect',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'clippathunits', 'maskunits', 'maskcontentunits', 'patternunits', 'patterncontentunits', 'patterntransform',
  'font-size', 'font-family', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline',
]);

export const isSvgElement = (el: Element) => el.namespaceURI === 'http://www.w3.org/2000/svg';

/** Whether the element may appear on the page */
export function allowedElement(el: Element): boolean {
  const name = el.tagName.toLowerCase();
  return isSvgElement(el) ? SVG_ELEMENTS.has(name) : HTML_ELEMENTS.has(name) && el.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

/** Whether the attribute may appear on the element */
export function allowedAttribute(el: Element, attribute: string): boolean {
  const name = attribute.toLowerCase();
  if (name.startsWith('aria-') || name.startsWith('data-')) return true;
  if (isSvgElement(el)) return SVG_ATTRIBUTES.has(name) || name === 'class' || name === 'id' || name === 'style' || name === 'role';
  return GLOBAL_ATTRIBUTES.has(name) || HTML_ATTRIBUTES[el.tagName.toLowerCase()]?.has(name) === true;
}

/** Attributes whose text a visitor reads (or a screen reader speaks), checked for contacts like the page text */
export const TEXT_ATTRIBUTES = new Set(['alt', 'title', 'aria-label', 'aria-description', 'aria-roledescription', 'content', 'abbr']);

/**
 * A URL as a browser reads it before resolving the scheme: tabs and newlines are removed anywhere, and C0 controls
 * and spaces at either end; used only to read the scheme.
 */
export function urlScheme(value: string): string | undefined {
  const normalized = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  return /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
}
