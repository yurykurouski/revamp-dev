import { describe, expect, it } from 'vitest';
import { checkMvpPage } from '../mvp-page-check.js';
import { BRIEF, VALID } from './fixtures/page-gen/page.js';



const codes = (html: string, brief = BRIEF) => checkMvpPage(html, brief).problems.map((p) => p.code);
const swap = (from: string, to: string) => {
  expect(VALID).toContain(from);
  return VALID.replace(from, to);
};
const inBody = (html: string) => swap('<p>{{address}}</p>', `<p>{{address}}</p>${html}`);

describe('checkMvpPage (REV-136)', () => {
  it('accepts the valid page and reads its theme', () => {
    const result = checkMvpPage(VALID, BRIEF);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.theme).toEqual({
      primary: '#0a5c8a',
      accent: '#f2a900',
      bg: '#ffffff',
      surface: '#f5f7fa',
      text: '#111111',
      fontHeading: '"DM Serif Display", serif',
      fontBody: 'Inter, sans-serif',
    });
  });

  describe('page:parse', () => {
    it('rejects prose before the doctype', () => {
      expect(codes(`Here is your page:\n${VALID}`)).toEqual(['page:parse']);
    });
    it('rejects a code fence around the page', () => {
      expect(codes('```html\n' + VALID + '\n```')).toEqual(['page:parse']);
    });
    it('rejects a page over 300 KB', () => {
      const pad = 'x'.repeat(300_001 - Buffer.byteLength(VALID, 'utf8') + 20);
      expect(codes(inBody(`<!-- ${pad} -->`))).toEqual(['page:parse']);
    });
  });

  describe('page:script', () => {
    it.each([
      ['a script element', inBody('<script>alert(1)</script>')],
      ['an event handler', swap('<h1>', '<h1 onclick="x()">')],
      ['a javascript: link', inBody('<a href=" javascript:alert(1)">x</a>')],
      ['a form', inBody('<form><input></form>')],
      ['an iframe', inBody('<iframe src="https://x.com"></iframe>')],
      ['a meta refresh', swap('<meta charset="UTF-8">', '<meta charset="UTF-8"><meta http-equiv="Refresh" content="0;url=https://x.com">')],
    ])('rejects %s', (_name, html) => {
      expect(codes(html)).toEqual(['page:script']);
    });
  });

  it('page:external rejects a stylesheet from another host', () => {
    expect(codes(swap('<style>', '<link rel="stylesheet" href="https://cdn.example.com/x.css"><style>'))).toEqual(['page:external']);
  });

  it('rejects a video as an element the page may not have', () => {
    expect(codes(inBody('<video src="https://falco-dent.pl/a.mp4"></video>'))).toEqual(['page:script']);
  });

  it('page:image rejects an image that is not the site\'s', () => {
    expect(codes(inBody('<img src="https://images.unsplash.com/x.jpg" alt="">'))).toEqual(['page:image']);
  });

  it('page:image rejects an unlisted srcset entry', () => {
    expect(codes(swap('b@2x.jpg 2x', 'b@3x.jpg 3x'))).toEqual(['page:image']);
  });

  it('page:image rejects a data: image', () => {
    expect(codes(inBody('<img src="data:image/png;base64,AA" alt="">'))).toEqual(['page:image']);
  });

  it('page:css rejects @import in a style block', () => {
    expect(codes(swap('<style>', '<style>@import url(https://x.com/a.css);'))).toEqual(['page:css']);
  });

  it('page:css rejects an unlisted url() in a style attribute', () => {
    expect(codes(inBody('<div style="background:url(https://x.com/a.jpg)"></div>'))).toEqual(['page:css']);
  });

  it('page:theme rejects a :root without the body font', () => {
    expect(codes(swap('--rv-font-body: Inter, sans-serif;', ''))).toEqual(['page:theme']);
  });

  describe('page:placeholder', () => {
    it.each([
      ['spaces inside the braces', '{{ phone }}'],
      ['a capitalized name', '{{Phone}}'],
      ['an unknown name', '{{tel}}'],
      ['a contact that is not verified', '{{email}}'],
      ['booking in text', '{{booking}}'],
    ])('rejects %s', (_name, placeholder) => {
      expect(codes(inBody(`<p>${placeholder}</p>`))).toEqual(['page:placeholder']);
    });
    it('rejects a placeholder in an attribute other than href', () => {
      expect(codes(inBody('<img src="{{phone}}" alt="">'))).toContain('page:placeholder');
    });
    it('rejects the reserved booking id', () => {
      expect(codes(inBody('<div id="booking"></div>'))).toEqual(['page:placeholder']);
    });
  });

  describe('page:contact', () => {
    it.each([
      ['a phone number in text', '<p>+48 600 100 200</p>'],
      ['a tel: link under a placeholder label', '<a href="tel:+48600100200">{{phone}}</a>'],
      ['an email address', '<p>kontakt@falco-dent.pl</p>'],
      ['a mailto: link', '<a href="mailto:x@y.pl">Napisz</a>'],
    ])('rejects %s', (_name, html) => {
      expect(codes(inBody(html))).toEqual(['page:contact']);
    });
    it('accepts short numbers such as years and prices', () => {
      expect(codes(inBody('<p>Od 2004 roku, wizyta od 150 zł, 9:00–18:00</p>'))).toEqual([]);
    });
  });

  it('page:h1 rejects a second h1', () => {
    expect(codes(inBody('<h1>Druga</h1>'))).toEqual(['page:h1']);
  });

  it('page:h1 rejects a page without an h1', () => {
    expect(codes(swap('<h1>Twój uśmiech, nasza pasja</h1>', '<h2>Twój uśmiech, nasza pasja</h2>'))).toEqual(['page:h1']);
  });

  it('page:lang rejects a page in another language than the brief', () => {
    expect(codes(swap('<html lang="pl">', '<html lang="en">'))).toEqual(['page:lang']);
  });

  it('page:lang expects English when the brief has no language', () => {
    const brief = { ...BRIEF, language: undefined };
    expect(codes(VALID, brief)).toEqual(['page:lang']);
    expect(codes(swap('<html lang="pl">', '<html lang="en-GB">'), brief)).toEqual([]);
  });

  describe('review regressions: parser differences and hidden script', () => {
    it.each([
      ['a noscript whose attribute closes it in a browser', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>'],
      ['declarative shadow DOM', '<template shadowrootmode="open"><img src=x onerror=alert(1)></template>'],
      ['a template', '<template><p>x</p></template>'],
      ['xmp', '<xmp><img src=x onerror=alert(1)></xmp>'],
      ['math', '<math><mi>x</mi></math>'],
      ['an svg animate that sets a javascript: href', '<svg><a><animate attributeName="href" values="#a;javascript:alert(1)"/><text>x</text></a></svg>'],
      ['an svg foreignObject', '<svg><foreignObject><p>x</p></foreignObject></svg>'],
      ['an input', '<input type="image" src="https://falco-dent.pl/a.jpg">'],
      ['a meta http-equiv', '<meta http-equiv="set-cookie" content="a=b">'],
    ])('rejects %s', (_name, html) => {
      expect(codes(inBody(html))).toContain('page:script');
    });

    it.each([
      ['a tab inside javascript:', '<a href="java&#9;script:alert(1)">x</a>'],
      ['a control character before javascript:', '<a href="&#1;javascript:alert(1)">x</a>'],
      ['a newline inside javascript:', '<a href="java\nscript:alert(1)">x</a>'],
      ['a data: link', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
      ['a blob: link', '<a href="blob:https://x/1">x</a>'],
    ])('rejects %s', (_name, html) => {
      expect(codes(inBody(html))).toContain('page:script');
    });

    it('accepts ordinary links: anchors, https and relative paths', () => {
      expect(codes(inBody('<a href="#uslugi">a</a><a href="https://facebook.com/falco">b</a><a href="/kontakt">c</a>'))).toEqual([]);
    });

    it.each([
      ['an svg feImage', '<svg><filter id="f"><feImage href="https://evil.example/x.png"/></filter></svg>'],
      ['a table background attribute', '<table background="https://evil.example/x.png"><tr><td>x</td></tr></table>'],
      ['a body-level ping', '<a href="#a" ping="https://evil.example/p">x</a>'],
      ['an svg fill pointing outside', '<svg><rect width="1" height="1" fill="url(https://evil.example/x.svg#p)"/></svg>'],
      ['an svg use pointing outside', '<svg><use href="https://evil.example/s.svg#i"/></svg>'],
    ])('rejects %s', (_name, html) => {
      expect(codes(inBody(html)).some((c) => ['page:script', 'page:external', 'page:image'].includes(c))).toBe(true);
    });

    it('accepts a safe inline svg icon with a gradient and an internal reference', () => {
      const svg = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0h24v24H0z" fill="url(#g)" stroke="currentColor" stroke-width="2"/><use href="#g"/></svg>';
      expect(codes(inBody(svg))).toEqual([]);
    });

    it('rejects a comment that hides markup', () => {
      expect(codes(inBody('<!--><img src=x onerror=alert(1)>-->'))).toContain('page:script');
    });
  });

  describe('review regressions: contacts and placeholders', () => {
    it.each([
      ['in CSS content', '<style>.c::after{content:"Tel. +48 600 100 200"}</style>'],
      ['in an alt attribute', '<img src="https://falco-dent.pl/a.jpg" alt="Tel. +48 600 100 200">'],
      ['in an aria-label', '<a href="{{phone}}" aria-label="kontakt@falco-dent.pl">x</a>'],
      ['written with dots', '<p>Tel. 600.100.200</p>'],
    ])('rejects a contact %s', (_name, html) => {
      expect(codes(inBody(html))).toContain('page:contact');
    });

    it.each([
      ['NIP', '<p>NIP 677-123-45-67</p>'],
      ['REGON', '<p>REGON: 123456785</p>'],
      ['KRS', '<p>KRS 0000123456</p>'],
      ['an IBAN', '<p>Konto: PL61 1090 1014 0000 0712 1981 2874</p>'],
      ['a date', '<p>12.10.2024</p>'],
    ])('accepts %s', (_name, html) => {
      expect(codes(inBody(html))).toEqual([]);
    });

    it.each([
      ['a placeholder split across elements', '<p>{{<b></b>phone}}</p>'],
      ['triple braces', '<p>{{{phone}}}</p>'],
      ['a placeholder in CSS', '<style>.c::after{content:"{{phone}}"}</style>'],
    ])('rejects %s', (_name, html) => {
      expect(codes(inBody(html))).toContain('page:placeholder');
    });
  });

  it('reports every problem on a page that has several', () => {
    const html = swap('<html lang="pl">', '<html lang="en">').replace('<p>{{address}}</p>', '<p>{{address}}</p><script></script>');
    expect(new Set(codes(html))).toEqual(new Set(['page:lang', 'page:script']));
    expect(checkMvpPage(html, BRIEF).ok).toBe(false);
    expect(checkMvpPage(html, BRIEF).theme).toBeUndefined();
  });
});
