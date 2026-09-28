import postcss, { AtRule, Container, CssSyntaxError, Declaration, Rule } from 'postcss';
import { MVP_CUSTOM_CSS_MAX } from '@revamp/validation';

/**
 * Checks the custom CSS an MVP design may carry (REV-93): the fallback for looks the design tokens can't
 * express. It is parsed with PostCSS and accepted only as a whole. It may restyle the page's own elements
 * but never load anything, inject text, hide content or leave the page's own hooks, so the grounded content
 * and the verified contacts stay on the page exactly as the template renders them.
 */

export { MVP_CUSTOM_CSS_MAX };

/** The page's own hooks and classes a selector may target (listed for the model in the edit prompt) */
export const MVP_CSS_HOOKS = [
  '[data-revamp-section="about|services|gallery|reviews|block-1|block-2|block-3"]',
  '[data-revamp-part="hero|services"]',
  '[data-revamp-cta="primary-booking|call|block"]',
  '.site-header',
  '.brand-name',
  '.hero-section',
  '.hero-badge',
  '.hero-headline',
  '.hero-subheadline',
  '.hero-actions',
  '.btn-primary',
  '.btn-secondary',
  '.trust-signals-bar',
  '.trust-badge-item',
  '.section-tag',
  '.section-title',
  '.bento-card',
  '.service-tile',
  '.numbered-service',
  '.review-card',
  '.about-body',
  '.gallery-image',
  '.revamp-block',
  '.revamp-feature',
  '.booking-section',
  '.site-footer',
] as const;

export class UnsafeCssError extends Error {
  constructor(readonly problems: string[]) {
    super(`The custom CSS was not applied: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''}`);
    this.name = 'UnsafeCssError';
  }
}

const ALLOWED_AT_RULES = new Set(['media', 'supports', 'keyframes']);
/** Anything that loads, runs or pulls in something from outside the stylesheet */
const EXTERNAL = /url\(|image\(|image-set\(|element\(|expression\(|javascript:|@import|attr\(|src\(/i;
const DENIED_PROPERTIES = new Set([
  'behavior',
  '-moz-binding',
  'clip',
  'clip-path',
  '-webkit-clip-path',
  'mask',
  'mask-image',
  '-webkit-mask',
  '-webkit-mask-image',
  'src',
]);
const SIZE_PROPERTIES = new Set(['width', 'height', 'max-width', 'max-height', 'font-size', 'line-height']);
/** Elements a selector must never reach: the document itself or things that aren't content */
const FORBIDDEN_ELEMENTS = /(^|[\s>+~(,])(html|body|head|script|style|iframe|template|meta|link|title|noscript)(?![\w-])/i;
const SCOPED = /[.#][a-z_-]|\[\s*data-revamp-/i;
const ZERO = /^[+-]?0*(\.0+)?(px|rem|em|%|vw|vh|vmin|vmax|ch|ex)?$/;

const inKeyframes = (node: Rule): boolean => {
  let parent = node.parent as Container | undefined;
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule' && (parent as AtRule).name.toLowerCase().endsWith('keyframes')) return true;
    parent = parent.parent as Container | undefined;
  }
  return false;
};

function checkSelector(selector: string, problems: string[]): void {
  const s = selector.trim();
  if (s.includes('\\')) problems.push(`escaped selector "${s}"`);
  else if (FORBIDDEN_ELEMENTS.test(s) || /:root\b/i.test(s)) problems.push(`selector "${s}" reaches outside the page content`);
  else if (/\[(?!\s*data-revamp-)/i.test(s)) problems.push(`selector "${s}" uses an attribute other than data-revamp-*`);
  else if (!SCOPED.test(s)) problems.push(`selector "${s}" does not target one of the page's own hooks or classes`);
}

/** A negative offset big enough to move content off the page */
function farOffset(value: string): boolean {
  for (const match of value.matchAll(/-(\d+(?:\.\d+)?)(px|rem|em|vw|vh|%)/g)) {
    const amount = Number(match[1]);
    const unit = match[2];
    if ((unit === 'px' && amount >= 500) || ((unit === 'rem' || unit === 'em') && amount >= 30) || amount >= 100) {
      return true;
    }
  }
  return false;
}

const transparent = (value: string) =>
  value === 'transparent' || /(rgba|hsla)\([^)]*[,/]\s*0(\.0+)?\s*\)/.test(value) || /#[0-9a-f]{6}00\b|#[0-9a-f]{3}0\b/.test(value);

function checkDeclaration(decl: Declaration, rule: Rule | undefined, problems: string[]): void {
  const prop = decl.prop.toLowerCase();
  const value = decl.value.toLowerCase().trim();
  const where = `${prop}: ${decl.value}`;

  if (!rule) {
    problems.push(`"${where}" is outside a rule`);
    return;
  }
  if (value.includes('\\') || decl.prop.includes('\\')) {
    problems.push(`"${where}" uses escapes`);
    return;
  }
  if (EXTERNAL.test(value)) {
    problems.push(`"${where}" loads or injects something from outside the page`);
    return;
  }
  if (DENIED_PROPERTIES.has(prop)) {
    problems.push(`"${prop}" is not allowed`);
    return;
  }

  const keyframe = inKeyframes(rule);
  const selectors = keyframe ? [] : rule.selectors.map((s) => s.toLowerCase());

  if (prop === 'content' && !['""', "''", 'none', 'normal'].includes(value)) {
    problems.push(`"${where}" would add text to the page`);
  }
  if (prop === 'display' && value === 'none') problems.push(`"${where}" hides content`);
  if (prop === 'visibility' && value !== 'visible') problems.push(`"${where}" hides content`);
  if (prop === 'opacity') {
    const opacity = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
    const startFrame = keyframe && ['from', '0%'].includes(rule.selector.trim().toLowerCase());
    if (!Number.isNaN(opacity) && opacity < 0.2 && !startFrame) problems.push(`"${where}" hides content`);
  }
  if ((prop === 'filter' || prop === 'backdrop-filter') && /opacity\(\s*0*(\.[01]\d*)?\s*\)|brightness\(\s*0\s*\)|blur\(\s*([2-9]\d|\d{3,})px/.test(value)) {
    problems.push(`"${where}" hides content`);
  }
  if ((prop === 'color' || prop === '-webkit-text-fill-color') && transparent(value)) {
    // Gradient text clips a background to the glyphs: the only fair use of transparent text
    const clipsToText = rule.nodes.some(
      (node) =>
        node.type === 'decl' &&
        ['background-clip', '-webkit-background-clip'].includes(node.prop.toLowerCase()) &&
        node.value.toLowerCase().trim() === 'text',
    );
    if (!clipsToText) problems.push(`"${where}" hides text`);
  }
  if (SIZE_PROPERTIES.has(prop) && ZERO.test(value)) problems.push(`"${where}" collapses content`);
  if (prop === 'font-size') {
    const size = value.match(/^(\d*\.?\d+)(px|rem|em)$/);
    if (size && ((size[2] === 'px' && Number(size[1]) < 8) || (size[2] !== 'px' && Number(size[1]) < 0.5))) {
      problems.push(`"${where}" makes text unreadable`);
    }
  }
  if (prop === 'position' && (value === 'fixed' || value === 'sticky') && !selectors.every((s) => s.includes('.site-header'))) {
    problems.push(`"${where}" is only allowed on the header`);
  }
  if (prop.startsWith('transform') || prop === 'scale') {
    if (/scale[xyz3d]*\(\s*0*(\.0+)?\s*[,)]/.test(value) || (prop === 'scale' && ZERO.test(value))) {
      problems.push(`"${where}" shrinks content away`);
    }
  }
  if (prop === 'text-indent' && value.startsWith('-')) problems.push(`"${where}" moves text off the page`);
  if (farOffset(value)) problems.push(`"${where}" moves content off the page`);

  // A pseudo-element stretched over its element could cover the content beneath it
  if (selectors.some((s) => /::?(before|after)/.test(s))) {
    const set = (name: string) => rule.nodes.some((node) => node.type === 'decl' && node.prop.toLowerCase() === name);
    const coversHeight = rule.nodes.some(
      (node) => node.type === 'decl' && node.prop.toLowerCase() === 'height' && /^(100%|\d+vh)$/.test(node.value.trim()),
    );
    if (prop === 'content' && (set('inset') || (set('top') && set('bottom')) || coversHeight)) {
      problems.push(`"${rule.selector}" would cover the content beneath it`);
    }
  }
}

/**
 * Returns the custom CSS normalized (comments dropped), or throws `UnsafeCssError` with every problem
 * found. Nothing is dropped silently: one unsafe rule rejects the whole stylesheet.
 */
export function sanitizeMvpCss(css: string): string {
  if (css.length > MVP_CUSTOM_CSS_MAX) {
    throw new UnsafeCssError([`it is ${css.length} characters long; the limit is ${MVP_CUSTOM_CSS_MAX}`]);
  }

  // The CSS is written into a <style> element: "<" could close it and start markup
  if (css.includes('<')) throw new UnsafeCssError(['it contains "<", which could break out of the style element']);

  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    const reason = error instanceof CssSyntaxError ? error.reason : String(error);
    throw new UnsafeCssError([`it is not valid CSS (${reason})`]);
  }

  const problems: string[] = [];
  root.walkComments((comment) => {
    comment.remove();
  });
  root.walk((node) => {
    if (node.type === 'atrule') {
      const name = node.name.toLowerCase().replace(/^-webkit-/, '');
      if (!ALLOWED_AT_RULES.has(name)) {
        problems.push(`"@${node.name}" is not allowed`);
      } else if (EXTERNAL.test(node.params) || node.params.includes('\\')) {
        problems.push(`"@${node.name} ${node.params}" loads something from outside the page`);
      } else if (name === 'keyframes' && !/^[a-z][\w-]*$/i.test(node.params.trim())) {
        problems.push(`"@${node.name} ${node.params}" has an invalid name`);
      }
    } else if (node.type === 'rule') {
      if (inKeyframes(node)) {
        for (const step of node.selectors) {
          if (!/^(from|to|\d{1,3}(\.\d+)?%)$/i.test(step.trim())) problems.push(`keyframe "${step}" is not valid`);
        }
      } else {
        for (const selector of node.selectors) checkSelector(selector, problems);
      }
    } else if (node.type === 'decl') {
      checkDeclaration(node, node.parent?.type === 'rule' ? (node.parent as Rule) : undefined, problems);
    }
  });

  if (problems.length) throw new UnsafeCssError([...new Set(problems)]);
  return root.toString().trim();
}

/** The custom CSS for a render: sanitized again, and left out (never failing the publish) if it no longer passes */
export function renderableCustomCss(css: string | undefined): string {
  if (!css?.trim()) return '';
  try {
    return sanitizeMvpCss(css);
  } catch (error) {
    console.warn(`[MvpTemplate] Custom CSS left out: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}
