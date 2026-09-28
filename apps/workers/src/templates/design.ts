import {
  IMvpDesign,
  IMvpDesignBlock,
  MVP_DESIGN_HERO_PARTS,
  MvpDesignElement,
  MvpDesignElementStyle,
  MvpDesignHeroPart,
} from '@revamp/shared-types';
import { escapeHtml } from './html.js';
import { getLucideIconSvg, getSupportedIconNames } from './icons.js';

/**
 * Applies an MVP's custom design spec (REV-92) deterministically: CSS from fixed tokens, the section
 * order and the custom blocks' markup. The spec only names things the template already has, so the
 * model that wrote it never writes CSS or markup, and the grounded content stays the same.
 */

/** A design that changes nothing is treated as no design, so the page renders exactly as without one */
export function hasDesign(design: IMvpDesign | undefined | null): design is IMvpDesign {
  if (!design) return false;
  return Boolean(
    design.sectionOrder?.length ||
      design.hidden?.length ||
      (design.hero && Object.values(design.hero).some((value) => value !== undefined && (!Array.isArray(value) || value.length))) ||
      (design.theme && Object.values(design.theme).some((value) => value !== undefined)) ||
      (design.elements && Object.values(design.elements).some((style) => style && Object.keys(style).length)) ||
      design.blocks?.length,
  );
}

export const isHidden = (design: IMvpDesign | undefined, name: string): boolean =>
  Boolean(design?.hidden?.includes(name as never));

/**
 * The page order of the sections and blocks: the ones the design lists first, then the rest in the
 * layout's own order, then the remaining blocks. Hidden sections are kept here; they are not rendered.
 */
export function resolveSectionOrder(layoutOrder: readonly string[], design: IMvpDesign | undefined): string[] {
  const available: string[] = [...layoutOrder, ...(design?.blocks ?? []).map((block) => block.id)];
  const listed: string[] = (design?.sectionOrder ?? []).filter((id) => available.includes(id));
  return [...listed, ...available.filter((id) => !listed.includes(id))];
}

// ---------------------------------------------------------------------------------------------
// Element styles
// ---------------------------------------------------------------------------------------------

/** Every page element a style name reaches, across the four layouts */
const ELEMENT_SELECTORS: Record<MvpDesignElement, string[]> = {
  header: ['.site-header'],
  'hero.badge': ['.hero-badge'],
  'hero.headline': ['.hero-headline'],
  'hero.subheadline': ['.hero-subheadline'],
  'cta.primary': ['[data-revamp-cta="primary-booking"]'],
  'cta.secondary': ['[data-revamp-cta="call"]'],
  'section.title': ['.section-title', '.revamp-block-title'],
  'service.card': ['.bento-card', '.service-tile', '.numbered-service'],
  'review.card': ['.review-card'],
  'about.body': ['.about-body'],
  'trust.badge': ['.trust-badge-item'],
};

/** The template's own font size of each text element at size `md`: [min rem, fluid vw, max rem] */
const BASE_FONT_SIZE: Partial<Record<MvpDesignElement, [number, number | null, number]>> = {
  'hero.headline': [2, 5, 3.5],
  'hero.subheadline': [1.0625, 2, 1.25],
  'hero.badge': [0.875, null, 0.875],
  'cta.primary': [1, null, 1],
  'cta.secondary': [1, null, 1],
  'section.title': [1.75, 3.5, 2.5],
  'about.body': [1.1, null, 1.1],
};

const SIZE_FACTOR: Record<NonNullable<MvpDesignElementStyle['size']>, number> = {
  sm: 0.8,
  md: 1,
  lg: 1.25,
  xl: 1.55,
  '2xl': 1.95,
};

const round = (value: number) => Math.round(value * 1000) / 1000;

function fontSize(element: MvpDesignElement, size: NonNullable<MvpDesignElementStyle['size']>): string | undefined {
  const base = BASE_FONT_SIZE[element];
  if (!base) return undefined;
  const factor = SIZE_FACTOR[size];
  const [min, vw, max] = base;
  if (vw === null) return `${round(min * factor)}rem`;
  return `clamp(${round(min * factor)}rem, ${round(vw * factor)}vw, ${round(max * factor)}rem)`;
}

const WEIGHT: Record<NonNullable<MvpDesignElementStyle['weight']>, string> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '900',
};
const TRACKING: Record<NonNullable<MvpDesignElementStyle['tracking']>, string> = {
  tight: '-0.035em',
  normal: '0',
  wide: '0.08em',
};
const COLOR: Record<NonNullable<MvpDesignElementStyle['color']>, string> = {
  text: 'var(--color-text-main)',
  muted: 'var(--color-text-muted)',
  primary: 'var(--brand-primary)',
  accent: 'var(--brand-accent)',
  white: '#ffffff',
};
const BACKGROUND: Record<NonNullable<MvpDesignElementStyle['background']>, string> = {
  none: 'transparent',
  surface: 'var(--color-surface)',
  tint: 'rgba(var(--brand-primary-rgb), 0.1)',
  primary: 'var(--brand-primary)',
  accent: 'var(--brand-accent)',
  dark: '#0f172a',
};
/** Backgrounds that need light text when the design does not set a color */
const DARK_BACKGROUNDS = new Set(['primary', 'accent', 'dark']);
const RADIUS: Record<NonNullable<MvpDesignElementStyle['radius']>, string> = {
  none: '0',
  sm: '0.375rem',
  md: '0.75rem',
  lg: '1.25rem',
  pill: '9999px',
};
const SHADOW: Record<NonNullable<MvpDesignElementStyle['shadow']>, string> = {
  none: 'none',
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  brand: 'var(--shadow-brand)',
};
const BORDER: Record<NonNullable<MvpDesignElementStyle['border']>, string> = {
  none: 'none',
  subtle: '1px solid var(--color-border)',
  primary: '2px solid var(--brand-primary)',
};

/** Declarations for one element's tokens */
export function elementDeclarations(element: MvpDesignElement, style: MvpDesignElementStyle): string[] {
  const declarations: string[] = [];
  const size = style.size ? fontSize(element, style.size) : undefined;
  if (size) declarations.push(`font-size: ${size}`);
  if (style.weight) declarations.push(`font-weight: ${WEIGHT[style.weight]}`);
  if (style.align) declarations.push(`text-align: ${style.align}`);
  if (style.transform) declarations.push(`text-transform: ${style.transform}`);
  if (style.tracking) declarations.push(`letter-spacing: ${TRACKING[style.tracking]}`);
  if (style.color) declarations.push(`color: ${COLOR[style.color]}`);
  else if (style.background && DARK_BACKGROUNDS.has(style.background)) declarations.push('color: #ffffff');
  if (style.background) declarations.push(`background: ${BACKGROUND[style.background]}`);
  if (style.radius) declarations.push(`border-radius: ${RADIUS[style.radius]}`);
  if (style.shadow) declarations.push(`box-shadow: ${SHADOW[style.shadow]}`);
  if (style.border) declarations.push(`border: ${BORDER[style.border]}`);
  return declarations;
}

const rule = (selectors: string[], declarations: string[]) =>
  declarations.length ? `${selectors.join(', ')} { ${declarations.map((d) => `${d} !important`).join('; ')}; }` : '';

// ---------------------------------------------------------------------------------------------
// Overall look
// ---------------------------------------------------------------------------------------------

/** System font stacks only (modernfontstacks.com): the page loads no external fonts */
const FONT_STACKS = {
  humanist: "Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif",
  geometric: "Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif",
  rounded:
    "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', 'Arial Rounded MT Bold', Calibri, source-sans-pro, sans-serif",
  serif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
  display: "'Iowan Old Style', 'Palatino Linotype', 'URW Palladio L', P052, serif",
  mono: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
};
const HEADINGS = ['h1', 'h2', 'h3', '.brand-name', '.hero-headline', '.section-title', '.revamp-block-title'];

function fontCss(font: NonNullable<NonNullable<IMvpDesign['theme']>['font']>): string {
  switch (font) {
    case 'humanist':
    case 'geometric':
    case 'rounded':
    case 'serif': {
      const stack = FONT_STACKS[font];
      return `:root { --font-family: ${stack} !important; --font-display: ${stack} !important; }\n${rule(HEADINGS, [`font-family: ${stack}`])}`;
    }
    case 'serif-display':
      return `:root { --font-display: ${FONT_STACKS.display} !important; }\n${rule(HEADINGS, [`font-family: ${FONT_STACKS.display}`])}`;
    case 'mono-display':
      return rule(HEADINGS, [`font-family: ${FONT_STACKS.mono}`, 'letter-spacing: -0.02em']);
    default:
      return '';
  }
}

/** The template's own section padding: [selector, top rem, bottom rem] */
const SECTION_PADDING: Array<[string, number, number]> = [
  ['.hero-section', 3.5, 2.5],
  ['.bento-section', 4, 3],
  ['.reviews-section', 4, 3],
  ['.about-section', 5, 5],
  ['.booking-section', 4, 4],
  ['.revamp-block', 3.5, 3.5],
];
const DENSITY_FACTOR = { compact: 0.6, comfortable: 1, airy: 1.5 } as const;

function densityCss(density: keyof typeof DENSITY_FACTOR): string {
  if (density === 'comfortable') return '';
  const factor = DENSITY_FACTOR[density];
  return SECTION_PADDING.map(([selector, top, bottom]) =>
    rule([selector], [`padding-top: ${round(top * factor)}rem`, `padding-bottom: ${round(bottom * factor)}rem`]),
  )
    .concat(rule(['.gallery-section'], [`padding-bottom: ${round(5 * factor)}rem`]))
    .join('\n');
}

const CORNER_RADII = {
  sharp: ['0', '0', '0'],
  soft: ['0.625rem', '0.5rem', '0.375rem'],
  rounded: ['1.25rem', '0.875rem', '0.5rem'],
  'extra-round': ['2rem', '1.5rem', '1rem'],
} as const;

function cornersCss(corners: keyof typeof CORNER_RADII): string {
  if (corners === 'rounded') return '';
  const [xl, lg, md] = CORNER_RADII[corners];
  return `:root { --radius-xl: ${xl} !important; --radius-lg: ${lg} !important; --radius-md: ${md} !important; }`;
}

function heroStyleCss(style: NonNullable<NonNullable<IMvpDesign['theme']>['heroStyle']>): string {
  const light = [
    rule(['.hero-section .hero-headline', '.hero-section .quick-fact', '.hero-section .quick-fact a'], ['color: #ffffff']),
    rule(['.hero-section .btn-secondary'], ['background: transparent', 'color: #ffffff', 'border-color: rgba(255, 255, 255, 0.4)', 'box-shadow: none']),
    rule(['.hero-section .trust-signals-bar'], ['background: rgba(255, 255, 255, 0.08)', 'border-color: rgba(255, 255, 255, 0.16)', 'box-shadow: none']),
    rule(['.hero-section .hero-bg-glow'], ['display: none']),
    // The badge's text is the brand color, which can be as dark as the background
    rule(['.hero-section .hero-badge'], ['background: rgba(255, 255, 255, 0.1)', 'color: #e2e8f0', 'border-color: rgba(255, 255, 255, 0.24)']),
  ];
  switch (style) {
    case 'tinted':
      return rule(['.hero-section'], ['background: rgba(var(--brand-primary-rgb), 0.08)']);
    case 'dark':
      return [
        rule(['.hero-section'], ['background: #0f172a']),
        // A dark brand color would sink into the background: a light ring keeps the button visible
        rule(['.hero-section .btn-primary'], ['box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35)']),
        rule(['.hero-section .hero-subheadline', '.hero-section .trust-badge-label'], ['color: #cbd5e1']),
        ...light,
      ].join('\n');
    case 'brand':
      return [
        rule(['.hero-section'], ['background: var(--brand-primary)']),
        rule(['.hero-section .hero-subheadline', '.hero-section .trust-badge-label'], ['color: rgba(255, 255, 255, 0.85)']),
        rule(['.hero-section .trust-badge-metric'], ['color: #ffffff']),
        rule(['.hero-section .btn-primary'], ['background: #ffffff', 'color: var(--brand-primary)']),
        ...light,
      ].join('\n');
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------------------------
// Hero arrangement
// ---------------------------------------------------------------------------------------------

const HERO_COPY = ['.hero-content', '.hero-split-copy', '.hero-editorial-inner', '.hero-compact-copy'];
const HERO_PART_SELECTOR: Record<MvpDesignHeroPart, string> = {
  badge: '.hero-badge',
  headline: '.hero-headline',
  subheadline: '.hero-subheadline',
  actions: '.hero-actions',
  trust: '.trust-signals-bar',
  image: '.hero-image',
};

function heroCss(hero: NonNullable<IMvpDesign['hero']>): string {
  const css: string[] = [];
  const order = hero.order?.length ? hero.order : undefined;

  if (order || hero.align) {
    // A column the parts can be ordered in; the Bento hero is centered, the other layouts start left
    css.push(rule(HERO_COPY, ['display: flex', 'flex-direction: column']));
    if (!hero.align) {
      css.push(rule(['.hero-content'], ['align-items: center']));
      css.push(rule(['.hero-split-copy', '.hero-editorial-inner', '.hero-compact-copy'], ['align-items: flex-start']));
    }
    css.push(rule(['.hero-section .trust-signals-bar', '.hero-section .hero-image'], ['align-self: stretch']));
  }

  if (hero.align) {
    const center = hero.align === 'center';
    css.push(rule(HERO_COPY, [`align-items: ${center ? 'center' : 'flex-start'}`, `text-align: ${hero.align}`]));
    css.push(rule(['.hero-section .hero-actions'], [`justify-content: ${center ? 'center' : 'flex-start'}`]));
    css.push(rule(['.hero-section .hero-subheadline', '.hero-section .trust-signals-bar'], [center ? 'margin-inline: auto' : 'margin-inline: 0']));
    css.push(rule(['.hero-section .trust-badge-item'], [`align-items: ${center ? 'center' : 'flex-start'}`, `text-align: ${hero.align}`]));
  }

  if (order) {
    const full = [...order, ...MVP_DESIGN_HERO_PARTS.filter((part) => !order.includes(part))];
    full.forEach((part, index) => css.push(rule([`.hero-section ${HERO_PART_SELECTOR[part]}`], [`order: ${index}`])));
  }

  if (hero.imageSide === 'left') {
    css.push(`@media (min-width: 900px) { .hero-split-image { order: -1 !important; } }`);
  }
  return css.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Custom blocks
// ---------------------------------------------------------------------------------------------

const BLOCK_CSS = `
    .revamp-block { padding-block: 3.5rem; }
    .revamp-block-title { font-size: clamp(1.5rem, 3vw, 2.25rem); font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; color: var(--color-text-main); margin-bottom: 0.75rem; }
    .revamp-block-body { color: var(--color-text-muted); font-size: 1.0625rem; line-height: 1.6; max-width: 720px; }
    .revamp-block-highlight .revamp-block-inner { text-align: center; }
    .revamp-block-highlight .revamp-block-body { margin-inline: auto; }
    .revamp-block-features-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 1.75rem; }
    .revamp-feature { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; }
    .revamp-feature-icon { display: inline-flex; padding: 0.5rem; border-radius: var(--radius-md); color: var(--brand-primary); background: rgba(var(--brand-primary-rgb), 0.1); margin-bottom: 0.75rem; }
    .revamp-feature-title { font-size: 1.0625rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.25rem; }
    .revamp-feature-text { font-size: 0.9375rem; color: var(--color-text-muted); line-height: 1.5; }
    .revamp-block-cta-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.5rem; }
    .revamp-block-tinted { background: rgba(var(--brand-primary-rgb), 0.07); }
    .revamp-block-brand { background: var(--brand-primary); }
    .revamp-block-dark { background: #0f172a; }
    .revamp-block-brand .revamp-block-title, .revamp-block-dark .revamp-block-title,
    .revamp-block-brand .revamp-feature-title, .revamp-block-dark .revamp-feature-title { color: #ffffff; }
    .revamp-block-brand .revamp-block-body, .revamp-block-brand .revamp-feature-text { color: rgba(255, 255, 255, 0.85); }
    .revamp-block-dark .revamp-block-body, .revamp-block-dark .revamp-feature-text { color: #cbd5e1; }
    .revamp-block-brand .revamp-feature, .revamp-block-dark .revamp-feature { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.16); }
    .revamp-block-brand .revamp-feature-icon, .revamp-block-dark .revamp-feature-icon { color: #ffffff; background: rgba(255, 255, 255, 0.14); }
    .revamp-block-brand .btn-primary { background: #ffffff; color: var(--brand-primary); }`;

function blockIcon(name: string | undefined): string {
  const normalized = (name || '').toLowerCase().trim().replace(/_/g, '-');
  return getLucideIconSvg(getSupportedIconNames().includes(normalized) ? normalized : 'sparkles', { size: 22 });
}

/** A custom block's markup; its text is grounded copy, escaped like the rest of the page */
export function renderDesignBlock(block: IMvpDesignBlock): string {
  const title = `<h2 class="revamp-block-title">${escapeHtml(block.title)}</h2>`;
  const body = block.body ? `<p class="revamp-block-body">${escapeHtml(block.body)}</p>` : '';
  let inner: string;
  switch (block.type) {
    case 'features':
      inner = `${title}${body}
        <div class="revamp-block-features-grid">${(block.items ?? [])
          .map(
            (item) => `
          <div class="revamp-feature">
            <span class="revamp-feature-icon">${blockIcon(item.icon)}</span>
            <h3 class="revamp-feature-title">${escapeHtml(item.title)}</h3>
            ${item.text ? `<p class="revamp-feature-text">${escapeHtml(item.text)}</p>` : ''}
          </div>`,
          )
          .join('')}
        </div>`;
      break;
    case 'cta':
      inner = `<div class="revamp-block-cta-row">
          <div>${title}${body}</div>
          <a href="#booking" class="btn-primary" data-revamp-cta="block">
            <span>${escapeHtml(block.buttonText)}</span>
            ${getLucideIconSvg('arrow-right', { size: 18 })}
          </a>
        </div>`;
      break;
    default:
      inner = `${title}${body}`;
  }
  return `
    <!-- CUSTOM BLOCK (REV-92) -->
    <section class="revamp-block revamp-block-${block.type} revamp-block-${block.style ?? 'plain'}" id="${block.id}" data-revamp-section="${block.id}">
      <div class="container revamp-block-inner">
        ${inner}
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------------------------
// The whole design
// ---------------------------------------------------------------------------------------------

/**
 * The design's CSS, for a `<style>` after the layout's. Every declaration is `!important` and element
 * styles are prefixed with `body.revamp-designed`, so they win over the template and layout styles;
 * theme rules come first, so an element style set on purpose wins over the hero style.
 */
export function designCss(design: IMvpDesign | undefined | null): string {
  if (!hasDesign(design)) return '';
  const css: string[] = [];
  if (design.blocks?.length) css.push(BLOCK_CSS);
  const theme = design.theme ?? {};
  if (theme.font) css.push(fontCss(theme.font));
  if (theme.density) css.push(densityCss(theme.density));
  if (theme.corners) css.push(cornersCss(theme.corners));
  if (theme.heroStyle) css.push(heroStyleCss(theme.heroStyle));
  if (design.hero) css.push(heroCss(design.hero));
  for (const [element, style] of Object.entries(design.elements ?? {}) as Array<[MvpDesignElement, MvpDesignElementStyle | undefined]>) {
    if (!style || !ELEMENT_SELECTORS[element]) continue;
    const selectors = ELEMENT_SELECTORS[element].map((selector) => `body.revamp-designed ${selector}`);
    css.push(rule(selectors, elementDeclarations(element, style)));
  }
  return css.filter(Boolean).join('\n    ');
}
