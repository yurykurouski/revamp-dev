import { describe, expect, it } from 'vitest';
import { checkPageCss, readMvpTheme } from '../mvp-page-css.js';
import { withHtmlDocument } from '../html-document.js';

const PHOTO = 'https://falco-dent.pl/a.jpg';
const allowed = new Set([PHOTO]);

const PAGE_CSS = `
:root { --rv-color-primary: #0a5c8a; --rv-font-body: Inter, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--rv-font-body); }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); }
header { position: sticky; top: 0; }
.nav-mobile { display: none; }
.hero { background: url("${PHOTO}") center / cover no-repeat; }
@media (max-width: 720px) { .nav-mobile { display: block; } .nav { display: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
`;

describe('checkPageCss (REV-136)', () => {
  it('accepts a whole page stylesheet with :root, element selectors, hidden menus and an allowed photo', () => {
    expect(checkPageCss(PAGE_CSS, allowed)).toEqual([]);
  });

  it.each([
    ['@import', '@import url(x.css);'],
    ['@font-face', '@font-face { font-family: X; src: url(x.woff2); }'],
    ['an unlisted url()', '.a { background: url(https://other.com/x.png); }'],
    ['a data: url()', '.a { background: url(data:image/png;base64,AA); }'],
    ['expression()', '.a { width: expression(1); }'],
    ['behavior', '.a { behavior: url(x.htc); }'],
    ['-moz-binding', '.a { -moz-binding: url(x); }'],
    ['an escape', '.a::before { content: "\\3c"; }'],
    ['javascript:', '.a { background: javascript:alert(1); }'],
    ['"<"', '.a { content: "</style><script>"; }'],
    ['broken CSS', '.a { color: red'],
  ])('reports %s', (_name, css) => {
    expect(checkPageCss(css, allowed)).toHaveLength(1);
  });
});

describe('readMvpTheme (REV-136)', () => {
  it('reads the last value of each theme variable from :root rules across blocks', () => {
    const theme = readMvpTheme([
      ':root{--rv-color-primary:#123456;--rv-font-body:"Inter",sans-serif}',
      ':root{--rv-color-primary:#654321}',
      '.hero{--rv-color-accent:#ff0000}',
    ]);
    expect(theme).toEqual({ primary: '#654321', fontBody: '"Inter",sans-serif' });
  });

  it('ignores a :root inside an at-rule, such as a dark-mode variant (review, REV-137)', () => {
    expect(readMvpTheme([':root{--rv-color-bg:#ffffff}@media (prefers-color-scheme: dark){:root{--rv-color-bg:#000000}}'])).toEqual({ bg: '#ffffff' });
  });

  it('ignores blocks that do not parse', () => {
    expect(readMvpTheme(['.a{', ':root{--rv-color-text:#111111}'])).toEqual({ text: '#111111' });
  });
});

describe('withHtmlDocument (REV-136)', () => {
  it('parses without running scripts', () => {
    const title = withHtmlDocument('<!doctype html><html><head><title>T</title></head><body><script>document.title="X"</script></body></html>', (doc) => doc.title);
    expect(title).toBe('T');
  });
});
