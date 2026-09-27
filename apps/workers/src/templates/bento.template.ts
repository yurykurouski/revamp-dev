import { IBentoTemplateData, MvpLayoutVariant } from '@revamp/shared-types';
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
 * Encodes an SVG document as a data URI, e.g. for an inline favicon.
 */
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

/**
 * Resolves the telemetry URLs from the public API URL (REV-52). MVPs are served from the
 * storage host, so relative /api/v1/... paths would hit S3/MinIO instead of the API.
 * The tracker appends /api/v1/track/mvp-event to data-api, so data-api is the API origin.
 */
export function resolveTrackerUrls(
  publicApiUrl: string | undefined,
): { scriptSrc: string; apiOrigin: string; eventUrl: string } | null {
  if (!publicApiUrl) return null;
  let apiOrigin: string;
  try {
    apiOrigin = new URL(publicApiUrl).origin;
  } catch {
    return null;
  }
  const apiBase = publicApiUrl.replace(/\/+$/, '');
  return {
    scriptSrc: `${apiBase}/track/revamp-tracker.js`,
    apiOrigin,
    eventUrl: `${apiBase}/track/mvp-event`,
  };
}

/**
 * Styles each layout adds on top of the shared design system (REV-54). Only the active layout's
 * block is inlined, so the bundle stays small. Bento needs nothing extra.
 */
const LAYOUT_CSS: Record<MvpLayoutVariant, string> = {
  bento: '',
  split: `
    /* LAYOUT: SPLIT (image-led) */
    .hero-split { padding-block: 3rem; }
    .hero-split-grid { display: grid; gap: 2.5rem; align-items: center; }
    @media (min-width: 900px) {
      .hero-split-grid { grid-template-columns: 1.05fr 1fr; }
      .hero-split-no-image .hero-split-grid { grid-template-columns: 1fr; max-width: 760px; }
    }
    .hero-split .hero-subheadline { margin-inline: 0; }
    .hero-split .hero-actions { justify-content: flex-start; margin-bottom: 2rem; }
    .hero-split .trust-signals-bar { margin-inline: 0; box-shadow: none; }
    .hero-split-image {
      width: 100%;
      aspect-ratio: 4 / 5;
      max-height: 560px;
      object-fit: cover;
      border-radius: 28px 28px 28px 4px;
      box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.35);
    }
    .layout-split .gallery-section { padding-top: 1rem; }
    .layout-split .gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 200px; }
    /* Odd counts: a full-width lead image keeps the 2-column mobile grid gap-free (REV-58) */
    .layout-split .gallery-count-3 .gallery-image:first-child,
    .layout-split .gallery-count-5 .gallery-image:first-child { grid-column: span 2; }
    @media (min-width: 768px) {
      .layout-split .gallery-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .layout-split .gallery-image:first-child { grid-column: span 2; grid-row: span 2; }
      /* Per-count spans keep the 4-column mosaic a full rectangle for 2-6 images (REV-58) */
      .layout-split .gallery-count-2 .gallery-image:last-child { grid-column: span 2; grid-row: span 2; }
      .layout-split .gallery-count-3 .gallery-image:not(:first-child) { grid-column: span 2; }
      .layout-split .gallery-count-4 .gallery-image:last-child { grid-column: span 2; }
      .layout-split .gallery-count-6 .gallery-image:nth-child(n+4) { grid-column: span 2; }
    }
    .layout-split .gallery-image { height: 100%; aspect-ratio: auto; border-radius: 14px; }
    .layout-split .section-header { text-align: left; margin-inline: 0; }
    .service-tiles { display: grid; gap: 1rem; grid-template-columns: repeat(1, minmax(0, 1fr)); }
    @media (min-width: 640px) { .service-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .service-tile {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-left: 4px solid var(--brand-primary);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
    }
    .service-tile-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
    .service-tile-icon { color: var(--brand-primary); flex-shrink: 0; }
    .service-tile-title { font-size: 1.125rem; font-weight: 700; line-height: 1.3; }
    .service-tile-desc { font-size: 0.9375rem; color: var(--color-text-muted); }
    @media (min-width: 900px) {
      .about-reverse .about-grid { grid-template-columns: 1fr 1.2fr; }
      .about-reverse .about-image { order: -1; }
    }`,
  editorial: `
    /* LAYOUT: EDITORIAL (typographic, text-led) */
    :root {
      --font-display: Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif;
      --color-bg-body: #faf8f4;
      --radius-xl: 0.375rem;
      --radius-lg: 0.25rem;
    }
    .layout-editorial .hero-headline,
    .layout-editorial .section-title,
    .layout-editorial .numbered-service-title,
    .layout-editorial .success-title { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em; }
    .layout-editorial .site-header { background: rgba(250, 248, 244, 0.92); }
    .hero-editorial { padding-block: 4.5rem 3rem; border-bottom: 1px solid var(--color-border); }
    .hero-editorial .hero-headline { font-size: clamp(2.25rem, 5.5vw, 4rem); line-height: 1.1; max-width: 16em; }
    .hero-editorial .hero-subheadline { margin-inline: 0; max-width: 40em; }
    .hero-editorial .hero-actions { justify-content: flex-start; margin-bottom: 2.5rem; }
    .hero-editorial .hero-badge { border-radius: 0; background: none; border: none; border-bottom: 2px solid var(--brand-primary); padding: 0 0 0.25rem; }
    .hero-editorial .trust-signals-bar {
      margin-inline: 0; padding: 1.25rem 0; background: none; backdrop-filter: none;
      border: none; border-top: 1px solid var(--color-border); border-radius: 0; box-shadow: none;
    }
    .hero-editorial .trust-badge-item { align-items: flex-start; text-align: left; padding-inline: 0; }
    .hero-editorial .hero-image { margin-inline: 0; max-width: none; border-radius: var(--radius-xl); box-shadow: none; }
    .layout-editorial .section-header { text-align: left; margin-inline: 0; }
    .layout-editorial .about-body { font-size: 1.2rem; }
    .layout-editorial .bento-card,
    .layout-editorial .review-card,
    .layout-editorial .booking-wrapper { box-shadow: none; }
    .numbered-services { list-style: none; border-top: 1px solid var(--color-border); }
    .numbered-service {
      display: grid; grid-template-columns: 3.5rem 1fr; gap: 1rem;
      padding-block: 1.5rem; border-bottom: 1px solid var(--color-border);
    }
    .numbered-service-index { font-family: var(--font-display); font-size: 1.5rem; color: var(--brand-primary); line-height: 1.2; }
    .numbered-service-title { font-size: 1.375rem; line-height: 1.3; margin-bottom: 0.375rem; }
    .numbered-service-desc { color: var(--color-text-muted); max-width: 44em; }
    .layout-editorial .reviews-section { background: none; }
    .layout-editorial .review-text { font-family: var(--font-display); font-size: 1.125rem; font-style: normal; color: var(--color-text-main); }`,
  compact: `
    /* LAYOUT: COMPACT (short brochure, contacts first) */
    .hero-compact {
      padding-block: 3rem;
      color: #ffffff;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(var(--brand-primary-rgb), 0.88) 100%), var(--brand-secondary);
    }
    .hero-compact-grid { display: grid; gap: 2rem; align-items: center; }
    @media (min-width: 900px) { .hero-compact-grid { grid-template-columns: 1.4fr 1fr; } }
    .hero-compact .hero-headline { color: #ffffff; font-size: clamp(1.875rem, 4vw, 2.75rem); }
    .hero-compact .hero-subheadline { color: rgba(255, 255, 255, 0.82); margin-inline: 0; margin-bottom: 1.75rem; }
    .hero-compact .hero-actions { justify-content: flex-start; margin-bottom: 0; }
    .hero-compact .hero-badge { color: #ffffff; background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.3); }
    .hero-compact .btn-secondary { background: rgba(255, 255, 255, 0.1); color: #ffffff; border-color: rgba(255, 255, 255, 0.35); }
    .hero-compact .trust-signals-bar { margin-top: 2rem; }
    .hero-compact .hero-image { max-width: none; max-height: 300px; margin-top: 2rem; border-radius: var(--radius-xl); }
    .quick-facts {
      list-style: none; display: flex; flex-direction: column; gap: 0.875rem;
      padding: 1.5rem; border-radius: var(--radius-xl);
      background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18);
    }
    .quick-fact { display: flex; align-items: flex-start; gap: 0.75rem; font-size: 1rem; overflow-wrap: anywhere; }
    .quick-fact svg { flex-shrink: 0; margin-top: 0.2rem; opacity: 0.85; }
    .layout-compact .bento-section,
    .layout-compact .reviews-section,
    .layout-compact .about-section { padding-block: 3rem; }
    .layout-compact .section-header { margin-bottom: 1.75rem; }
    .service-tiles { display: grid; gap: 0.875rem; grid-template-columns: repeat(1, minmax(0, 1fr)); }
    @media (min-width: 640px) { .service-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 1024px) { .service-tiles-compact { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .service-tile { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; }
    .service-tile-head { display: flex; flex-direction: column; align-items: flex-start; gap: 0.625rem; margin-bottom: 0.5rem; }
    .service-tile-icon {
      display: inline-flex; padding: 0.5rem; border-radius: var(--radius-md);
      color: var(--brand-primary); background: rgba(var(--brand-primary-rgb), 0.1);
    }
    .service-tile-title { font-size: 1.0625rem; font-weight: 700; line-height: 1.3; }
    .service-tile-desc { font-size: 0.875rem; color: var(--color-text-muted); }`,
};

/**
 * Compiles the complete, self-contained landing page HTML document in the requested layout
 * (the original Bento layout by default).
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
  const tracker = resolveTrackerUrls(data.publicApiUrl);
  // The layout only arranges the same grounded content differently (REV-54)
  const layout: MvpLayoutVariant = data.layout ?? 'bento';

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

  // Generated inline SVG monogram, used when the site has neither a logo nor a monogram
  const initials =
    data.businessName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'R';
  const fallbackMonogramSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <rect width="44" height="44" rx="10" fill="${primaryColor}" />
          <text x="22" y="28" fill="#ffffff" font-family="system-ui, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${escapeHtml(initials)}</text>
        </svg>`;

  // Logo or Monogram rendering
  let logoHtml = '';
  if (data.logoUrl) {
    logoHtml = `<img src="${escapeHtml(data.logoUrl)}" alt="${businessName}" class="brand-logo-img" />`;
  } else if (data.monogramSvg) {
    logoHtml = `<div class="brand-logo-monogram">${data.monogramSvg}</div>`;
  } else {
    logoHtml = `
      <div class="brand-logo-fallback">
        ${fallbackMonogramSvg}
      </div>`;
  }

  // The page declares its own icon, so browsers never request /favicon.ico from the storage root (REV-56)
  const faviconHref = data.logoUrl || svgDataUri(data.monogramSvg || fallbackMonogramSvg);

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

  // Editorial layout: a numbered list of services instead of cards (REV-54)
  const numberedServicesHtml = services
    .map(
      (service, index) => `
        <li class="numbered-service">
          <span class="numbered-service-index">${String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3 class="numbered-service-title">${escapeHtml(service.title)}</h3>
            <p class="numbered-service-desc">${escapeHtml(service.description)}</p>
          </div>
        </li>
      `,
    )
    .join('\n');

  // Split and compact layouts: even tiles with the icon beside the title (REV-54)
  const tileServicesHtml = services
    .map(
      (service) => `
        <div class="service-tile">
          <div class="service-tile-head">
            <span class="service-tile-icon">${getLucideIconSvg(service.lucideIconName, { size: 22 })}</span>
            <h3 class="service-tile-title">${escapeHtml(service.title)}</h3>
          </div>
          <p class="service-tile-desc">${escapeHtml(service.description)}</p>
        </div>
      `,
    )
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
    <section class="about-section${layout === 'split' ? ' about-reverse' : ''}" id="about">
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
        <div class="gallery-grid${layout === 'split' ? ` gallery-count-${galleryImages.length}` : ''}">
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

  // -------------------------------------------------------------
  // Page sections. Every layout renders the same content; only the markup and order differ (REV-54)
  // -------------------------------------------------------------
  const heroActionsHtml = `
        <div class="hero-actions">
          <a href="#booking" class="btn-primary" data-revamp-cta="primary-booking">
            <span>${primaryCtaText}</span>
            ${getLucideIconSvg('arrow-right', { size: 18 })}
          </a>
          <a href="${secondaryCtaHref}" class="btn-secondary" data-revamp-cta="call">
            ${getLucideIconSvg(phone ? 'phone' : 'mail', { size: 18 })}
            <span>${secondaryCtaText}</span>
          </a>
        </div>`;
  const heroBadgeHtml = heroBadge ? `<div class="hero-badge">${heroBadge}</div>` : '';
  const trustBarHtml = trustSignals.length ? `<div class="trust-signals-bar">${trustSignalsHtml}</div>` : '';
  const heroImageHtml = data.heroImageUrl
    ? `<img class="hero-image" src="${escapeHtml(data.heroImageUrl)}" alt="${businessName}" />`
    : '';

  // Verified contacts only (Strict Grounding): the compact hero leads with them
  const quickFactsHtml = [
    phone
      ? `<li class="quick-fact">${getLucideIconSvg('phone', { size: 18 })}<a href="tel:${phoneClean}">${escapeHtml(phone)}</a></li>`
      : '',
    email
      ? `<li class="quick-fact">${getLucideIconSvg('mail', { size: 18 })}<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></li>`
      : '',
    address
      ? `<li class="quick-fact">${getLucideIconSvg('map-pin', { size: 18 })}<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(address)}</a></li>`
      : '',
    workingHours ? `<li class="quick-fact">${getLucideIconSvg('clock', { size: 18 })}<span>${escapeHtml(workingHours)}</span></li>` : '',
  ].join('');

  const heroByLayout: Record<MvpLayoutVariant, string> = {
    bento: `
    <!-- MODULE 2: HERO SECTION -->
    <section class="hero-section">
      <div class="hero-bg-glow"></div>
      <div class="container hero-content">
        ${heroBadgeHtml}

        <h1 class="hero-headline">
          ${heroHeadline}
        </h1>

        <p class="hero-subheadline">
          ${heroSubheadline}
        </p>

        ${heroActionsHtml}

        ${trustBarHtml}

        ${heroImageHtml}
      </div>
    </section>`,
    split: `
    <!-- MODULE 2: HERO SECTION (split: copy beside the photo) -->
    <section class="hero-section hero-split${data.heroImageUrl ? '' : ' hero-split-no-image'}">
      <div class="container hero-split-grid">
        <div class="hero-split-copy">
          ${heroBadgeHtml}
          <h1 class="hero-headline">${heroHeadline}</h1>
          <p class="hero-subheadline">${heroSubheadline}</p>
          ${heroActionsHtml}
          ${trustBarHtml}
        </div>
        ${data.heroImageUrl ? `<img class="hero-split-image" src="${escapeHtml(data.heroImageUrl)}" alt="${businessName}" />` : ''}
      </div>
    </section>`,
    editorial: `
    <!-- MODULE 2: HERO SECTION (editorial: typographic, left-aligned) -->
    <section class="hero-section hero-editorial">
      <div class="container hero-editorial-inner">
        ${heroBadgeHtml}
        <h1 class="hero-headline">${heroHeadline}</h1>
        <p class="hero-subheadline">${heroSubheadline}</p>
        ${heroActionsHtml}
        ${trustBarHtml}
        ${heroImageHtml}
      </div>
    </section>`,
    compact: `
    <!-- MODULE 2: HERO SECTION (compact: headline beside the verified contacts) -->
    <section class="hero-section hero-compact">
      <div class="container hero-compact-grid">
        <div class="hero-compact-copy">
          ${heroBadgeHtml}
          <h1 class="hero-headline">${heroHeadline}</h1>
          <p class="hero-subheadline">${heroSubheadline}</p>
          ${heroActionsHtml}
        </div>
        ${quickFactsHtml ? `<ul class="quick-facts">${quickFactsHtml}</ul>` : ''}
      </div>
      ${trustBarHtml || heroImageHtml ? `<div class="container">${trustBarHtml}${heroImageHtml}</div>` : ''}
    </section>`,
  };

  const servicesBodyByLayout: Record<MvpLayoutVariant, string> = {
    bento: `<div class="bento-grid">
          ${bentoCardsHtml}
        </div>`,
    split: `<div class="service-tiles">${tileServicesHtml}</div>`,
    editorial: `<ol class="numbered-services">${numberedServicesHtml}</ol>`,
    compact: `<div class="service-tiles service-tiles-compact">${tileServicesHtml}</div>`,
  };
  const servicesSectionHtml = services.length
    ? `
    <!-- MODULE 3: SERVICES (${layout}) -->
    <section class="bento-section" id="services">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${escapeHtml(t.servicesTag)}</span>
          <h2 class="section-title">${servicesHeading}</h2>
        </div>

        ${servicesBodyByLayout[layout]}
      </div>
    </section>`
    : '';
  const reviewsSectionHtml = reviews.length
    ? `
    <!-- MODULE 4: SOCIAL PROOF & REVIEWS (only real testimonials from the original site) -->
    <section class="reviews-section" id="reviews">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${escapeHtml(t.reviewsTag)}</span>
          <h2 class="section-title">${escapeHtml(t.reviewsHeading(data.businessName))}</h2>
        </div>

        <div class="reviews-grid">
          ${reviewsHtml}
        </div>
      </div>
    </section>`
    : '';
  const bookingSectionHtml = `
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
    </section>`;

  // Section order per layout: image-led layouts show the gallery early, text-led ones the About block
  const sectionsByLayout: Record<MvpLayoutVariant, string[]> = {
    bento: [heroByLayout.bento, aboutHtml, servicesSectionHtml, galleryHtml, reviewsSectionHtml],
    split: [heroByLayout.split, galleryHtml, servicesSectionHtml, aboutHtml, reviewsSectionHtml],
    editorial: [heroByLayout.editorial, aboutHtml, servicesSectionHtml, reviewsSectionHtml, galleryHtml],
    compact: [heroByLayout.compact, servicesSectionHtml, reviewsSectionHtml, aboutHtml, galleryHtml],
  };
  const mainHtml = [...sectionsByLayout[layout], bookingSectionHtml].filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${businessName} — Official website & booking</title>
  <link rel="icon" href="${escapeHtml(faviconHref)}">
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
    ${LAYOUT_CSS[layout]}
  </style>

  ${data.customHeadSnippet ? data.customHeadSnippet : ''}
</head>
<body class="layout-${layout}">

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
${mainHtml}
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
            data.trackingToken && tracker
              ? `
          try {
            if (navigator.sendBeacon) {
              navigator.sendBeacon(${scriptJson(tracker.eventUrl)}, new Blob([JSON.stringify({
                token: ${scriptJson(data.trackingToken)},
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
  ${
    tracker
      ? `<script src="${escapeHtml(tracker.scriptSrc)}" data-api="${escapeHtml(tracker.apiOrigin)}" data-token="${escapeHtml(data.trackingToken)}" async></script>`
      : ''
  }
</body>
</html>`;
}
