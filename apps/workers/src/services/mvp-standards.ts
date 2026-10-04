import { Window } from 'happy-dom';
import { IMvpStandards, IStandardsChecks, STANDARDS_CHECKS, STANDARDS_POINTS } from '@revamp/shared-types';
import { MvpStandardsSchema } from '@revamp/validation';
import { readStandardsInDocument } from './standards.page.js';

/** Elements and attributes that load a resource into the page */
const RESOURCE_ATTRIBUTES: Array<[selector: string, attribute: string]> = [
  ['img[src]', 'src'],
  ['img[srcset]', 'srcset'],
  ['source[src]', 'src'],
  ['source[srcset]', 'srcset'],
  ['script[src]', 'src'],
  ['iframe[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['link[href]', 'href'],
];

/** The page loads nothing over plain http, so serving it over HTTPS shows no mixed-content warnings or broken images */
export function isHttpsReady(doc: Document): boolean {
  const insecure = (value: string) => /(^|[\s,])http:\/\//i.test(value);
  // The page's own tracker (`trackerScriptTag`) loads from the configured API; its scheme is deployment, like HTTPS itself
  const loads = (el: Element) =>
    el.tagName === 'LINK' ? /\b(stylesheet|icon|preload|apple-touch-icon)\b/i.test(el.getAttribute('rel') ?? '') : !(el.tagName === 'SCRIPT' && el.hasAttribute('data-api'));
  if (RESOURCE_ATTRIBUTES.some(([selector, attribute]) => Array.from(doc.querySelectorAll(selector)).some((el) => loads(el) && insecure(el.getAttribute(attribute) ?? '')))) {
    return false;
  }
  // Inline styles and style blocks: background photos
  const css = [...Array.from(doc.querySelectorAll('style')).map((el) => el.textContent ?? ''), ...Array.from(doc.querySelectorAll('[style]')).map((el) => el.getAttribute('style') ?? '')];
  return !css.some((text) => /url\(\s*['"]?http:\/\//i.test(text));
}

/**
 * The published MVP's standards checks (REV-118): the audit's own reader (`readStandardsInDocument`) run on the HTML
 * the deploy uploaded, parsed without running its scripts, so the original and the MVP are scored by the same checks.
 * Whether the MVP is served over HTTPS depends on where it is deployed, not on the page, so its `https` is
 * HTTPS-readiness: the page loads nothing over plain http (`isHttpsReady`). The MVP is a single static file, so its
 * favicon is the icon link alone.
 */
export function checkMvpStandards(html: string): IMvpStandards {
  const window = new Window({
    settings: {
      // Script evaluation is off by default; nothing on the page is loaded or run
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
    },
  });
  try {
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const { faviconLink, ...dom } = readStandardsInDocument(doc as unknown as Document);
    const checks = { https: isHttpsReady(doc as unknown as Document), ...dom, favicon: faviconLink };
    const score = STANDARDS_CHECKS.reduce((sum, check) => sum + (checks[check] ? STANDARDS_POINTS[check] : 0), 0);
    return MvpStandardsSchema.parse({ checks, score }) as IMvpStandards;
  } finally {
    void window.happyDOM.close();
  }
}

/**
 * The original's standards score to set beside the MVP's (REV-126): only when every check was read, so an audit made
 * before a check existed (REV-118) is never compared with the MVP's full score. Absent otherwise.
 */
export function comparableStandardsScore(checks: Partial<IStandardsChecks> | undefined): number | undefined {
  if (!checks || STANDARDS_CHECKS.some((check) => typeof checks[check] !== 'boolean')) return undefined;
  return STANDARDS_CHECKS.reduce((sum, check) => sum + (checks[check] ? STANDARDS_POINTS[check] : 0), 0);
}
