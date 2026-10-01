import { getLucideIconSvg } from '../icons.js';
import { escapeHtml } from '../html.js';
import type { MvpStrings } from '../mvp-locale.js';
import { resolveTrackerUrls, scriptJson } from './page.js';

/**
 * The booking form and its confirmation state, shared by every MVP renderer (REV-110).
 * `heading` is inserted as-is: the caller must escape it.
 */
export function bookingFormHtml(opts: { t: MvpStrings; businessName: string; heading: string; serviceOptionsHtml: string }): string {
  const { t } = opts;
  return `<div class="booking-wrapper">
          <div class="section-header" style="margin-bottom: 2rem;">
            <span class="section-tag">${escapeHtml(t.getInTouchTag)}</span>
            <h2 class="section-title" style="font-size: 1.75rem;">${opts.heading}</h2>
            <p class="section-desc">
              ${escapeHtml(t.bookingDescription(opts.businessName))}
            </p>
          </div>

          <form id="lead-booking-form" class="booking-form" novalidate>
            <div class="form-group">
              <label for="lead-name" class="form-label">${escapeHtml(t.nameLabel)}</label>
              <input 
                type="text" 
                id="lead-name" 
                name="name" 
                class="form-input" 
                placeholder="${escapeHtml(t.namePlaceholder)}" 
                required 
                autocomplete="name"
              />
            </div>

            <div class="form-group">
              <label for="lead-phone" class="form-label">${escapeHtml(t.phoneLabel)}</label>
              <input 
                type="tel" 
                id="lead-phone" 
                name="phone" 
                class="form-input" 
                placeholder="${escapeHtml(t.phonePlaceholder)}" 
                required 
                autocomplete="tel"
              />
            </div>

            <div class="form-group">
              <label for="lead-service" class="form-label">${escapeHtml(t.serviceLabel)}</label>
              <select id="lead-service" name="service" class="form-select">
                <option value="${escapeHtml(t.generalConsultation)}">${escapeHtml(t.generalConsultation)}</option>
                ${opts.serviceOptionsHtml}
              </select>
            </div>

            <div class="form-group">
              <label for="lead-notes" class="form-label">${escapeHtml(t.notesLabel)}</label>
              <textarea 
                id="lead-notes" 
                name="notes" 
                class="form-textarea" 
                placeholder="${escapeHtml(t.notesPlaceholder)}"
              ></textarea>
            </div>

            <div class="form-checkbox-container">
              <input type="checkbox" id="policy-consent" class="form-checkbox" checked required />
              <label for="policy-consent" class="checkbox-label">
                ${escapeHtml(t.consent)}
              </label>
            </div>

            <button type="submit" id="booking-submit-btn" class="form-submit-btn">
              <span>${escapeHtml(t.bookNow)}</span>
              ${getLucideIconSvg('send', { size: 18 })}
            </button>
          </form>

          <!-- Confirmation State -->
          <div id="booking-success-message" class="form-success-message" aria-live="polite">
            <div class="success-icon-badge">
              ${getLucideIconSvg('check-circle', { size: 36 })}
            </div>
            <h3 class="success-title">${escapeHtml(t.successTitle)}</h3>
            <p class="success-desc" id="success-client-info">
              ${escapeHtml(t.successDescription)}
            </p>
            <button type="button" id="reset-form-btn" class="btn-secondary" style="margin-inline: auto;">
              ${escapeHtml(t.sendAnother)}
            </button>
          </div>
        </div>`;
}

/**
 * The script that drives the booking form, reports the booking intent and applies live palette changes (REV-16).
 * `themeVars` names the CSS custom properties the page's palette lives in.
 */
export function bookingScript(opts: {
  t: MvpStrings;
  tracker: ReturnType<typeof resolveTrackerUrls>;
  trackingToken?: string;
  /** `onPrimary`: the text color on the primary, set to near-black or white by contrast (the rebuild's `onColor`) */
  themeVars: { primary: string; primaryRgb?: string; onPrimary?: string; secondary?: string; accent?: string };
}): string {
  const { t, tracker, trackingToken, themeVars } = opts;
  // Only the properties the page has are set; each optional block starts with its own newline
  const rgbBlock = themeVars.primaryRgb
    ? `
          const hex = palette.primary.replace('#', '');
          if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            document.documentElement.style.setProperty('${themeVars.primaryRgb}', r + ', ' + g + ', ' + b);
          }`
    : '';
  // Same rule as onColor (rebuild-tuning.ts): #111111 when it reads at least as well as white on the primary
  const onPrimaryBlock = themeVars.onPrimary
    ? `
          const onHex = palette.primary.replace('#', '');
          if (/^[0-9a-fA-F]{6}$/.test(onHex)) {
            const lin = function(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
            const lum = function(h) { return 0.2126 * lin(parseInt(h.substring(0, 2), 16)) + 0.7152 * lin(parseInt(h.substring(2, 4), 16)) + 0.0722 * lin(parseInt(h.substring(4, 6), 16)); };
            const bg = lum(onHex);
            const dark = (Math.max(bg, lum('111111')) + 0.05) / (Math.min(bg, lum('111111')) + 0.05);
            const light = (Math.max(bg, 1) + 0.05) / (Math.min(bg, 1) + 0.05);
            document.documentElement.style.setProperty('${themeVars.onPrimary}', dark >= light ? '#111111' : '#ffffff');
          }`
    : '';
  const secondaryBlock = themeVars.secondary
    ? `
        if (palette.secondary) {
          document.documentElement.style.setProperty('${themeVars.secondary}', palette.secondary);
        }`
    : '';
  const accentBlock = themeVars.accent
    ? `
        if (palette.accent) {
          document.documentElement.style.setProperty('${themeVars.accent}', palette.accent);
        }`
    : '';
  return `<script>
    (function() {
      const form = document.getElementById('lead-booking-form');
      const successBlock = document.getElementById('booking-success-message');
      const submitBtn = document.getElementById('booking-submit-btn');
      const resetBtn = document.getElementById('reset-form-btn');
      const clientInfo = document.getElementById('success-client-info');
      const i18n = ${scriptJson({ bookNow: t.bookNow, sending: t.sending, successDetail: t.successDetail, fallbackService: t.generalConsultation })};

      if (!form || !successBlock) return;

      form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const nameInput = document.getElementById('lead-name');
        const phoneInput = document.getElementById('lead-phone');
        const serviceSelect = document.getElementById('lead-service');

        if (!nameInput || !phoneInput) return;

        const nameVal = nameInput.value.trim();
        const phoneVal = phoneInput.value.trim();

        if (!nameVal) {
          nameInput.focus();
          return;
        }

        if (!phoneVal || phoneVal.length < 6) {
          phoneInput.focus();
          return;
        }

        // Simulate instant submission with responsive feedback
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span></span>';
        submitBtn.firstChild.textContent = i18n.sending;

        setTimeout(function() {
          form.style.display = 'none';
          successBlock.style.display = 'block';

          if (clientInfo) {
            clientInfo.textContent = i18n.successDetail
              .replace('{name}', nameVal)
              .replace('{service}', serviceSelect ? serviceSelect.value : i18n.fallbackService)
              .replace('{phone}', phoneVal);
          }

          // Dispatch telemetry Beacon if tracking token is provided
          ${
            trackingToken && tracker
              ? `
          try {
            if (navigator.sendBeacon) {
              navigator.sendBeacon(${scriptJson(tracker.eventUrl)}, new Blob([JSON.stringify({
                token: ${scriptJson(trackingToken)},
                eventType: 'booking_intent',
                metadata: {
                  name: nameVal,
                  phone: phoneVal,
                  service: serviceSelect ? serviceSelect.value : '',
                  timestamp: new Date().toISOString()
                }
              })], { type: 'application/json' }));
            }
          } catch (err) {}
          `
              : ''
          }
        }, 300);
      });

      if (resetBtn) {
        resetBtn.addEventListener('click', function() {
          form.reset();
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span></span>';
          submitBtn.firstChild.textContent = i18n.bookNow;
          successBlock.style.display = 'none';
          form.style.display = 'block';
        });
      }

      // Real-time Theme Palette Live Customization via postMessage (REV-16 HITL Gate)
      window.addEventListener('message', function(event) {
        if (!event.data || event.data.type !== 'REVAMP_UPDATE_THEME' || !event.data.palette) return;
        const palette = event.data.palette;
        if (palette.primary) {
          document.documentElement.style.setProperty('${themeVars.primary}', palette.primary);${rgbBlock}${onPrimaryBlock}
        }${secondaryBlock}${accentBlock}
      });
    })();
  </script>`;
}
