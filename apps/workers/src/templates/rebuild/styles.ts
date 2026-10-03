import type { IRebuildPlan } from '@revamp/shared-types';

/**
 * A font stack for a CSS declaration: only names, spaces, commas, quotes, dots, hyphens and underscores, and a quote
 * character that is not balanced is dropped, so a bad stack cannot run into the next declaration
 */
export const fontStack = (stack: string): string => {
  let clean = stack.replace(/[^\p{L}\p{N}\s,'"_.-]/gu, '');
  for (const quote of ['"', "'"]) if (clean.split(quote).length % 2 === 0) clean = clean.split(quote).join('');
  return clean.trim() || 'sans-serif';
};

/** The rebuild's CSS (REV-110): the tuned theme as custom properties, rules shared by every rebuilt page, then the operator's CSS */
export function rebuildCss(plan: IRebuildPlan): string {
  const t = plan.theme;
  return `:root {
  --rb-primary: ${t.primary}; --rb-on-primary: ${t.onPrimary};
  --rb-page-bg: ${t.pageBackground}; --rb-page-text: ${t.pageText};
  --rb-heading-font: ${fontStack(t.headingFont)};
  --rb-body-font: ${fontStack(t.bodyFont)};
  --rb-heading-weight: ${t.headingWeight}; --rb-heading-case: ${t.headingUppercase ? 'uppercase' : 'none'};
  --rb-h1: clamp(${Math.round(t.h1Size * 0.6)}px, 6vw, ${t.h1Size}px); --rb-h2: clamp(${Math.round(t.h2Size * 0.7)}px, 4vw, ${t.h2Size}px);
  --rb-body-size: ${t.bodySize}px; --rb-line: ${t.lineHeight};
  --rb-button-radius: ${t.buttonRadius}px; --rb-button-case: ${t.buttonUppercase ? 'uppercase' : 'none'};
}
${STATIC_CSS}${plan.customCss ? `\n/* The operator's CSS (REV-111), sanitized */\n${plan.customCss}` : ''}`;
}

// Driven only by data-* attributes and the plan's variables; never per-site CSS.
// The fill rule ([data-media-fit=fill], REV-114) deliberately lets a photo grow past its natural width, up to
// 2x, capped by --rb-media-max; the note lives here so the published CSS does not carry it
const STATIC_CSS = `*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body { margin: 0; font-family: var(--rb-body-font); font-size: var(--rb-body-size); line-height: var(--rb-line); color: var(--rb-page-text); background: var(--rb-page-bg); overflow-wrap: break-word; }
img { max-width: 100%; height: auto; display: block; }
p { margin: 0 0 1em; }
a { color: inherit; }
h1, h2, h3, h4 { margin: 0 0 0.5em; line-height: 1.2; color: inherit; }
h1, h2, h3 { font-family: var(--rb-heading-font); font-weight: var(--rb-heading-weight); text-transform: var(--rb-heading-case); }
h1 { font-size: var(--rb-h1); }
h2 { font-size: var(--rb-h2); }
h3 { font-size: 1.25em; }
h4 { font-size: 1.1em; }
:focus-visible { outline: 3px solid var(--rb-primary); outline-offset: 2px; }
.rb-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.rb-container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }

/* Header */
.rb-header { position: sticky; top: 0; z-index: 10; background: var(--rb-page-bg); box-shadow: 0 1px 0 rgba(0,0,0,.08); }
.rb-header-row { display: flex; align-items: center; gap: 24px; min-height: 72px; }
.rb-brand { display: inline-flex; align-items: center; flex-shrink: 0; text-decoration: none; }
.rb-logo { display: inline-flex; max-height: 52px; width: auto; max-width: 200px; object-fit: contain; }
.rb-nav { display: flex; flex-wrap: wrap; gap: 4px 20px; flex: 1; }
.rb-nav-link { text-decoration: none; font-size: 0.95em; padding: 8px 0; }
.rb-nav-link:hover { color: var(--rb-primary); }
.rb-header-actions { display: flex; align-items: center; gap: 16px; margin-left: auto; }
.rb-phone { text-decoration: none; font-weight: 600; white-space: nowrap; }

/* Buttons and links */
.rb-cta { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 12px 20px; background: var(--rb-primary); color: var(--rb-on-primary); border-radius: var(--rb-button-radius); text-transform: var(--rb-button-case); text-decoration: none; font-weight: 600; line-height: 1.2; transition: filter .2s ease; }
.rb-cta:hover { filter: brightness(1.08); }
.rb-links { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-top: 16px; }
.rb-link { text-decoration: underline; text-underline-offset: 3px; min-height: 44px; display: inline-flex; align-items: center; }
[data-align=center] .rb-links { justify-content: center; }

/* Sections */
.rb-section { position: relative; padding: var(--rb-section-pad, 64px) 0; background: var(--rb-section-bg, transparent); color: var(--rb-section-text, inherit); scroll-margin-top: 72px; }
[data-full-bleed] .rb-container { max-width: none; }
[data-align=center] .rb-copy { text-align: center; }
.rb-eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .85em; font-weight: 600; margin-bottom: .5em; }
.rb-copy > p, .rb-text > p { max-width: 72ch; }
[data-align=center] .rb-copy > p, [data-align=center] .rb-text > p { margin-left: auto; margin-right: auto; }
.rb-copy > * + .rb-grid, .rb-copy > * + .rb-list, .rb-copy > * + .rb-slider, .rb-copy > * + .rb-gallery, .rb-copy > * + .rb-accordion, .rb-copy > * + .rb-tabs, .rb-copy > * + .rb-text { margin-top: 32px; }
/* An image keeps the width it had on the original (its width attribute), capped by the column; never stretched */
.rb-media img { border-radius: var(--rb-item-radius, 8px); }
[data-align=center] .rb-media img, [data-align=center] .rb-item-image, [data-item-align=center] .rb-item-image { margin-inline: auto; }
.rb-embed { margin-top: 32px; }
.rb-embed iframe { display: block; width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 8px; }
.rb-collapsed summary { cursor: pointer; font-family: var(--rb-heading-font); font-weight: var(--rb-heading-weight); text-transform: var(--rb-heading-case); font-size: var(--rb-h2); line-height: 1.2; }
.rb-collapsed[open] summary { margin-bottom: 16px; }

/* Banner: copy over the photo, with the tuning overlay */
[data-bg-image] { background-color: #333333; background-image: linear-gradient(rgba(0,0,0,var(--rb-overlay,0)), rgba(0,0,0,var(--rb-overlay,0))), var(--rb-bg-image); background-size: cover; background-position: center; }
[data-arrangement=banner][data-bg-image] { display: flex; align-items: center; min-height: min(70vh, 640px); }
[data-arrangement=banner] .rb-container { width: 100%; }
[data-arrangement=banner] .rb-copy { max-width: 820px; }
[data-arrangement=banner][data-align=center] .rb-copy { margin: 0 auto; }

/* Media beside text; --rb-split is the media column's share */
[data-arrangement=media-beside-text][data-has-media] .rb-container { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, var(--rb-split, 50%)); gap: 48px; align-items: center; }
[data-arrangement=media-beside-text][data-has-media][data-media-side=left] .rb-container { grid-template-columns: minmax(0, var(--rb-split, 50%)) minmax(0, 1fr); }
[data-media-side=left] .rb-media { order: -1; }
[data-media-fit=fill] .rb-media img { inline-size: 100%; max-inline-size: var(--rb-media-max, 100%); aspect-ratio: 4/3; object-fit: cover; }
[data-arrangement=media-beside-text] .rb-embed { grid-column: 1 / -1; }
[data-arrangement=media-beside-text] .rb-media .rb-embed { margin-top: 0; }

/* Items */
.rb-item { color: var(--rb-item-text, inherit); background: var(--rb-item-bg, transparent); border-radius: var(--rb-item-radius, 0); }
[data-item-border] .rb-item { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
[data-item-shadow] .rb-item { box-shadow: 0 4px 16px rgba(0,0,0,.08); }
[data-item-border] .rb-item-body, [data-item-shadow] .rb-item-body, [style*="--rb-item-bg"] .rb-item-body { padding: 16px 20px 20px; }
[data-item-align=center] .rb-item { text-align: center; }
[data-item-align=center] .rb-item .rb-links { justify-content: center; }
.rb-item-body { padding-top: 12px; }
.rb-item-body > :last-child { margin-bottom: 0; }
.rb-item-title { margin-bottom: .25em; }
.rb-item-subtitle { opacity: .8; font-size: .95em; margin-bottom: .5em; }
.rb-price { font-weight: 700; color: var(--rb-primary); margin-bottom: .5em; }
[data-bg-image] .rb-price, [style*="--rb-section-bg"] .rb-price { color: inherit; }
.rb-rating { color: #f5a623; letter-spacing: 2px; margin-bottom: .5em; }
.rb-item-image { object-fit: cover; border-radius: var(--rb-item-radius, 0); }
[data-item-border] .rb-item-image, [data-item-shadow] .rb-item-image, [style*="--rb-item-bg"] .rb-item-image { border-radius: var(--rb-item-radius, 0) var(--rb-item-radius, 0) 0 0; }
[data-image-shape=round] .rb-item-image { border-radius: 50%; aspect-ratio: 1; max-width: 240px; margin: 0 auto; }
[data-image-shape=square] .rb-item-image { aspect-ratio: 1; }
[data-image-shape=wide] .rb-item-image { aspect-ratio: 16/9; }
[data-image-shape=tall] .rb-item-image { aspect-ratio: 3/4; }
.rb-grid { display: grid; grid-template-columns: repeat(var(--rb-columns), minmax(0, 1fr)); gap: 24px; }
.rb-list { display: grid; gap: 24px; }
.rb-list .rb-item { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); gap: 24px; align-items: start; }
.rb-list .rb-item:not(:has(.rb-item-image)) { display: block; }
.rb-list .rb-item-body { padding-top: 0; }

/* Accordion: native details, no script */
.rb-accordion { display: grid; gap: 12px; text-align: left; }
.rb-accordion details { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: var(--rb-item-radius, 8px); padding: 0 20px; }
.rb-accordion summary { cursor: pointer; padding: 16px 0; font-weight: 600; min-height: 44px; }
.rb-accordion details[open] summary { border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); margin-bottom: 12px; }
.rb-accordion .rb-item-body { padding: 0 0 16px; }

/* Tabs: radio-driven, every panel stays in the page */
.rb-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.rb-tabs > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.rb-tabs > label { order: 0; cursor: pointer; padding: 10px 18px; min-height: 44px; display: inline-flex; align-items: center; border-radius: var(--rb-button-radius); border: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
.rb-tabs > input:checked + label { background: var(--rb-primary); color: var(--rb-on-primary); border-color: var(--rb-primary); }
.rb-tabs > input:focus-visible + label { outline: 3px solid var(--rb-primary); outline-offset: 2px; }
.rb-tab-panel { order: 1; width: 100%; display: none; padding-top: 16px; }
.rb-tabs > input:checked + label + .rb-tab-panel { display: block; }

/* Slider: a scroll-snap track; the buttons need the script */
.rb-slider { position: relative; }
.rb-track { display: grid; grid-auto-flow: column; grid-auto-columns: min(100%, 420px); gap: 24px; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; padding-bottom: 12px; }
.rb-slide { scroll-snap-align: start; }
.rb-slider-controls { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
[data-align=center] .rb-slider-controls { justify-content: center; }
.rb-slider-controls[hidden] { display: none; }
.rb-slider-controls button { width: 44px; height: 44px; border-radius: 50%; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; font-size: 24px; line-height: 1; cursor: pointer; }
.rb-slider-controls button:hover { background: var(--rb-primary); color: var(--rb-on-primary); border-color: var(--rb-primary); }

/* Photo slides: a hero slider of photos, one full-width slide at a time, each caption over its photo and the overlay */
[data-photo-slides] { padding: 0; }
[data-photo-slides] > .rb-container { max-width: none; padding: 0; }
/* Only the slider runs edge to edge; the intro, extra copy and embeds keep the container's side padding */
[data-photo-slides] .rb-copy > :not(.rb-slider), [data-photo-slides] > .rb-container > .rb-embed { padding-inline: 16px; }
[data-photo-slides] .rb-track { grid-auto-columns: 100%; gap: 0; padding-bottom: 0; }
.rb-photo-slide { display: flex; align-items: center; min-height: min(75vh, 600px); color: #ffffff; background-color: #333333; background-image: linear-gradient(rgba(0,0,0,var(--rb-overlay,.55)), rgba(0,0,0,var(--rb-overlay,.55))), var(--rb-slide-image, none); background-size: cover; background-position: center; }
.rb-photo-slide > .rb-container { width: 100%; padding: 48px 16px 72px; }
.rb-photo-slide .rb-item { max-width: 680px; background: none; color: inherit; }
.rb-photo-slide .rb-item-title { font-size: var(--rb-h2); }
[data-photo-slides] .rb-slider-controls { position: absolute; right: 16px; bottom: 16px; margin: 0; }
[data-photo-slides] .rb-slider-controls button { color: #ffffff; border-color: rgba(255,255,255,.7); background: rgba(0,0,0,.3); }
[data-photo-slides] .rb-media { padding: 24px 16px 0; }
[data-photo-slides] .rb-media img { margin-inline: auto; }

/* Gallery */
.rb-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-top: 24px; }
.rb-copy > .rb-gallery:first-child { margin-top: 0; }
/* Each picture keeps its own shape (its width and height attributes); a logo is never cropped */
.rb-gallery img { width: 100%; height: auto; object-fit: contain; border-radius: var(--rb-item-radius, 6px); }
.rb-figure { margin: 0; }
.rb-figure figcaption { margin-top: 8px; font-weight: 600; }

/* Booking form (shared markup) */
.booking-section { padding: 64px 0; }
.booking-wrapper { max-width: 680px; margin: 0 auto; padding: 40px 32px; border: 1px solid color-mix(in srgb, var(--rb-page-text) 14%, transparent); border-radius: 16px; background: var(--rb-page-bg); color: var(--rb-page-text); box-shadow: 0 12px 32px rgba(0,0,0,.08); }
.section-tag { display: inline-block; text-transform: uppercase; letter-spacing: .08em; font-size: .8em; font-weight: 700; color: var(--rb-primary); margin-bottom: 8px; }
.section-title { margin: 0 0 8px; }
.section-desc { margin: 0; opacity: .85; }
.booking-form { display: block; }
.form-group { margin-bottom: 20px; }
.form-label { display: block; font-weight: 600; font-size: .9em; margin-bottom: 6px; }
.form-input, .form-select, .form-textarea { width: 100%; min-height: 48px; padding: 12px 14px; font: inherit; color: var(--rb-page-text); background: var(--rb-page-bg); border: 1px solid color-mix(in srgb, var(--rb-page-text) 30%, transparent); border-radius: 8px; }
.form-textarea { min-height: 96px; resize: vertical; }
.form-input:focus, .form-select:focus, .form-textarea:focus { outline: none; border-color: var(--rb-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rb-primary) 25%, transparent); }
.form-checkbox-container { display: flex; align-items: flex-start; gap: 10px; margin: 20px 0; font-size: .85em; }
.form-checkbox { width: 18px; height: 18px; margin-top: 3px; accent-color: var(--rb-primary); flex-shrink: 0; }
.checkbox-label { cursor: pointer; }
.form-submit-btn { width: 100%; min-height: 52px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; border: 0; cursor: pointer; font: inherit; font-weight: 700; background: var(--rb-primary); color: var(--rb-on-primary); border-radius: var(--rb-button-radius); text-transform: var(--rb-button-case); }
.form-submit-btn:hover { filter: brightness(1.08); }
.form-submit-btn:disabled { opacity: .6; cursor: not-allowed; }
.form-success-message { display: none; text-align: center; padding: 32px 16px; }
.success-icon-badge { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; color: var(--rb-primary); background: color-mix(in srgb, var(--rb-primary) 12%, transparent); margin-bottom: 16px; }
.success-title { font-size: 1.4em; margin: 0 0 8px; }
.btn-secondary { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 20px; font: inherit; cursor: pointer; background: transparent; color: inherit; border: 1px solid currentColor; border-radius: var(--rb-button-radius); }

/* Footer */
.rb-footer { padding: 48px 0; border-top: 1px solid color-mix(in srgb, var(--rb-page-text) 14%, transparent); }
.rb-footer > .rb-section { padding-top: 0; }
.rb-footer-title { font-size: 1.25em; }
.rb-footer-contacts ul { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 6px; }
.rb-footer-contacts a { text-decoration: none; }
.rb-footer-contacts a:hover { text-decoration: underline; }
.rb-footer-label { font-weight: 600; }
.rb-social { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 16px; text-transform: capitalize; }
.rb-copyright { font-size: .85em; opacity: .75; margin: 24px 0 0; }

@media (max-width: 900px) {
  .rb-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rb-grid[style="--rb-columns: 1"] { grid-template-columns: minmax(0, 1fr); }
  [data-arrangement=media-beside-text][data-has-media] .rb-container, [data-arrangement=media-beside-text][data-has-media][data-media-side=left] .rb-container { grid-template-columns: minmax(0, 1fr); gap: 32px; }
  .rb-nav { display: none; }
}
@media (max-width: 700px) {
  .rb-grid { grid-template-columns: minmax(0, 1fr); }
  .rb-section { padding: calc(var(--rb-section-pad, 64px) * 0.6) 0; }
  .rb-list .rb-item { grid-template-columns: minmax(0, 1fr); }
  .rb-header-row { min-height: 60px; gap: 12px; }
  .rb-phone { display: none; }
  .rb-track { grid-auto-columns: 85%; }
  .booking-wrapper { padding: 28px 20px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }`;
