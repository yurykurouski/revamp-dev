import { IBentoTemplateData } from '@revamp/shared-types';
import { getLucideIconSvg } from './icons.js';
import { getMvpStrings } from './mvp-locale.js';

/**
 * Converts Hex color string (#RRGGBB or #RGB) to "R, G, B" triplet.
 */
function hexToRgb(hex: string): string {
  let cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(cleanHex, 16);
  if (isNaN(num)) {
    return '92, 91, 237'; // Default brand fallback
  }
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r}, ${g}, ${b}`;
}

/**
 * Serialises a value for an inline <script>, so text cannot close the script element.
 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Escape HTML special characters for strict security and valid markup.
 */
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Compiles the complete, self-contained Bento Landing Page HTML document.
 */
export function generateBentoHtml(data: IBentoTemplateData): string {
  const businessName = escapeHtml(data.businessName);
  const language = data.language || 'en';
  const t = getMvpStrings(language);
  const primaryColor = data.palette?.primary || '#5c5bed';
  const secondaryColor = data.palette?.secondary || '#b8c4fe';
  const accentColor = data.palette?.accent || '#5c5bed';
  const primaryRgb = hexToRgb(primaryColor);
  const accentRgb = hexToRgb(accentColor);

  // Contacts are rendered only when they were verified on the original site (Strict Grounding)
  const phone = data.contacts?.phone;
  const phoneClean = phone ? phone.replace(/[^+\d]/g, '') : '';
  const email = data.contacts?.email;
  const address = data.contacts?.address;
  const workingHours = data.contacts?.workingHours;
  const mapUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${data.businessName} ${address}`)}`
    : '';

  const heroBadge = escapeHtml(data.hero.badge);
  const heroHeadline = escapeHtml(data.hero.headline);
  const heroSubheadline = escapeHtml(data.hero.subheadline);
  const primaryCtaText = escapeHtml(data.hero.primaryCtaText || t.sendRequest);
  const secondaryCtaText = escapeHtml(data.hero.secondaryCtaText || (phone ? t.callUs : t.contactUs));
  const secondaryCtaHref = phone ? `tel:${phoneClean}` : email ? `mailto:${escapeHtml(email)}` : '#booking';

  const services = data.services || [];
  const trustSignals = data.trustSignals || [];
  const reviews = data.reviews || [];
  const gallery = (data.gallery || []).filter((src) => src !== data.heroImageUrl).slice(0, 6);
  const socialLinks = data.socialLinks || [];
  const servicesHeading = escapeHtml(data.servicesHeading || t.servicesHeading(data.businessName));
  const footerTagline = escapeHtml(data.footerTagline || data.hero.subheadline);

  // Logo or Monogram rendering
  let logoHtml = '';
  if (data.logoUrl) {
    logoHtml = `<img src="${escapeHtml(data.logoUrl)}" alt="${businessName}" class="brand-logo-img" />`;
  } else if (data.monogramSvg) {
    logoHtml = `<div class="brand-logo-monogram">${data.monogramSvg}</div>`;
  } else {
    // Generate inline SVG monogram fallback
    const initials = data.businessName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'R';
    logoHtml = `
      <div class="brand-logo-fallback">
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <rect width="44" height="44" rx="10" fill="${primaryColor}" />
          <text x="22" y="28" fill="#ffffff" font-family="system-ui, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${escapeHtml(initials)}</text>
        </svg>
      </div>`;
  }

  // Render Bento Cards
  const bentoCardsHtml = services
    .map((service, index) => {
      const isLarge = index === 0 || service.highlight;
      const cardClass = isLarge ? 'bento-card bento-card-large' : 'bento-card';
      const iconSvg = getLucideIconSvg(service.lucideIconName, { size: 28, className: 'bento-icon' });
      const badgeHtml = service.badge
        ? `<span class="bento-badge">${escapeHtml(service.badge)}</span>`
        : '';

      return `
        <div class="${cardClass}">
          <div class="bento-card-top">
            <div class="bento-icon-wrapper">
              ${iconSvg}
            </div>
            ${badgeHtml}
          </div>
          <h3 class="bento-card-title">${escapeHtml(service.title)}</h3>
          <p class="bento-card-desc">${escapeHtml(service.description)}</p>
          <a href="#booking" class="bento-card-link">
            <span>${escapeHtml(t.chooseService)}</span>
            ${getLucideIconSvg('arrow-right', { size: 16 })}
          </a>
        </div>
      `;
    })
    .join('\n');

  // Render Trust Signals
  const trustSignalsHtml = trustSignals
    .map(
      (ts) => `
      <div class="trust-badge-item">
        <div class="trust-badge-metric">${escapeHtml(ts.metric)}</div>
        <div class="trust-badge-label">${escapeHtml(ts.label)}</div>
      </div>
    `,
    )
    .join('\n');

  // Render Reviews
  const reviewsHtml = reviews
    .map((rev) => {
      const starRating = rev.rating
        ? Array(Math.min(5, Math.max(1, Math.round(rev.rating))))
            .fill(0)
            .map(() => `<span class="star-icon">★</span>`)
            .join('')
        : '';

      return `
        <div class="review-card">
          <div class="review-header">
            <div class="review-author-info">
              <div class="review-avatar">${escapeHtml(rev.author.charAt(0))}</div>
              <div>
                <div class="review-author-name">${escapeHtml(rev.author)}</div>
                <div class="review-source">${escapeHtml(!rev.source || rev.source === 'Website' ? t.reviewSourceWebsite : rev.source)} ${rev.date ? `• ${escapeHtml(rev.date)}` : ''}</div>
              </div>
            </div>
            <div class="review-stars">${starRating}</div>
          </div>
          <p class="review-text">«${escapeHtml(rev.comment)}»</p>
        </div>
      `;
    })
    .join('\n');

  const aboutHtml = data.about
    ? `
    <!-- MODULE 2b: ABOUT (rewritten from the original site's own copy) -->
    <section class="about-section" id="about">
      <div class="container about-grid">
        <div>
          <span class="section-tag">${escapeHtml(t.aboutTag)}</span>
          <h2 class="section-title">${escapeHtml(data.about.heading)}</h2>
          <p class="about-body">${escapeHtml(data.about.body)}</p>
        </div>
        ${gallery[0] ? `<img class="about-image" src="${escapeHtml(gallery[0])}" alt="${businessName}" loading="lazy" />` : ''}
      </div>
    </section>`
    : '';

  const galleryImages = data.about ? gallery.slice(1) : gallery;
  const galleryHtml =
    galleryImages.length >= 2
      ? `
    <!-- MODULE 3b: GALLERY (images from the original site) -->
    <section class="gallery-section" id="gallery">
      <div class="container">
        <div class="gallery-grid">
          ${galleryImages
            .map((src) => `<img class="gallery-image" src="${escapeHtml(src)}" alt="${businessName}" loading="lazy" />`)
            .join('\n')}
        </div>
      </div>
    </section>`
      : '';

  const socialHtml = socialLinks.length
    ? `<div class="footer-socials">${socialLinks
        .map(
          (link) =>
            `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="footer-social-link">${escapeHtml(link.platform.charAt(0).toUpperCase() + link.platform.slice(1))}</a>`,
        )
        .join('')}</div>`
    : '';

  // Service Options for Booking Select
  const serviceSelectOptions = services
    .map((s) => `<option value="${escapeHtml(s.title)}">${escapeHtml(s.title)}</option>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${businessName} — Official website & booking</title>
  <meta name="description" content="${heroHeadline}. ${heroSubheadline}">
  
  <style>
    /* -------------------------------------------------------------
       REVAMP BENTO DESIGN SYSTEM & MODERN RESET
       Tailwind-compatible utilities, fully self-contained (< 30 KB)
       ------------------------------------------------------------- */
    :root {
      --brand-primary: ${primaryColor};
      --brand-secondary: ${secondaryColor};
      --brand-accent: ${accentColor};
      --brand-primary-rgb: ${primaryRgb};
      --brand-accent-rgb: ${accentRgb};
      --font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --color-text-main: #0f172a;
      --color-text-muted: #475569;
      --color-bg-body: #f8fafc;
      --color-surface: #ffffff;
      --color-border: #e2e8f0;
      --radius-xl: 1.25rem;
      --radius-lg: 0.875rem;
      --radius-md: 0.5rem;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 12px -2px rgba(15, 23, 42, 0.08);
      --shadow-lg: 0 12px 28px -4px rgba(15, 23, 42, 0.12);
      --shadow-brand: 0 10px 25px -3px rgba(var(--brand-primary-rgb), 0.25);
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      scroll-behavior: smooth;
      font-size: 16px;
      -webkit-text-size-adjust: 100%;
    }

    body {
      font-family: var(--font-family);
      background-color: var(--color-bg-body);
      color: var(--color-text-main);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    img, svg {
      display: block;
      max-width: 100%;
    }

    .container {
      width: 100%;
      max-width: 1240px;
      margin-inline: auto;
      padding-inline: 1.25rem;
    }

    /* -------------------------------------------------------------
       MODULE 1: STICKY GLASSMORPHIC HEADER
       ------------------------------------------------------------- */
    .site-header {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(226, 232, 240, 0.8);
      transition: all 0.2s ease;
    }

    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 4.5rem;
      gap: 1rem;
    }

    .brand-block {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      text-decoration: none;
    }

    .brand-logo-img {
      height: 2.75rem;
      width: auto;
      border-radius: var(--radius-md);
      object-fit: contain;
    }

    .brand-logo-monogram svg,
    .brand-logo-fallback svg {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: var(--radius-md);
    }

    .brand-name {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-text-main);
      letter-spacing: -0.02em;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.875rem;
    }

    .call-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1.125rem;
      min-height: 48px;
      border-radius: var(--radius-lg);
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--color-text-main);
      background: rgba(var(--brand-primary-rgb), 0.08);
      border: 1px solid rgba(var(--brand-primary-rgb), 0.2);
      transition: all 0.2s ease;
    }

    .call-btn:hover {
      background: rgba(var(--brand-primary-rgb), 0.15);
      border-color: var(--brand-primary);
      transform: translateY(-1px);
    }

    .header-booking-btn {
      display: none;
      align-items: center;
      padding: 0.625rem 1.25rem;
      min-height: 48px;
      border-radius: var(--radius-lg);
      font-size: 0.9375rem;
      font-weight: 600;
      color: #ffffff;
      background: var(--brand-primary);
      box-shadow: var(--shadow-brand);
      transition: all 0.2s ease;
    }

    .header-booking-btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }

    @media (min-width: 640px) {
      .header-booking-btn {
        display: inline-flex;
      }
    }

    /* -------------------------------------------------------------
       MODULE 2: HERO SECTION
       ------------------------------------------------------------- */
    .hero-section {
      padding-block: 3.5rem 2.5rem;
      position: relative;
      overflow: hidden;
    }

    .hero-bg-glow {
      position: absolute;
      top: -100px;
      left: 50%;
      transform: translateX(-50%);
      width: 700px;
      height: 400px;
      background: radial-gradient(circle, rgba(var(--brand-primary-rgb), 0.12) 0%, rgba(255, 255, 255, 0) 70%);
      z-index: 0;
      pointer-events: none;
    }

    .hero-content {
      position: relative;
      z-index: 1;
      max-width: 860px;
      margin-inline: auto;
      text-align: center;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.375rem 1rem;
      background: rgba(var(--brand-primary-rgb), 0.1);
      color: var(--brand-primary);
      border: 1px solid rgba(var(--brand-primary-rgb), 0.25);
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
    }

    .hero-headline {
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
      color: var(--color-text-main);
      margin-bottom: 1.25rem;
    }

    .hero-subheadline {
      font-size: clamp(1.0625rem, 2vw, 1.25rem);
      color: var(--color-text-muted);
      max-width: 680px;
      margin-inline: auto;
      margin-bottom: 2.25rem;
      line-height: 1.6;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      margin-bottom: 3.5rem;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.625rem;
      min-height: 52px;
      padding: 0.875rem 1.75rem;
      border-radius: var(--radius-lg);
      font-size: 1rem;
      font-weight: 600;
      color: #ffffff;
      background: var(--brand-primary);
      box-shadow: var(--shadow-brand);
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
    }

    .btn-primary:hover {
      filter: brightness(1.1);
      transform: translateY(-2px);
      box-shadow: 0 14px 30px -4px rgba(var(--brand-primary-rgb), 0.35);
    }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.625rem;
      min-height: 52px;
      padding: 0.875rem 1.75rem;
      border-radius: var(--radius-lg);
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text-main);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-secondary:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      transform: translateY(-2px);
    }

    /* Trust Signals Bar */
    .trust-signals-bar {
      display: grid;
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 1.25rem;
      max-width: 960px;
      margin-inline: auto;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.8);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-md);
    }

    @media (min-width: 640px) {
      .trust-signals-bar {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    .trust-badge-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding-inline: 0.75rem;
    }

    .trust-badge-metric {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--brand-primary);
      margin-bottom: 0.25rem;
    }

    .trust-badge-label {
      font-size: 0.875rem;
      color: var(--color-text-muted);
      line-height: 1.4;
    }

    /* -------------------------------------------------------------
       MODULE 3: BENTO SERVICES GRID
       ------------------------------------------------------------- */
    .bento-section {
      padding-block: 4rem 3rem;
    }

    .section-header {
      text-align: center;
      max-width: 640px;
      margin-inline: auto;
      margin-bottom: 3rem;
    }

    .section-tag {
      display: inline-block;
      font-size: 0.8125rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--brand-primary);
      margin-bottom: 0.5rem;
    }

    .section-title {
      font-size: clamp(1.75rem, 3.5vw, 2.5rem);
      font-weight: 800;
      letter-spacing: -0.025em;
      color: var(--color-text-main);
      margin-bottom: 0.75rem;
    }

    .section-desc {
      font-size: 1.0625rem;
      color: var(--color-text-muted);
    }

    .bento-grid {
      display: grid;
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 1.5rem;
    }

    @media (min-width: 640px) {
      .bento-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1024px) {
      .bento-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    .bento-card {
      position: relative;
      display: flex;
      flex-direction: column;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      padding: 2rem;
      box-shadow: var(--shadow-sm);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .bento-card:hover {
      transform: translateY(-4px);
      border-color: rgba(var(--brand-primary-rgb), 0.5);
      box-shadow: var(--shadow-lg), 0 0 0 1px rgba(var(--brand-primary-rgb), 0.2);
    }

    .bento-card-large {
      background: linear-gradient(145deg, #ffffff 0%, rgba(var(--brand-primary-rgb), 0.04) 100%);
      border-color: rgba(var(--brand-primary-rgb), 0.3);
    }

    @media (min-width: 1024px) {
      .bento-card-large {
        grid-column: span 2;
      }
    }

    .bento-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .bento-icon-wrapper {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: var(--radius-lg);
      background: rgba(var(--brand-primary-rgb), 0.1);
      color: var(--brand-primary);
      transition: transform 0.2s ease;
    }

    .bento-card:hover .bento-icon-wrapper {
      transform: scale(1.08);
      background: var(--brand-primary);
      color: #ffffff;
    }

    .bento-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: rgba(var(--brand-accent-rgb), 0.12);
      color: var(--brand-accent);
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .bento-card-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-text-main);
      margin-bottom: 0.625rem;
      line-height: 1.35;
    }

    .bento-card-desc {
      font-size: 0.9375rem;
      color: var(--color-text-muted);
      line-height: 1.55;
      margin-bottom: 1.5rem;
      flex-grow: 1;
    }

    .bento-card-link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--brand-primary);
      transition: gap 0.2s ease;
    }

    .bento-card-link:hover {
      gap: 0.625rem;
    }

    /* -------------------------------------------------------------
       MODULE 4: SOCIAL PROOF & REVIEWS
       ------------------------------------------------------------- */
    .reviews-section {
      padding-block: 4rem 3rem;
      background: linear-gradient(180deg, var(--color-bg-body) 0%, #f1f5f9 100%);
    }

    .reviews-grid {
      display: grid;
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 1.5rem;
    }

    @media (min-width: 768px) {
      .reviews-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    .review-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      padding: 1.75rem;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .review-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .review-author-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .review-avatar {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background: rgba(var(--brand-primary-rgb), 0.12);
      color: var(--brand-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1rem;
    }

    .review-author-name {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--color-text-main);
    }

    .review-source {
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }

    .review-stars {
      color: #f59e0b;
      font-size: 1.125rem;
      letter-spacing: 0.1em;
      white-space: nowrap;
    }

    .review-text {
      font-size: 0.9375rem;
      color: var(--color-text-muted);
      line-height: 1.55;
      font-style: italic;
    }

    /* -------------------------------------------------------------
       MODULE 5: INTERACTIVE BOOKING FORM
       ------------------------------------------------------------- */
    .booking-section {
      padding-block: 4rem;
    }

    .booking-wrapper {
      max-width: 680px;
      margin-inline: auto;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 1.5rem;
      padding: 2.5rem 2rem;
      box-shadow: var(--shadow-lg);
      position: relative;
    }

    .form-group {
      margin-bottom: 1.25rem;
    }

    .form-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-main);
      margin-bottom: 0.5rem;
    }

    .form-input, .form-select, .form-textarea {
      width: 100%;
      min-height: 48px;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      font-family: inherit;
      color: var(--color-text-main);
      background-color: #f8fafc;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      outline: none;
      transition: all 0.2s ease;
    }

    .form-textarea {
      min-height: 90px;
      resize: vertical;
    }

    .form-input:focus, .form-select:focus, .form-textarea:focus {
      background-color: #ffffff;
      border-color: var(--brand-primary);
      box-shadow: 0 0 0 3px rgba(var(--brand-primary-rgb), 0.15);
    }

    .form-checkbox-container {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      margin-block: 1.25rem;
    }

    .form-checkbox {
      width: 1.125rem;
      height: 1.125rem;
      margin-top: 0.2rem;
      accent-color: var(--brand-primary);
      cursor: pointer;
    }

    .checkbox-label {
      font-size: 0.8125rem;
      color: var(--color-text-muted);
      line-height: 1.4;
      cursor: pointer;
    }

    .form-submit-btn {
      width: 100%;
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.625rem;
      background: var(--brand-primary);
      color: #ffffff;
      border: none;
      border-radius: var(--radius-lg);
      font-size: 1.0625rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: var(--shadow-brand);
      transition: all 0.2s ease;
    }

    .form-submit-btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }

    .form-submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    /* Success State */
    .form-success-message {
      display: none;
      text-align: center;
      padding: 2.5rem 1.5rem;
    }

    .success-icon-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 4rem;
      height: 4rem;
      border-radius: 50%;
      background: rgba(34, 197, 94, 0.12);
      color: #16a34a;
      margin-bottom: 1.25rem;
    }

    .success-title {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--color-text-main);
      margin-bottom: 0.5rem;
    }

    .success-desc {
      font-size: 1rem;
      color: var(--color-text-muted);
      margin-bottom: 1.5rem;
    }

    /* -------------------------------------------------------------
       MODULE 6: FOOTER & MAP INFO
       ------------------------------------------------------------- */
    .site-footer {
      background: #0f172a;
      color: #94a3b8;
      padding-block: 4rem 2rem;
      border-top: 1px solid #1e293b;
    }

    .footer-grid {
      display: grid;
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 2.5rem;
      margin-bottom: 3rem;
    }

    @media (min-width: 768px) {
      .footer-grid {
        grid-template-columns: 2fr 1fr 1fr;
      }
    }

    .footer-brand-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 0.75rem;
    }

    .footer-desc {
      font-size: 0.9375rem;
      line-height: 1.6;
      margin-bottom: 1.25rem;
      max-width: 360px;
    }

    .footer-col-title {
      font-size: 0.9375rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #ffffff;
      margin-bottom: 1.25rem;
    }

    .footer-contact-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }

    .footer-contact-item {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      font-size: 0.9375rem;
    }

    .footer-contact-item svg {
      color: var(--brand-primary);
      flex-shrink: 0;
      margin-top: 0.2rem;
    }

    .footer-bottom {
      padding-top: 2rem;
      border-top: 1px solid #1e293b;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      font-size: 0.875rem;
    }

    @media (min-width: 640px) {
      .footer-bottom {
        flex-direction: row;
      }
    }

    .revamp-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.06);
      color: #cbd5e1;
      font-size: 0.8125rem;
      transition: all 0.2s ease;
    }

    .revamp-badge:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }
    /* REV-23: sections built from the original site's own content */
    .hero-image {
      display: block;
      width: 100%;
      max-width: 960px;
      max-height: 440px;
      object-fit: cover;
      margin: 3rem auto 0;
      border-radius: 24px;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25);
    }
    .about-section { padding: 5rem 0; }
    .about-grid {
      display: grid;
      gap: 2.5rem;
      align-items: center;
    }
    @media (min-width: 900px) {
      .about-grid { grid-template-columns: 1.2fr 1fr; }
    }
    .about-body {
      font-size: 1.1rem;
      line-height: 1.75;
      color: var(--text-secondary, #475569);
      margin-top: 1rem;
    }
    .about-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: 24px;
    }
    .gallery-section { padding: 0 0 5rem; }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
    }
    .gallery-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: 18px;
    }
    .footer-socials {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 1rem 0;
    }
    .footer-social-link {
      padding: 0.35rem 0.8rem;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.4);
      font-size: 0.85rem;
      color: inherit;
      text-decoration: none;
    }
  </style>

  ${data.customHeadSnippet ? data.customHeadSnippet : ''}
</head>
<body>

  <!-- MODULE 1: HEADER -->
  <header class="site-header">
    <div class="container header-inner">
      <a href="#" class="brand-block">
        ${logoHtml}
        <span class="brand-name">${businessName}</span>
      </a>

      <div class="header-actions">
        ${
          phone
            ? `<a href="tel:${phoneClean}" class="call-btn" aria-label="${escapeHtml(t.callUs)}">
          ${getLucideIconSvg('phone', { size: 18 })}
          <span>${escapeHtml(phone)}</span>
        </a>`
            : ''
        }
        <a href="#booking" class="header-booking-btn">
          <span>${escapeHtml(t.bookNow)}</span>
        </a>
      </div>
    </div>
  </header>

  <main>
    <!-- MODULE 2: HERO SECTION -->
    <section class="hero-section">
      <div class="hero-bg-glow"></div>
      <div class="container hero-content">
        ${heroBadge ? `<div class="hero-badge">${heroBadge}</div>` : ''}

        <h1 class="hero-headline">
          ${heroHeadline}
        </h1>

        <p class="hero-subheadline">
          ${heroSubheadline}
        </p>

        <div class="hero-actions">
          <a href="#booking" class="btn-primary" data-revamp-cta="primary-booking">
            <span>${primaryCtaText}</span>
            ${getLucideIconSvg('arrow-right', { size: 18 })}
          </a>
          <a href="${secondaryCtaHref}" class="btn-secondary" data-revamp-cta="call">
            ${getLucideIconSvg(phone ? 'phone' : 'mail', { size: 18 })}
            <span>${secondaryCtaText}</span>
          </a>
        </div>

        ${trustSignals.length ? `<div class="trust-signals-bar">${trustSignalsHtml}</div>` : ''}

        ${data.heroImageUrl ? `<img class="hero-image" src="${escapeHtml(data.heroImageUrl)}" alt="${businessName}" />` : ''}
      </div>
    </section>
${aboutHtml}

    <!-- MODULE 3: BENTO SERVICES GRID -->
    ${services.length ? `<section class="bento-section" id="services">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${escapeHtml(t.servicesTag)}</span>
          <h2 class="section-title">${servicesHeading}</h2>
        </div>

        <div class="bento-grid">
          ${bentoCardsHtml}
        </div>
      </div>
    </section>` : ''}
${galleryHtml}
    <!-- MODULE 4: SOCIAL PROOF & REVIEWS (only real testimonials from the original site) -->
    ${reviews.length ? `<section class="reviews-section" id="reviews">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${escapeHtml(t.reviewsTag)}</span>
          <h2 class="section-title">${escapeHtml(t.reviewsHeading(data.businessName))}</h2>
        </div>

        <div class="reviews-grid">
          ${reviewsHtml}
        </div>
      </div>
    </section>` : ''}

    <!-- MODULE 5: INTERACTIVE BOOKING FORM -->
    <section class="booking-section" id="booking">
      <div class="container">
        <div class="booking-wrapper">
          <div class="section-header" style="margin-bottom: 2rem;">
            <span class="section-tag">${escapeHtml(t.getInTouchTag)}</span>
            <h2 class="section-title" style="font-size: 1.75rem;">${primaryCtaText}</h2>
            <p class="section-desc">
              ${escapeHtml(t.bookingDescription(data.businessName))}
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
                ${serviceSelectOptions}
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
        </div>
      </div>
    </section>
  </main>

  <!-- MODULE 6: FOOTER -->
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="footer-brand-title">${businessName}</div>
          <p class="footer-desc">${footerTagline}</p>
          ${socialHtml}
          <a href="#booking" class="revamp-badge">
            ${getLucideIconSvg('sparkles', { size: 14 })}
            <span>${escapeHtml(t.builtBy)}</span>
          </a>
        </div>

        <div>
          <div class="footer-col-title">${escapeHtml(t.contactsTitle)}</div>
          <ul class="footer-contact-list">
            ${phone ? `<li class="footer-contact-item">
              ${getLucideIconSvg('phone', { size: 18 })}
              <a href="tel:${phoneClean}">${escapeHtml(phone)}</a>
            </li>` : ''}
            ${email ? `<li class="footer-contact-item">
              ${getLucideIconSvg('mail', { size: 18 })}
              <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
            </li>` : ''}
            ${address ? `<li class="footer-contact-item">
              ${getLucideIconSvg('map-pin', { size: 18 })}
              <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(address)}</a>
            </li>` : ''}
            ${!phone && !email && !address ? `<li class="footer-contact-item"><a href="#booking">${escapeHtml(t.sendUsRequest)}</a></li>` : ''}
          </ul>
        </div>

        ${workingHours ? `<div>
          <div class="footer-col-title">${escapeHtml(t.openingHoursTitle)}</div>
          <ul class="footer-contact-list">
            <li class="footer-contact-item">
              ${getLucideIconSvg('clock', { size: 18 })}
              <span>${escapeHtml(workingHours)}</span>
            </li>
          </ul>
        </div>` : ''}
      </div>

      <div class="footer-bottom">
        <div>© ${new Date().getFullYear()} ${businessName}. ${escapeHtml(t.rightsReserved)}</div>
        <div>${escapeHtml(t.redesignConcept)}</div>
      </div>
    </div>
  </footer>

  <!-- CLIENT-SIDE INTERACTION SCRIPT (Zero dependencies, < 2 KB) -->
  <script>
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
            data.trackingToken
              ? `
          try {
            if (navigator.sendBeacon) {
              navigator.sendBeacon('/api/v1/track/mvp-event', new Blob([JSON.stringify({
                token: '${data.trackingToken}',
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
          document.documentElement.style.setProperty('--brand-primary', palette.primary);
          const hex = palette.primary.replace('#', '');
          if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            document.documentElement.style.setProperty('--brand-primary-rgb', r + ', ' + g + ', ' + b);
          }
        }
        if (palette.secondary) {
          document.documentElement.style.setProperty('--brand-secondary', palette.secondary);
        }
        if (palette.accent) {
          document.documentElement.style.setProperty('--brand-accent', palette.accent);
        }
      });
    })();
  </script>
  <script src="/api/v1/track/revamp-tracker.js" data-token="${data.trackingToken || ''}" async></script>
</body>
</html>`;
}
