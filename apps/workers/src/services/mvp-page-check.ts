import {
  IMvpPageProblem,
  IMvpSourceBrief,
  IMvpTheme,
  MVP_PAGE_CHECKS,
  MVP_PAGE_MAX_BYTES,
  MVP_THEME_VARS,
  MvpPageCheck,
  MvpThemeKey,
} from '@revamp/shared-types';
import { withHtmlDocument } from './html-document.js';
import { checkPageCss, readMvpTheme } from './mvp-page-css.js';

// Whether a model-written page may be accepted (REV-136). The model designs the page freely; code makes sure it runs
// and loads nothing, shows only the site's own images, declares the theme variables, leaves every contact to a
// placeholder and has one h1 in the brief's language. Every problem is reported, so a retry can fix them all.

export interface MvpPageCheckResult {
  ok: boolean;
  problems: IMvpPageProblem[];
  /** The theme the page declared in `:root`; set when the page is accepted */
  theme?: IMvpTheme;
}

/** `{{name}}` as the model writes it; the name is checked separately, so `{{ Phone }}` is caught too */
export const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

const ACTIVE_ELEMENTS = 'script, iframe, frame, frameset, object, embed, applet, form, base, portal';
const MEDIA_ELEMENTS = 'video, audio, track';
const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
/** A phone-like run: digits with spaces, dashes or brackets between, at least 9 digits (dates and prices stay below) */
const PHONE = /(?:\+|\b)\d[\d\s()-]{6,}\d/g;
const MAX_MESSAGES_PER_CODE = 5;

const textNodes = (doc: Document): Text[] => {
  const nodes: Text[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) nodes.push(child as Text);
      else if (child.nodeType === 1 && !['STYLE', 'SCRIPT', 'TEMPLATE'].includes((child as Element).tagName)) walk(child);
    }
  };
  walk(doc.documentElement);
  return nodes;
};

const primaryTag = (lang?: string | null) => (lang ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';

export function checkMvpPage(html: string, brief: IMvpSourceBrief): MvpPageCheckResult {
  const found = new Map<MvpPageCheck, string[]>();
  const report = (code: MvpPageCheck, message: string) => {
    const list = found.get(code) ?? [];
    if (!list.includes(message)) list.push(message);
    found.set(code, list);
  };
  const result = (theme?: Partial<IMvpTheme>): MvpPageCheckResult => {
    const problems = MVP_PAGE_CHECKS.filter((code) => found.has(code)).map((code) => {
      const messages = found.get(code) ?? [];
      const more = messages.length > MAX_MESSAGES_PER_CODE ? `; and ${messages.length - MAX_MESSAGES_PER_CODE} more` : '';
      return { code, message: messages.slice(0, MAX_MESSAGES_PER_CODE).join('; ') + more };
    });
    return problems.length ? { ok: false, problems } : { ok: true, problems, theme: theme as IMvpTheme };
  };

  const trimmed = html.trim();
  const bytes = Buffer.byteLength(html, 'utf8');
  if (!/^<!doctype html/i.test(trimmed) || !/<\/html>$/i.test(trimmed)) {
    report('page:parse', 'the answer must be one HTML document, from <!DOCTYPE html> to </html>, with nothing around it');
    return result();
  }
  if (bytes > MVP_PAGE_MAX_BYTES) {
    report('page:parse', `the page is ${bytes} bytes; the limit is ${MVP_PAGE_MAX_BYTES}`);
    return result();
  }

  const allowedImages = new Set([...brief.images, ...(brief.brand.logoUrl ? [brief.brand.logoUrl] : [])]);
  const allowedPlaceholders = new Set<string>(brief.placeholders);

  return withHtmlDocument(html, (doc) => {
    const all = Array.from(doc.querySelectorAll('*'));

    // page:script
    for (const el of Array.from(doc.querySelectorAll(ACTIVE_ELEMENTS))) report('page:script', `<${el.tagName.toLowerCase()}> is not allowed`);
    for (const el of Array.from(doc.querySelectorAll('meta'))) {
      if ((el.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') report('page:script', '<meta http-equiv="refresh"> is not allowed');
    }
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) report('page:script', `the ${attr.name} attribute is not allowed`);
        if (/^(javascript|vbscript):/i.test(attr.value.trim())) report('page:script', `${attr.name}="${attr.value.trim().slice(0, 40)}" runs code`);
      }
    }

    // page:external
    for (const el of Array.from(doc.querySelectorAll('link'))) {
      const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      const href = el.getAttribute('href') ?? '';
      const fonts = (rel.includes('stylesheet') || rel.includes('preconnect')) && FONT_ORIGINS.has(originOf(href));
      if (!fonts) report('page:external', `<link rel="${rel.join(' ')}" href="${href.slice(0, 80)}"> is not allowed; only Google Fonts may be linked`);
    }
    for (const el of Array.from(doc.querySelectorAll(MEDIA_ELEMENTS))) report('page:external', `<${el.tagName.toLowerCase()}> is not allowed`);
    for (const el of Array.from(doc.querySelectorAll('source'))) {
      if (el.parentElement?.tagName !== 'PICTURE') report('page:external', '<source> is only allowed inside <picture>');
    }

    // page:image
    const checkImage = (url: string) => {
      if (!allowedImages.has(url)) report('page:image', `${url.slice(0, 80)} is not one of the site's images`);
    };
    for (const el of Array.from(doc.querySelectorAll('img, picture source'))) {
      const src = el.getAttribute('src');
      if (src !== null) checkImage(src.trim());
      const srcset = el.getAttribute('srcset');
      if (srcset) for (const entry of srcset.split(',')) checkImage(entry.trim().split(/\s+/)[0] ?? '');
    }
    for (const el of Array.from(doc.querySelectorAll('image, use'))) {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      if (href && !href.startsWith('#')) checkImage(href.trim());
    }

    // page:css and page:theme
    const styleBlocks = Array.from(doc.querySelectorAll('style')).map((el) => el.textContent ?? '');
    for (const css of styleBlocks) for (const problem of checkPageCss(css, allowedImages)) report('page:css', problem);
    for (const el of Array.from(doc.querySelectorAll('[style]'))) {
      for (const problem of checkPageCss(`x{${el.getAttribute('style') ?? ''}}`, allowedImages)) report('page:css', problem);
    }
    const theme = readMvpTheme(styleBlocks);
    const missing = (Object.keys(MVP_THEME_VARS) as MvpThemeKey[]).filter((key) => !theme[key]);
    if (missing.length) {
      report('page:theme', `:root must declare ${missing.map((key) => MVP_THEME_VARS[key]).join(', ')}`);
    }

    // page:placeholder
    const placeholderName = (raw: string) => {
      if (!/^[a-z]+$/.test(raw)) {
        report('page:placeholder', `{{${raw}}} is not a placeholder; write the name in lowercase with no spaces`);
        return undefined;
      }
      if (!allowedPlaceholders.has(raw)) {
        report('page:placeholder', `{{${raw}}} cannot be used on this page; the placeholders are ${[...allowedPlaceholders].map((n) => `{{${n}}}`).join(', ')}`);
        return undefined;
      }
      return raw;
    };
    for (const node of textNodes(doc)) {
      for (const match of (node.textContent ?? '').matchAll(PLACEHOLDER_PATTERN)) {
        if (placeholderName(match[1] ?? '') === 'booking') report('page:placeholder', '{{booking}} goes only in a link: href="{{booking}}"');
      }
    }
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        const matches = Array.from(attr.value.matchAll(PLACEHOLDER_PATTERN));
        if (!matches.length) continue;
        if (attr.name !== 'href') report('page:placeholder', `placeholders go only in text or in href, not in ${attr.name}`);
        else if (matches.length > 1 || attr.value.trim() !== matches[0]?.[0]) report('page:placeholder', 'an href with a placeholder must be the placeholder alone, e.g. href="{{phone}}"');
        else if (placeholderName(matches[0]?.[1] ?? '') === 'hours') report('page:placeholder', '{{hours}} cannot be a link');
      }
      if (el.getAttribute('id') === 'booking') report('page:placeholder', 'id="booking" is reserved for the booking form, which is added for you');
    }

    // page:contact
    const checkContact = (value: string, where: string) => {
      const text = value.replace(PLACEHOLDER_PATTERN, ' ');
      if (EMAIL.test(text)) report('page:contact', `${where} has an email address; use {{email}}`);
      const phone = Array.from(text.matchAll(PHONE)).some((m) => (m[0].match(/\d/g) ?? []).length >= 9);
      if (phone) report('page:contact', `${where} has a phone number; use {{phone}}`);
    };
    for (const node of textNodes(doc)) checkContact(node.textContent ?? '', 'the text');
    for (const el of Array.from(doc.querySelectorAll('[href]'))) {
      const href = (el.getAttribute('href') ?? '').trim();
      if (/^(tel|mailto|sms):/i.test(href)) report('page:contact', `href="${href.slice(0, 40)}" writes a contact out; use href="{{phone}}" or href="{{email}}"`);
      else checkContact(href, 'a link');
    }

    // page:h1
    const h1 = doc.querySelectorAll('h1').length;
    if (h1 !== 1) report('page:h1', `the page has ${h1} <h1> elements; it must have exactly one`);

    // page:lang
    const expected = primaryTag(brief.language) || 'en';
    const lang = doc.documentElement.getAttribute('lang');
    if (primaryTag(lang) !== expected) report('page:lang', `<html lang="${lang ?? ''}"> must name the site's language, "${expected}"`);

    return result(theme);
  });
}
