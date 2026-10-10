import { IMvpSeo, IMvpTheme, MVP_FONT_CHOICES, MVP_THEME_VARS, MvpThemeKey } from '@revamp/shared-types';
import { MvpThemeControlsSchema, contrastRatio } from '@revamp/validation';
import { escapeHtml } from '../templates/html.js';
import { getMvpStrings } from '../templates/mvp-locale.js';
import { bookingFormHtml, bookingScript } from '../templates/shared/booking.js';
import { monogramSvg, resolveTrackerUrls, svgDataUri, trackerScriptTag } from '../templates/shared/page.js';
import { seoHeadTags } from '../templates/shared/seo.js';
import { withHtmlDocument } from './html-document.js';
import { PLACEHOLDER_PATTERN } from './mvp-page-check.js';
import type { VerifiedContacts } from './mvp-source-brief.js';

// The published page from a model-written one (REV-136), on every publish: code fills every contact from verified
// data, puts the verified search tags in place of the model's, applies the operator's palette and fonts, and adds the
// booking form and the tracker. The input is a page that passed `checkMvpPage`; the same input gives the same page.

export interface MvpFinishContext {
  businessName: string;
  language?: string;
  services: string[];
  contacts: VerifiedContacts;
  seo: IMvpSeo;
  logoUrl?: string;
  /** The theme the page declared (`checkMvpPage`), under the operator's controls */
  theme: IMvpTheme;
  controls?: Partial<IMvpTheme>;
  publicApiUrl?: string;
  trackingToken?: string;
}

const ON_PRIMARY = '--rv-on-primary';

/** The booking form's styles, on the page's theme variables and scoped to its section */
export const MVP_BOOKING_CSS = `
#booking { padding: 64px 16px; background: var(--rv-color-surface); color: var(--rv-color-text); font-family: var(--rv-font-body); }
#booking .booking-wrapper { box-sizing: border-box; max-width: 680px; margin: 0 auto; padding: 40px 32px; border-radius: 16px; background: var(--rv-color-bg); border: 1px solid color-mix(in srgb, var(--rv-color-text) 14%, transparent); box-shadow: 0 12px 32px rgba(0,0,0,.08); }
#booking .section-tag { display: inline-block; text-transform: uppercase; letter-spacing: .08em; font-size: .8em; font-weight: 700; color: var(--rv-color-primary); margin-bottom: 8px; }
#booking .section-title { margin: 0 0 8px; font-family: var(--rv-font-heading); }
#booking .section-desc { margin: 0; opacity: .85; }
#booking .form-group { margin-bottom: 20px; }
#booking .form-label { display: block; font-weight: 600; font-size: .9em; margin-bottom: 6px; }
#booking .form-input, #booking .form-select, #booking .form-textarea { box-sizing: border-box; width: 100%; min-height: 48px; padding: 12px 14px; font: inherit; color: var(--rv-color-text); background: var(--rv-color-bg); border: 1px solid color-mix(in srgb, var(--rv-color-text) 30%, transparent); border-radius: 8px; }
#booking .form-textarea { min-height: 96px; resize: vertical; }
#booking .form-input:focus, #booking .form-select:focus, #booking .form-textarea:focus { outline: none; border-color: var(--rv-color-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rv-color-primary) 25%, transparent); }
#booking .form-checkbox-container { display: flex; align-items: flex-start; gap: 10px; margin: 20px 0; font-size: .85em; }
#booking .form-checkbox { width: 18px; height: 18px; margin-top: 3px; accent-color: var(--rv-color-primary); flex-shrink: 0; }
#booking .form-submit-btn { width: 100%; min-height: 52px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 700; background: var(--rv-color-primary); color: var(${ON_PRIMARY}); }
#booking .form-submit-btn:disabled { opacity: .6; cursor: not-allowed; }
#booking .form-success-message { display: none; text-align: center; padding: 32px 16px; }
#booking .success-icon-badge { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; color: var(--rv-color-primary); background: color-mix(in srgb, var(--rv-color-primary) 12%, transparent); margin-bottom: 16px; }
#booking .success-title { font-size: 1.4em; margin: 0 0 8px; }
#booking .btn-secondary { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 20px; font: inherit; cursor: pointer; background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 8px; }
@media (max-width: 600px) { #booking .booking-wrapper { padding: 28px 20px; } }
`;

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value.trim());

/** Near-black when it reads at least as well as white on the color (the booking form follows the same rule); white for a color not in hex */
function onColor(color: string): string {
  if (!isHex(color)) return '#ffffff';
  return contrastRatio('#111111', color) >= contrastRatio('#ffffff', color) ? '#111111' : '#ffffff';
}

function placeholderHref(name: string, contacts: VerifiedContacts): string {
  switch (name) {
    case 'phone':
      return `tel:${(contacts.phone ?? '').replace(/[^+\d]/g, '')}`;
    case 'email':
      return `mailto:${contacts.email ?? ''}`;
    case 'address':
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contacts.address ?? '')}`;
    default:
      return '#booking';
  }
}

const placeholderText = (name: string, contacts: VerifiedContacts) => contacts[name as keyof VerifiedContacts] ?? '';

/** The generic family of a listed font (REV-139); sans-serif for any other */
function genericFamily(font: string): string {
  for (const choice of MVP_FONT_CHOICES) {
    if (choice.heading === font) return choice.headingGeneric;
    if (choice.body === font) return choice.bodyGeneric;
  }
  return 'sans-serif';
}

/** A control value as CSS: colors as given (validated hex), fonts as a quoted family with its generic fallback */
const controlValue = (key: MvpThemeKey, value: string) => (key.startsWith('font') ? `"${value}",${genericFamily(value)}` : value);

/** The controls that are safe in CSS: each value must pass its field's rule, anything else is dropped (REV-139) */
function safeControls(controls: Partial<IMvpTheme> | undefined): Partial<IMvpTheme> {
  const shape = MvpThemeControlsSchema.shape;
  return Object.fromEntries(
    Object.entries(controls ?? {}).filter(([key, value]) => value && key in shape && shape[key as MvpThemeKey].safeParse(value).success),
  ) as Partial<IMvpTheme>;
}

export function finishMvpPage(page: string, ctx: MvpFinishContext): string {
  const t = getMvpStrings(ctx.language);
  const tracker = resolveTrackerUrls(ctx.publicApiUrl);
  const controls = safeControls(ctx.controls);
  const primary = controls.primary ?? ctx.theme.primary;

  const html = withHtmlDocument(page, (doc) => {
    // 1. Contacts: every placeholder from verified data; text is set as text, so it is escaped on output
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const text = child.textContent ?? '';
          if (text.includes('{{')) child.textContent = text.replace(PLACEHOLDER_PATTERN, (_m, name: string) => placeholderText(name, ctx.contacts));
        } else if (child.nodeType === 1 && !['STYLE', 'SCRIPT'].includes((child as Element).tagName)) walk(child);
      }
    };
    walk(doc.documentElement);
    for (const el of Array.from(doc.querySelectorAll('[href]'))) {
      const href = el.getAttribute('href') ?? '';
      const match = /^\{\{([a-z]+)\}\}$/.exec(href.trim());
      if (match) el.setAttribute('href', placeholderHref(match[1] ?? '', ctx.contacts));
    }

    // 2. Search tags and icon: the verified ones only; the charset and viewport the page needs, when it lacks them
    const head = doc.head;
    if (!head.querySelector('meta[charset]')) head.insertAdjacentHTML('afterbegin', '<meta charset="UTF-8">');
    const viewport = Array.from(head.querySelectorAll('meta')).some((el) => (el.getAttribute('name') ?? '').toLowerCase() === 'viewport');
    if (!viewport) head.insertAdjacentHTML('beforeend', '\n  <meta name="viewport" content="width=device-width, initial-scale=1">');
    for (const el of Array.from(head.querySelectorAll('meta, link'))) {
      const name = (el.getAttribute('name') ?? '').toLowerCase();
      const property = (el.getAttribute('property') ?? '').toLowerCase();
      const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      if (name === 'description' || name.startsWith('twitter:') || property.startsWith('og:') || rel.includes('canonical') || rel.includes('icon')) {
        el.remove();
      }
    }
    const favicon = ctx.logoUrl ?? svgDataUri(monogramSvg(ctx.businessName, isHex(primary) ? primary : '#333333'));
    head.insertAdjacentHTML('beforeend', `${seoHeadTags(ctx.seo, ctx.businessName)}\n  <link rel="icon" href="${escapeHtml(favicon)}">`);

    // 3. The booking form and its styles; the text color on the primary is set by contrast
    head.insertAdjacentHTML('beforeend', `\n  <style id="rv-booking">:root{${ON_PRIMARY}:${onColor(primary)}}${MVP_BOOKING_CSS}</style>`);
    const options = ctx.services.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    const booking = `<section id="booking" class="rv-booking">${bookingFormHtml({ t, businessName: ctx.businessName, heading: escapeHtml(t.bookNow), serviceOptionsHtml: options })}</section>`;
    const main = doc.querySelector('main');
    const footer = Array.from(doc.body.children).find((el) => el.tagName === 'FOOTER');
    if (main) main.insertAdjacentHTML('beforeend', booking);
    else if (footer) footer.insertAdjacentHTML('beforebegin', booking);
    else doc.body.insertAdjacentHTML('beforeend', booking);

    // 4. The operator's controls, last in <head> so they win over the model's own :root
    const keys = (Object.keys(MVP_THEME_VARS) as MvpThemeKey[]).filter((key) => controls[key]);
    if (keys.length) {
      const families = [...new Set([controls.fontHeading, controls.fontBody].filter((f): f is string => Boolean(f)))].sort();
      const fontLinks = families
        .map((family) => `\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;600;700&amp;display=swap">`)
        .join('');
      const vars = keys.map((key) => `${MVP_THEME_VARS[key]}:${controlValue(key, controls[key] ?? '')}`).join(';');
      head.insertAdjacentHTML('beforeend', `${fontLinks}\n  <style id="rv-controls">:root{${vars}}</style>`);
    }

    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  });

  // 5. Scripts: the booking form's, the dashboard's fact highlight and the tracker, added after the checks' parse so
  // nothing runs on the server
  const scripts = `${bookingScript({ t, tracker, trackingToken: ctx.trackingToken, themeVars: { primary: MVP_THEME_VARS.primary, onPrimary: ON_PRIMARY } })}\n${previewScript()}\n${trackerScriptTag(tracker, ctx.trackingToken)}\n`;
  const end = html.lastIndexOf('</body>');
  return end === -1 ? `${html}${scripts}` : `${html.slice(0, end)}${scripts}${html.slice(end)}`;
}

/**
 * Lets the dashboard show a flagged fact (REV-140): on `{ type: 'REVAMP_SHOW_TEXT', text }` the smallest element whose
 * text holds it, whitespace collapsed, is scrolled into view and outlined for 4 s. Plain string search, never a
 * RegExp; text it cannot find changes nothing. The page is shown in a sandboxed frame on another origin, so a message
 * is the only way in, and it reveals nothing.
 */
export function previewScript(): string {
  return `<script>
    (function() {
      var norm = function(value) { return String(value).replace(/\\s+/g, ' ').trim(); };
      window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data || data.type !== 'REVAMP_SHOW_TEXT' || typeof data.text !== 'string') return;
        var needle = norm(data.text);
        if (needle.length < 2 || !document.body) return;
        var match = null;
        var all = document.body.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el.closest('script, style')) continue;
          if (norm(el.textContent || '').indexOf(needle) !== -1) match = el;
        }
        if (!match) return;
        match.setAttribute('data-revamp-shown', '');
        match.style.outline = '3px solid var(${MVP_THEME_VARS.accent}, #f59e0b)';
        match.style.outlineOffset = '4px';
        match.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var shown = match;
        setTimeout(function() {
          shown.removeAttribute('data-revamp-shown');
          shown.style.outline = '';
          shown.style.outlineOffset = '';
        }, 4000);
      });
    })();
  </script>`;
}
