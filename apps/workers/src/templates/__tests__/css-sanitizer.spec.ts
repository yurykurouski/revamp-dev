import { describe, it, expect, vi } from 'vitest';
import { MVP_CUSTOM_CSS_MAX, REBUILD_CSS_HOOKS, UnsafeCssError, renderableCustomCss, sanitizeMvpCss } from '../css-sanitizer.js';

const problemsOf = (css: string): string[] => {
  try {
    sanitizeMvpCss(css);
  } catch (error) {
    if (error instanceof UnsafeCssError) return error.problems;
    throw error;
  }
  return [];
};

describe('sanitizeMvpCss (REV-93)', () => {
  describe('accepts looks the design tokens cannot express', () => {
    it.each([
      [
        'gradient headline text',
        `.hero-headline { background: linear-gradient(90deg, var(--brand-primary), var(--brand-accent)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent !important; }`,
      ],
      [
        'a hover tilt on service cards',
        `.bento-card, .service-tile { transition: transform .3s ease; } .bento-card:hover, .service-tile:hover { transform: rotate(-1.5deg) translateY(-4px); }`,
      ],
      [
        'an accent line under section titles',
        `.section-title::after { content: ""; display: block; width: 3rem; height: 3px; margin: .75rem auto 0; background: var(--brand-primary); border-radius: 2px; }`,
      ],
      [
        'a responsive tweak',
        `@media (min-width: 900px) { [data-revamp-section="reviews"] .review-card { border-left: 4px solid var(--brand-accent); } }`,
      ],
      [
        'a fade-in animation',
        `@keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } } .hero-headline { animation: rise .6s ease both; }`,
      ],
      ['a sticky header', `.site-header { position: sticky; top: 0; }`],
      ['a hook with an id', `#booking .btn-primary { letter-spacing: .04em; }`],
    ])('%s', (_label, css) => {
      expect(problemsOf(css)).toEqual([]);
    });

    it('drops comments and returns the normalized CSS', () => {
      expect(sanitizeMvpCss('/* note */ .hero-badge { color: var(--brand-accent); }')).toBe(
        '.hero-badge { color: var(--brand-accent); }',
      );
    });
  });

  describe('rejects the whole stylesheet for', () => {
    it.each([
      ['a url()', `.hero-section { background: url(https://evil.example/x.png); }`, 'loads or injects'],
      ['image-set()', `.hero-section { background-image: image-set("x.png" 1x); }`, 'loads or injects'],
      ['@import', `@import "https://evil.example/x.css"; .hero-badge { color: red; }`, '"@import" is not allowed'],
      ['@font-face', `@font-face { font-family: X; src: local(Arial); } .hero-badge { color: red; }`, '"@font-face" is not allowed'],
      ['expression()', `.hero-badge { width: expression(alert(1)); }`, 'loads or injects'],
      ['behavior', `.hero-badge { behavior: something; }`, '"behavior" is not allowed'],
      ['-moz-binding', `.hero-badge { -moz-binding: none; }`, 'is not allowed'],
      ['text through content', `.hero-headline::before { content: "Best in town"; }`, 'would add text'],
      ['attr() content', `.hero-headline::before { content: attr(title); }`, 'loads or injects'],
      ['display:none', `[data-revamp-section="reviews"] { display: none; }`, 'hides content'],
      ['visibility:hidden', `.site-footer { visibility: hidden; }`, 'hides content'],
      ['opacity 0', `.site-footer { opacity: 0; }`, 'hides content'],
      ['opacity 5%', `.site-footer { opacity: 5%; }`, 'hides content'],
      ['a filter to nothing', `.site-footer { filter: opacity(0); }`, 'hides content'],
      ['transparent text without a clipped background', `.site-footer { color: transparent; }`, 'hides text'],
      ['zero height', `.booking-section { height: 0; overflow: hidden; }`, 'collapses content'],
      ['a tiny font', `.site-footer { font-size: 2px; }`, 'unreadable'],
      ['scale(0)', `.site-footer { transform: scale(0); }`, 'shrinks content away'],
      ['clip-path', `.site-footer { clip-path: inset(50%); }`, '"clip-path" is not allowed'],
      ['mask', `.site-footer { mask-image: linear-gradient(transparent, transparent); }`, 'is not allowed'],
      ['a far negative offset', `.site-footer { margin-left: -9999px; }`, 'moves content off the page'],
      ['a negative text-indent', `.hero-headline { text-indent: -200px; }`, 'moves text off the page'],
      ['a fixed element other than the header', `.btn-primary { position: fixed; bottom: 0; }`, 'only allowed on the header'],
      ['an overlay pseudo-element', `.booking-section::after { content: ""; position: absolute; inset: 0; background: #000; }`, 'cover the content'],
      ['body', `body { background: #000; }`, 'outside the page content'],
      [':root', `:root { --brand-primary: red; }`, 'outside the page content'],
      ['html', `html .hero-badge { color: red; }`, 'outside the page content'],
      ['an unscoped selector', `h1 { color: red; }`, 'does not target'],
      ['the universal selector alone', `* { color: red; }`, 'does not target'],
      ['another attribute', `a[href^="tel:"] { display: inline; }`, 'attribute other than data-revamp'],
      ['escapes', `.hero-badge { background: u\\72l(x.png); }`, 'escapes'],
      ['a style-closing tag', `.hero-badge { font-family: "</style><script>alert(1)</script>"; }`, 'break out of the style element'],
      ['invalid CSS', `.hero-badge { color: red; `, 'not valid CSS'],
      ['a declaration outside a rule', `color: red;`, 'is outside a rule'],
      ['an unknown at-rule', `@page { margin: 0; }`, '"@page" is not allowed'],
      ['a bad keyframe step', `@keyframes x { middle { opacity: 1; } }`, 'keyframe "middle"'],
    ])('%s', (_label, css, message) => {
      const problems = problemsOf(css);
      expect(problems.join(' | ')).toContain(message);
    });

    it('CSS over the size limit', () => {
      const css = `.hero-badge { color: red; }`.repeat(Math.ceil((MVP_CUSTOM_CSS_MAX + 1) / 27));
      expect(problemsOf(css)[0]).toContain(`the limit is ${MVP_CUSTOM_CSS_MAX}`);
    });

    it('any one unsafe rule among safe ones, naming it', () => {
      expect(() => sanitizeMvpCss(`.hero-badge { color: red; } .site-footer { display: none; }`)).toThrow(
        'The custom CSS was not applied: "display: none" hides content',
      );
    });
  });

  describe('renderableCustomCss', () => {
    it('renders CSS that passes and leaves out CSS that no longer does, without failing', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(renderableCustomCss('.hero-badge { color: red; }')).toBe('.hero-badge { color: red; }');
      expect(renderableCustomCss('.site-footer { display: none; }')).toBe('');
      expect(renderableCustomCss(undefined)).toBe('');
      expect(renderableCustomCss('   ')).toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });
});

describe('sanitizeMvpCss on the rebuilt page (REV-111)', () => {
  it('accepts the rebuild hooks, a section by its data-revamp-section hook, and a sticky .rb-header', () => {
    expect(() => sanitizeMvpCss('[data-revamp-section="s-1"] .rb-heading { color: var(--rb-primary); }')).not.toThrow();
    expect(() => sanitizeMvpCss('.rb-header { position: sticky; top: 0; }')).not.toThrow();
    for (const hook of REBUILD_CSS_HOOKS) {
      const selector = hook.replace('<index>', '2');
      expect(() => sanitizeMvpCss(`${selector} { letter-spacing: .02em; }`), selector).not.toThrow();
    }
  });

  it('still refuses another fixed element and attributes outside data-revamp-*', () => {
    expect(() => sanitizeMvpCss('.rb-section { position: fixed; }')).toThrow(UnsafeCssError);
    expect(() => sanitizeMvpCss('.rb-section[data-kind="about"] { color: red; }')).toThrow(UnsafeCssError);
  });
});
