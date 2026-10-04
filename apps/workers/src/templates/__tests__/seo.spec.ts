import { describe, expect, it } from 'vitest';
import { localBusinessJsonLd, seoHeadTags } from '../shared/seo.js';

describe('seoHeadTags (REV-118)', () => {
  it('writes the description, OpenGraph and LocalBusiness JSON-LD', () => {
    const html = seoHeadTags(
      {
        description: 'Stomatologia "estetyczna" & więcej',
        image: 'https://falcodent.pl/og.jpg',
        locale: 'pl_PL',
        localBusiness: { name: 'Falco-Dent', telephone: '+48 510', sameAs: ['https://facebook.com/falcodent'] },
      },
      'Falco-Dent',
    );
    expect(html).toContain('<meta name="description" content="Stomatologia &quot;estetyczna&quot; &amp; więcej">');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:title" content="Falco-Dent">');
    expect(html).toContain('<meta property="og:description" content="Stomatologia &quot;estetyczna&quot; &amp; więcej">');
    expect(html).toContain('<meta property="og:image" content="https://falcodent.pl/og.jpg">');
    expect(html).toContain('<meta property="og:locale" content="pl_PL">');
    expect(html).toContain('<meta property="og:site_name" content="Falco-Dent">');
    const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(json)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Falco-Dent',
      telephone: '+48 510',
      sameAs: ['https://facebook.com/falcodent'],
    });
  });

  it('leaves out every tag without a value', () => {
    const html = seoHeadTags({}, 'Falco-Dent');
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('og:locale');
    expect(html).not.toContain('ld+json');
    expect(html).toContain('og:title');
  });

  it('takes a description given for the page over the grounded one', () => {
    expect(seoHeadTags({}, 'X', 'Hero copy')).toContain('<meta name="description" content="Hero copy">');
  });
});

describe('localBusinessJsonLd (REV-118)', () => {
  it('never lets the text close the script element, and parses back to the same value', () => {
    const json = localBusinessJsonLd({ name: 'Bad </script><script>alert(1)</script>', sameAs: [] });
    expect(json).not.toContain('<');
    expect(JSON.parse(json).name).toBe('Bad </script><script>alert(1)</script>');
    expect(JSON.parse(json)).not.toHaveProperty('sameAs');
  });
});
