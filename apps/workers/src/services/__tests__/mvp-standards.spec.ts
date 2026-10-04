import { describe, expect, it } from 'vitest';
import { MvpStandardsSchema } from '@revamp/validation';
import { checkMvpStandards } from '../mvp-standards.js';

const page = (head: string, body = '<h1>Falco-Dent</h1>') => `<!doctype html><html lang="pl"><head>${head}</head><body>${body}</body></html>`;
const FULL_HEAD = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Falco-Dent</title>
  <meta name="description" content="Stomatologia"><meta property="og:title" content="Falco-Dent"><link rel="icon" href="data:image/svg+xml,x">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Falco-Dent"}</script>`;

describe('checkMvpStandards (REV-118)', () => {
  it('passes every check on a page with all the tags that loads nothing over http, and validates', () => {
    const result = checkMvpStandards(page(FULL_HEAD));
    expect(result.score).toBe(100);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
    expect(() => MvpStandardsSchema.parse(result)).not.toThrow();
  });

  it('scores https as readiness for HTTPS hosting: the page loads nothing over plain http', () => {
    for (const body of [
      '<h1>X</h1><img src="http://falcodent.pl/a.jpg" alt="">',
      '<h1>X</h1><img src="/a.jpg" srcset="https://x/a.jpg 1x, http://x/b.jpg 2x" alt="">',
      '<h1>X</h1><iframe src="http://maps.example/embed"></iframe>',
      '<h1>X</h1><section style="background-image: url(\'http://x/hero.jpg\')"></section>',
      '<h1>X</h1><script src="http://cdn.example/a.js"></script>',
    ]) {
      const result = checkMvpStandards(page(FULL_HEAD, body));
      expect(result.checks.https).toBe(false);
      expect(result.score).toBe(80);
    }
    expect(checkMvpStandards(page(FULL_HEAD + '<style>.h{background:url("http://x/h.jpg")}</style>')).checks.https).toBe(false);
  });

  it('keeps https ready for http links a visitor follows, and for https or relative resources', () => {
    const body = '<h1>X</h1><a href="http://old.example/">Old site</a><img src="https://x/a.jpg" alt=""><img src="data:image/png;base64,AA" alt="">';
    expect(checkMvpStandards(page(FULL_HEAD + '<link rel="canonical" href="http://x/">', body)).checks.https).toBe(true);
  });

  it('leaves the page\'s own tracker out: the API it loads from is deployment config', () => {
    const body = '<h1>X</h1><script src="http://localhost:4000/api/v1/track/revamp-tracker.js" data-api="http://localhost:4000" async></script>';
    expect(checkMvpStandards(page(FULL_HEAD, body)).checks.https).toBe(true);
  });

  it('reads attribute names and values in any case', () => {
    const head = `<META NAME="Viewport" content="width=device-width"><title>X</title><meta name="DESCRIPTION" content="d">
      <meta property="OG:Title" content="X"><link rel="Shortcut Icon" href="/i.png"><div itemtype="HTTPS://Schema.org/Dentist"></div>`;
    expect(checkMvpStandards(page(head)).score).toBe(100);
  });

  it('fails the h1 check on a page with no h1 or two', () => {
    expect(checkMvpStandards(page(FULL_HEAD, '<h2>No h1</h2>')).checks.singleH1).toBe(false);
    expect(checkMvpStandards(page(FULL_HEAD, '<h1>A</h1><h1>B</h1>')).checks.singleH1).toBe(false);
  });

  it('never runs the page scripts: a tag a script would add does not count', () => {
    const head = `<title>X</title><script>document.head.insertAdjacentHTML('beforeend', '<meta name="description" content="late">')</script>`;
    expect(checkMvpStandards(page(head)).checks.metaDescription).toBe(false);
  });

  it('ignores empty tags and JSON-LD without a type', () => {
    const head = `<title> </title><meta name="description" content=" "><meta property="og:title" content="">
      <script type="application/ld+json">{"@context":"https://schema.org"}</script><script type="application/ld+json">{oops</script>`;
    const { checks } = checkMvpStandards(page(head));
    expect(checks).toMatchObject({ title: false, metaDescription: false, openGraph: false, structuredData: false, favicon: false, viewport: false });
  });
});
