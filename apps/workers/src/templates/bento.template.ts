import { IBentoTemplateData, IBentoServiceCard, IBentoReviewItem } from '@revamp/shared-types';
import { getLucideIconSvg } from './icons.js';

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
 * Generates default reviews if none are provided.
 */
function getDefaultReviews(businessName: string): IBentoReviewItem[] {
  return [
    {
      author: 'Алексей Михайлов',
      rating: 5,
      comment: `Отличный сервис! Обратился в «${businessName}» по рекомендации. Все сделали быстро, прозрачно и без скрытых переплат. Рекомендую!`,
      date: '3 дня назад',
      source: 'Яндекс Карты',
    },
    {
      author: 'Екатерина Смирнова',
      rating: 5,
      comment: 'Очень вежливый персонал и высокое качество работы. Приятно удивили пунктуальность и внимательное отношение к деталям.',
      date: '1 неделю назад',
      source: 'Google Карты',
    },
    {
      author: 'Дмитрий Ковалев',
      rating: 5,
      comment: 'Настоящие профессионалы своего дела. Сразу видно опыт и честный подход к клиенту. Обязательно обращусь снова.',
      date: '2 недели назад',
      source: '2ГИС',
    },
  ];
}

/**
 * Generates default trust signals if none provided.
 */
function getDefaultTrustSignals(): Array<{ metric: string; label: string }> {
  return [
    { metric: '4.9 ★', label: 'Рейтинг в картах на основе 150+ отзывов' },
    { metric: '10+ лет', label: 'Опыт работы и сертифицированные мастера' },
    { metric: '100%', label: 'Гарантия на все виды работ и прозрачный расчет' },
  ];
}

/**
 * Compiles the complete, self-contained Bento Landing Page HTML document.
 */
export function generateBentoHtml(data: IBentoTemplateData): string {
  const businessName = escapeHtml(data.businessName);
  const primaryColor = data.palette?.primary || '#5c5bed';
  const secondaryColor = data.palette?.secondary || '#b8c4fe';
  const accentColor = data.palette?.accent || '#5c5bed';
  const primaryRgb = hexToRgb(primaryColor);
  const accentRgb = hexToRgb(accentColor);

  const phone = data.contacts?.phone || '+7 (812) 000-00-00';
  const phoneClean = phone.replace(/[^+\d]/g, '');
  const email = data.contacts?.email || `info@${data.businessName.toLowerCase().replace(/\s+/g, '')}.ru`;
  const address = data.contacts?.address || (data.contacts?.city ? `г. ${data.contacts.city}` : 'Санкт-Петербург');
  const workingHours = data.contacts?.workingHours || 'Пн–Вс: 09:00 – 21:00 (Без выходных)';

  const heroBadge = escapeHtml(data.hero.badge || '✨ Специальное предложение');
  const heroHeadline = escapeHtml(data.hero.headline);
  const heroSubheadline = escapeHtml(data.hero.subheadline);
  const primaryCtaText = escapeHtml(data.hero.primaryCtaText || 'Записаться онлайн');
  const secondaryCtaText = escapeHtml(data.hero.secondaryCtaText || 'Позвонить');

  const services: IBentoServiceCard[] = data.services && data.services.length > 0 ? data.services : [
    {
      title: 'Комплексная диагностика',
      description: 'Точная оценка и выявление всех скрытых дефектов на сертифицированном оборудовании.',
      lucideIconName: 'activity',
      badge: 'Популярно',
      highlight: true,
    },
    {
      title: 'Оперативный ремонт',
      description: 'Устранение неисправностей любой сложности с гарантией результата в согласованные сроки.',
      lucideIconName: 'wrench',
    },
    {
      title: 'Гарантийное обслуживание',
      description: 'Официальная гарантия на все выполненные работы и оригинальные комплектующие.',
      lucideIconName: 'shield-check',
      badge: 'Гарантия 1 год',
    },
    {
      title: 'Экспресс-консультация',
      description: 'Бесплатный расчет стоимости и экспертная консультация специалиста за 10 минут.',
      lucideIconName: 'phone',
    },
  ];

  const trustSignals = data.trustSignals && data.trustSignals.length > 0 ? data.trustSignals : getDefaultTrustSignals();
  const reviews = data.reviews && data.reviews.length > 0 ? data.reviews : getDefaultReviews(data.businessName);

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
            <span>Выбрать услугу</span>
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
      const starRating = Array(Math.min(5, Math.max(1, rev.rating || 5)))
        .fill(0)
        .map(() => `<span class="star-icon">★</span>`)
        .join('');

      return `
        <div class="review-card">
          <div class="review-header">
            <div class="review-author-info">
              <div class="review-avatar">${escapeHtml(rev.author.charAt(0))}</div>
              <div>
                <div class="review-author-name">${escapeHtml(rev.author)}</div>
                <div class="review-source">${escapeHtml(rev.source || 'Проверенный отзыв')} ${rev.date ? `• ${escapeHtml(rev.date)}` : ''}</div>
              </div>
            </div>
            <div class="review-stars">${starRating}</div>
          </div>
          <p class="review-text">«${escapeHtml(rev.comment)}»</p>
        </div>
      `;
    })
    .join('\n');

  // Service Options for Booking Select
  const serviceSelectOptions = services
    .map((s) => `<option value="${escapeHtml(s.title)}">${escapeHtml(s.title)}</option>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${businessName} — Официальный сайт и запись</title>
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
        <a href="tel:${phoneClean}" class="call-btn" aria-label="Позвонить нам">
          ${getLucideIconSvg('phone', { size: 18 })}
          <span>${escapeHtml(phone)}</span>
        </a>
        <a href="#booking" class="header-booking-btn">
          <span>Записаться</span>
        </a>
      </div>
    </div>
  </header>

  <main>
    <!-- MODULE 2: HERO SECTION -->
    <section class="hero-section">
      <div class="hero-bg-glow"></div>
      <div class="container hero-content">
        <div class="hero-badge">
          ${heroBadge}
        </div>

        <h1 class="hero-headline">
          ${heroHeadline}
        </h1>

        <p class="hero-subheadline">
          ${heroSubheadline}
        </p>

        <div class="hero-actions">
          <a href="#booking" class="btn-primary">
            <span>${primaryCtaText}</span>
            ${getLucideIconSvg('arrow-right', { size: 18 })}
          </a>
          <a href="tel:${phoneClean}" class="btn-secondary">
            ${getLucideIconSvg('phone', { size: 18 })}
            <span>${secondaryCtaText}</span>
          </a>
        </div>

        <!-- Trust signals -->
        <div class="trust-signals-bar">
          ${trustSignalsHtml}
        </div>
      </div>
    </section>

    <!-- MODULE 3: BENTO SERVICES GRID -->
    <section class="bento-section" id="services">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">Наши услуги</span>
          <h2 class="section-title">Качественные решения для любых задач</h2>
          <p class="section-desc">
            Прозрачные фиксированные цены, официальная гарантия и индивидуальный подход к каждому клиенту.
          </p>
        </div>

        <div class="bento-grid">
          ${bentoCardsHtml}
        </div>
      </div>
    </section>

    <!-- MODULE 4: SOCIAL PROOF & REVIEWS -->
    <section class="reviews-section" id="reviews">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">Отзывы клиентов</span>
          <h2 class="section-title">Нам доверяют сотни клиентов</h2>
          <p class="section-desc">
            Честные отзывы и оценки на Яндекс Картах, Google Maps и 2ГИС.
          </p>
        </div>

        <div class="reviews-grid">
          ${reviewsHtml}
        </div>
      </div>
    </section>

    <!-- MODULE 5: INTERACTIVE BOOKING FORM -->
    <section class="booking-section" id="booking">
      <div class="container">
        <div class="booking-wrapper">
          <div class="section-header" style="margin-bottom: 2rem;">
            <span class="section-tag">Онлайн запись</span>
            <h2 class="section-title" style="font-size: 1.75rem;">Запишитесь на консультацию</h2>
            <p class="section-desc">
              Оставьте заявку сейчас — мы перезвоним в течение 10 минут и подберем удобное время.
            </p>
          </div>

          <form id="lead-booking-form" class="booking-form" novalidate>
            <div class="form-group">
              <label for="lead-name" class="form-label">Ваше имя *</label>
              <input 
                type="text" 
                id="lead-name" 
                name="name" 
                class="form-input" 
                placeholder="Иван Иванов" 
                required 
                autocomplete="name"
              />
            </div>

            <div class="form-group">
              <label for="lead-phone" class="form-label">Контактный телефон *</label>
              <input 
                type="tel" 
                id="lead-phone" 
                name="phone" 
                class="form-input" 
                placeholder="+7 (999) 000-00-00" 
                required 
                autocomplete="tel"
              />
            </div>

            <div class="form-group">
              <label for="lead-service" class="form-label">Интересующая услуга</label>
              <select id="lead-service" name="service" class="form-select">
                <option value="Консультация">Общая консультация</option>
                ${serviceSelectOptions}
              </select>
            </div>

            <div class="form-group">
              <label for="lead-notes" class="form-label">Комментарий или пожелания</label>
              <textarea 
                id="lead-notes" 
                name="notes" 
                class="form-textarea" 
                placeholder="Укажите подробности или желаемое время визита..."
              ></textarea>
            </div>

            <div class="form-checkbox-container">
              <input type="checkbox" id="policy-consent" class="form-checkbox" checked required />
              <label for="policy-consent" class="checkbox-label">
                Я даю согласие на обработку персональных данных и соглашаюсь с политикой конфиденциальности.
              </label>
            </div>

            <button type="submit" id="booking-submit-btn" class="form-submit-btn">
              <span>Записаться прямо сейчас</span>
              ${getLucideIconSvg('send', { size: 18 })}
            </button>
          </form>

          <!-- Confirmation State -->
          <div id="booking-success-message" class="form-success-message" aria-live="polite">
            <div class="success-icon-badge">
              ${getLucideIconSvg('check-circle', { size: 36 })}
            </div>
            <h3 class="success-title">Спасибо за обращение!</h3>
            <p class="success-desc" id="success-client-info">
              Ваша заявка успешно принята. Наш специалист свяжется с вами в течение 10 минут.
            </p>
            <button type="button" id="reset-form-btn" class="btn-secondary" style="margin-inline: auto;">
              Отправить еще одну заявку
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
          <p class="footer-desc">
            Современный сервис, опытные специалисты и надежное качество. Мы ценим доверие каждого клиента.
          </p>
          <a href="#booking" class="revamp-badge">
            ${getLucideIconSvg('sparkles', { size: 14 })}
            <span>Прототип создан платформой Revamp</span>
          </a>
        </div>

        <div>
          <div class="footer-col-title">Контакты</div>
          <ul class="footer-contact-list">
            <li class="footer-contact-item">
              ${getLucideIconSvg('phone', { size: 18 })}
              <a href="tel:${phoneClean}">${escapeHtml(phone)}</a>
            </li>
            <li class="footer-contact-item">
              ${getLucideIconSvg('mail', { size: 18 })}
              <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
            </li>
            <li class="footer-contact-item">
              ${getLucideIconSvg('map-pin', { size: 18 })}
              <span>${escapeHtml(address)}</span>
            </li>
          </ul>
        </div>

        <div>
          <div class="footer-col-title">Режим работы</div>
          <ul class="footer-contact-list">
            <li class="footer-contact-item">
              ${getLucideIconSvg('clock', { size: 18 })}
              <span>${escapeHtml(workingHours)}</span>
            </li>
            <li class="footer-contact-item">
              ${getLucideIconSvg('shield-check', { size: 18 })}
              <span>Официальная гарантия</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <div>© ${new Date().getFullYear()} ${businessName}. Все права защищены.</div>
        <div>Современный адаптивный веб-стандарт</div>
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
        submitBtn.innerHTML = '<span>Отправка...</span>';

        setTimeout(function() {
          form.style.display = 'none';
          successBlock.style.display = 'block';

          if (clientInfo) {
            clientInfo.textContent = 'Спасибо, ' + nameVal + '! Ваша заявка на «' + (serviceSelect ? serviceSelect.value : 'Консультация') + '» принята. Мы перезвоним вам по номеру ' + phoneVal + ' в течение 10 минут.';
          }

          // Dispatch telemetry Beacon if tracking token is provided
          ${
            data.trackingToken
              ? `
          try {
            if (navigator.sendBeacon) {
              navigator.sendBeacon('/api/v1/track/booking/${data.trackingToken}', JSON.stringify({
                name: nameVal,
                phone: phoneVal,
                service: serviceSelect ? serviceSelect.value : '',
                timestamp: new Date().toISOString()
              }));
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
          submitBtn.innerHTML = '<span>Записаться прямо сейчас</span>';
          successBlock.style.display = 'none';
          form.style.display = 'block';
        });
      }
    })();
  </script>
</body>
</html>`;
}
