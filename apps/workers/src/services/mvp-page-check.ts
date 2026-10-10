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
import { allowedAttribute, allowedElement, isSvgElement, TEXT_ATTRIBUTES, urlScheme } from './mvp-page-allowlist.js';

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

const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
/** A phone-like run: digits with spaces, dots, dashes or brackets between, at least 9 digits (dates and prices stay below) */
const PHONE = /(?:\+|\b)\d[\d\s().-]{6,}\d/g;
/** Registry and bank numbers a business prints in its footer; a long digit run right after one of these is not a phone */
const REGISTRY_NUMBER = /(?:\b(?:NIP|REGON|KRS|PESEL|IBAN|BIC|SWIFT|VAT|EIN|konto|rachunek|account|bank|PVM|УНП|ИНН|ОГРН|КПП|БИК|ОКПО)\b[^\d]{0,15}|\b[A-Z]{2}\d{2}\s?)$/iu;
/** Whether a text holds an email address or a phone number (a registry or bank number is not one) */
export function contactsIn(value: string): { email: boolean; phone: boolean } {
  const text = value.replace(PLACEHOLDER_PATTERN, ' ');
  const phone = Array.from(text.matchAll(PHONE)).some(
    (m) => (m[0].match(/\d/g) ?? []).length >= 9 && !REGISTRY_NUMBER.test(text.slice(Math.max(0, (m.index ?? 0) - 30), m.index)),
  );
  return { email: EMAIL.test(text), phone };
}

/** CSS string literals: text that `content` can put on the page */
const CSS_STRING = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
const MAX_MESSAGES_PER_CODE = 5;

const textNodes = (doc: Document): Text[] => {
  const nodes: Text[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) nodes.push(child as Text);
      else if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() !== 'style') walk(child);
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

    // page:script: only plain content elements and attributes (mvp-page-allowlist.ts), no markup hidden in comments
    for (const el of all) {
      if (!allowedElement(el)) {
        report('page:script', `<${el.tagName.toLowerCase()}> is not allowed`);
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        if (!allowedAttribute(el, attr.name)) report('page:script', `the ${attr.name} attribute is not allowed on <${el.tagName.toLowerCase()}>`);
      }
    }
    const comments: string[] = [];
    const collectComments = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 8) comments.push(child.textContent ?? '');
        else if (child.nodeType === 1) collectComments(child);
      }
    };
    collectComments(doc);
    if (comments.some((c) => /[<>]/.test(c))) report('page:script', 'comments may not contain "<" or ">"');

    // Links: same page, relative or http(s); contacts only through placeholders
    for (const el of Array.from(doc.querySelectorAll('a[href]'))) {
      const href = el.getAttribute('href') ?? '';
      const scheme = urlScheme(href);
      if (!scheme || scheme === 'http' || scheme === 'https') continue;
      if (['tel', 'mailto', 'sms'].includes(scheme)) {
        report('page:contact', `href="${href.trim().slice(0, 40)}" writes a contact out; use href="{{phone}}" or href="{{email}}"`);
      } else report('page:script', `a ${scheme}: link is not allowed; links are https, relative or #anchors`);
    }

    // page:external
    for (const el of Array.from(doc.querySelectorAll('link'))) {
      const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      const href = el.getAttribute('href') ?? '';
      const fonts = (rel.includes('stylesheet') || rel.includes('preconnect')) && FONT_ORIGINS.has(originOf(href));
      if (!fonts) report('page:external', `<link rel="${rel.join(' ')}" href="${href.slice(0, 80)}"> is not allowed; only Google Fonts may be linked`);
    }
    for (const el of Array.from(doc.querySelectorAll('source'))) {
      if (el.parentElement?.tagName !== 'PICTURE') report('page:external', '<source> is only allowed inside <picture>');
    }

    // page:image; inside SVG, references stay on the page (href="#id", url(#id))
    const checkImage = (url: string) => {
      if (!allowedImages.has(url)) report('page:image', `${url.slice(0, 80)} is not one of the site's images`);
    };
    for (const el of Array.from(doc.querySelectorAll('img, picture source'))) {
      const src = el.getAttribute('src');
      if (src !== null) checkImage(src.trim());
      const srcset = el.getAttribute('srcset');
      if (srcset) for (const entry of srcset.split(',')) checkImage(entry.trim().split(/\s+/)[0] ?? '');
    }
    for (const el of all.filter(isSvgElement)) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) report('page:external', `<${el.tagName.toLowerCase()} ${name}="${value.slice(0, 60)}"> must point to an element on the page`);
        for (const url of value.matchAll(/url\(([^)]*)\)/gi)) {
          if (!/^\s*['"]?#[\w-]+['"]?\s*$/.test(url[1] ?? '')) report('page:external', `${name}="${value.slice(0, 60)}" must point to an element on the page`);
        }
      }
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

    const cssStrings = [...styleBlocks, ...Array.from(doc.querySelectorAll('[style]')).map((el) => el.getAttribute('style') ?? '')].flatMap((css) =>
      Array.from(css.matchAll(CSS_STRING), (m) => m[1] ?? m[2] ?? ''),
    );

    // page:placeholder
    const strayBraces = (value: string) => {
      for (const m of value.matchAll(PLACEHOLDER_PATTERN)) {
        const at = m.index ?? 0;
        if (value[at - 1] === '{' || value[at + m[0].length] === '}') return true;
      }
      const rest = value.replace(PLACEHOLDER_PATTERN, ' ');
      return rest.includes('{{') || rest.includes('}}');
    };
    if ([...textNodes(doc).map((n) => n.textContent ?? ''), ...all.flatMap((el) => Array.from(el.attributes, (a) => a.value))].some(strayBraces)) {
      report('page:placeholder', 'a placeholder must be written whole, as {{name}}, with no other braces around it');
    }
    if (cssStrings.some((text) => text.includes('{{'))) report('page:placeholder', 'placeholders cannot go in CSS');
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

    // page:contact: the text, the attributes a visitor reads, CSS strings and links
    const checkContact = (value: string, where: string) => {
      const found = contactsIn(value);
      if (found.email) report('page:contact', `${where} has an email address; use {{email}}`);
      if (found.phone) report('page:contact', `${where} has a phone number; use {{phone}}`);
    };
    for (const node of textNodes(doc)) checkContact(node.textContent ?? '', 'the text');
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (TEXT_ATTRIBUTES.has(attr.name.toLowerCase())) checkContact(attr.value, `the ${attr.name} attribute`);
      }
    }
    for (const text of cssStrings) checkContact(text, 'the CSS');
    for (const el of Array.from(doc.querySelectorAll('a[href]'))) {
      if (!urlScheme(el.getAttribute('href') ?? '')) checkContact(el.getAttribute('href') ?? '', 'a link');
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
