import { describe, expect, it } from 'vitest';
import { checkMvpStandards } from '../mvp-standards.js';
import { finishMvpPage, MvpFinishContext } from '../mvp-page-finish.js';
import { withHtmlDocument } from '../html-document.js';
import { VALID } from './fixtures/page-gen/page.js';

const ctx = (over: Partial<MvpFinishContext> = {}): MvpFinishContext => ({
  businessName: 'Falco-Dent',
  language: 'pl',
  services: ['Implanty', 'Ortodoncja'],
  contacts: { phone: '+48 600 100 200', address: 'ul. Długa 5, Kraków', hours: 'Pn–Pt 9–18' },
  seo: { description: 'Gabinet stomatologiczny w Krakowie', image: 'https://falco-dent.pl/a.jpg' },
  logoUrl: 'https://falco-dent.pl/logo.png',
  theme: {
    primary: '#0a5c8a',
    accent: '#f2a900',
    bg: '#ffffff',
    surface: '#f5f7fa',
    text: '#111111',
    fontHeading: '"DM Serif Display", serif',
    fontBody: 'Inter, sans-serif',
  },
  ...over,
});

const read = <T>(html: string, fn: (doc: Document) => T) => withHtmlDocument(html, fn);
const withSeoTags = VALID.replace(
  '<title>',
  '<meta name="Description" content="model text"><meta property="og:title" content="model"><link rel="icon" href="https://falco-dent.pl/logo.png"><title>',
);

describe('finishMvpPage (REV-136)', () => {
  it('fills contact placeholders in text and links', () => {
    const html = finishMvpPage(VALID, ctx());
    expect(html).not.toContain('{{');
    read(html, (doc) => {
      const phone = doc.querySelector('footer a');
      expect(phone?.getAttribute('href')).toBe('tel:+48600100200');
      expect(phone?.textContent).toBe('+48 600 100 200');
      expect(doc.querySelector('footer')?.textContent).toContain('ul. Długa 5, Kraków');
      expect(doc.querySelector('.hero a')?.getAttribute('href')).toBe('#booking');
    });
  });

  it('links an address placeholder to a map search and an email to mailto', () => {
    const page = VALID.replace('<p>{{address}}</p>', '<p><a href="{{address}}">{{address}}</a> <a href="{{email}}">{{email}}</a></p>');
    const html = finishMvpPage(page, ctx({ contacts: { address: 'ul. Długa 5, Kraków', email: 'kontakt@falco-dent.pl' } }));
    read(html, (doc) => {
      const [map, mail] = Array.from(doc.querySelectorAll('footer p:last-child a'));
      expect(map?.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=ul.%20D%C5%82uga%205%2C%20Krak%C3%B3w');
      expect(mail?.getAttribute('href')).toBe('mailto:kontakt@falco-dent.pl');
    });
  });

  it('escapes contact values', () => {
    const html = finishMvpPage(VALID, ctx({ contacts: { phone: '+48 600 100 200', address: '<b>Długa</b> 5' } }));
    expect(html).not.toContain('<b>Długa</b>');
    expect(html).toContain('&lt;b&gt;Długa&lt;/b&gt; 5');
  });

  it("replaces the model's own search tags and icon with the verified ones", () => {
    const html = finishMvpPage(withSeoTags, ctx());
    expect(html).not.toContain('model text');
    expect(html).not.toContain('content="model"');
    read(html, (doc) => {
      expect(doc.querySelectorAll('meta[name="description"]')).toHaveLength(1);
      expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Gabinet stomatologiczny w Krakowie');
      expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://falco-dent.pl/a.jpg');
      expect(doc.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
      expect(doc.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('https://falco-dent.pl/logo.png');
    });
  });

  it('uses a monogram icon when there is no logo', () => {
    const html = finishMvpPage(VALID, ctx({ logoUrl: undefined }));
    read(html, (doc) => expect(doc.querySelector('link[rel="icon"]')?.getAttribute('href')).toMatch(/^data:image\/svg\+xml/));
  });

  it("applies the operator's controls over the model's theme and links a chosen font", () => {
    const html = finishMvpPage(VALID, ctx({ controls: { primary: '#0a0a0a', fontHeading: 'DM Serif Display' } }));
    read(html, (doc) => {
      const controls = doc.querySelector('style#rv-controls')?.textContent ?? '';
      expect(controls).toContain('--rv-color-primary:#0a0a0a');
      expect(controls).toContain('--rv-font-heading:"DM Serif Display"');
      const fonts = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute('href') ?? '');
      expect(fonts.filter((href) => href.includes('family=DM+Serif+Display:wght@400;600;700'))).toHaveLength(1);
      // After the model's own styles, so it wins
      const styles = Array.from(doc.querySelectorAll('head style')).map((s) => s.id);
      expect(styles.indexOf('rv-controls')).toBe(styles.length - 1);
    });
  });

  it('adds no controls style when there are no controls', () => {
    expect(finishMvpPage(VALID, ctx())).not.toContain('rv-controls');
  });

  it('adds the booking form once, at the end of main, with the services as options', () => {
    const html = finishMvpPage(VALID, ctx());
    read(html, (doc) => {
      expect(doc.querySelectorAll('#booking')).toHaveLength(1);
      expect(doc.querySelector('main')?.lastElementChild?.id).toBe('booking');
      const options = Array.from(doc.querySelectorAll('#booking option')).map((o) => o.textContent);
      expect(options).toEqual(expect.arrayContaining(['Implanty', 'Ortodoncja']));
      expect(doc.querySelector('style#rv-booking')).not.toBeNull();
    });
  });

  it('puts the booking form before the footer when the page has no main', () => {
    const page = VALID.replace('<main>', '<div class="content">').replace('</main>', '</div>');
    read(finishMvpPage(page, ctx()), (doc) => {
      expect(doc.querySelector('footer')?.previousElementSibling?.id).toBe('booking');
    });
  });

  it('adds the tracker only when the API is configured', () => {
    expect(finishMvpPage(VALID, ctx())).not.toContain('revamp-tracker.js');
    const html = finishMvpPage(VALID, ctx({ publicApiUrl: 'https://api.revamp.test/api/v1', trackingToken: 'tok' }));
    expect(html).toContain('https://api.revamp.test/api/v1/track/revamp-tracker.js');
    expect(html).toContain('data-token="tok"');
  });

  it('gives the booking button readable text on the primary color', () => {
    expect(finishMvpPage(VALID, ctx())).toContain('--rv-on-primary:#ffffff');
    expect(finishMvpPage(VALID, ctx({ controls: { primary: '#f2e600' } }))).toContain('--rv-on-primary:#111111');
  });

  it('is deterministic and yields a page that passes the standards checks', () => {
    const html = finishMvpPage(VALID, ctx());
    expect(finishMvpPage(VALID, ctx())).toBe(html);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    const { checks } = checkMvpStandards(html);
    expect(checks.singleH1).toBe(true);
    expect(checks.metaDescription).toBe(true);
    expect(checks.favicon).toBe(true);
    expect(checks.openGraph).toBe(true);
  });
});
