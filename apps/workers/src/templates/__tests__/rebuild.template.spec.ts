import { describe, expect, it } from 'vitest';
import { SITE_SECTION_ARRANGEMENTS } from '@revamp/shared-types';
import type { IRebuildPlan, IRebuildSection } from '@revamp/shared-types';
import { renderRebuild } from '../rebuild/index.js';

const item = (title: string) => ({ title, subtitle: 'Rola', text: [`O ${title}`], image: { src: `https://x.pl/${title}.jpg`, alt: title }, price: 'od 150 zł', rating: 5, links: [] });
const section = (index: number, over: Partial<IRebuildSection> = {}): IRebuildSection => ({
  id: `s-${index}`, index, kind: 'other', arrangement: 'text', headingLevel: 2,
  intro: { heading: `Sekcja ${index}`, text: [`Tekst ${index}`], links: [] },
  items: [], extra: [], images: [], embeds: [], booking: false, collapsed: false,
  style: { text: '#111111', align: 'left', paddingY: 64, fullBleed: false }, ...over,
});
const plan = (sections: IRebuildSection[], over: Partial<IRebuildPlan> = {}): IRebuildPlan => ({
  language: 'pl', businessName: 'Falco-Dent', year: 2026,
  theme: { primary: '#0e7490', onPrimary: '#ffffff', pageBackground: '#ffffff', pageText: '#111111', headingFont: 'serif', bodyFont: 'sans-serif',
    headingWeight: 700, headingUppercase: false, h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, buttonRadius: 6, buttonUppercase: false },
  header: { nav: [{ label: 'Zespół', href: '#s-2' }], cta: { label: 'Umów wizytę' }, phone: '+48 510 510 706' },
  sections, bookingAppended: true, bookingServices: ['Implanty'],
  footer: { contacts: { phone: '+48 510 510 706', email: 'a@b.pl', address: 'ul. X 1' }, social: [{ label: 'facebook', href: 'https://facebook.com/x' }] },
  summary: { coverage: 1, sections: sections.length, omitted: [], tuning: [] },
  ...over,
});

describe('renderRebuild (REV-110)', () => {
  it('renders every arrangement with its items', () => {
    for (const arrangement of SITE_SECTION_ARRANGEMENTS) {
      const html = renderRebuild(plan([section(1, { arrangement, columns: 3, items: [item('Anna'), item('Jan')] })]));
      expect(html, arrangement).toContain(`data-arrangement="${arrangement}"`);
      if (arrangement !== 'embed') {
        expect(html, arrangement).toContain('Anna');
        expect(html, arrangement).toContain('Jan');
      }
    }
  });

  it('keeps the section order, anchors and heading levels', () => {
    const html = renderRebuild(plan([section(1, { headingLevel: 1, intro: { heading: 'Hero', text: [], links: [] } }), section(2), section(3)]));
    expect(html.indexOf('id="s-1"')).toBeLessThan(html.indexOf('id="s-2"'));
    expect(html.indexOf('id="s-2"')).toBeLessThan(html.indexOf('id="s-3"'));
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('<h2 class="rb-heading">Sekcja 2</h2>');
  });

  it('renders a hidden h1 when the plan asks', () => {
    const html = renderRebuild(plan([section(1)], { hiddenH1: 'Falco-Dent' }));
    expect(html).toMatch(/<h1 class="rb-visually-hidden">Falco-Dent<\/h1>/);
  });

  it('renders every item field only when present', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'card-grid', items: [item('Anna'), { text: ['Sam tekst'], links: [] }] })]));
    expect(html).toContain('od 150 zł');
    expect(html).toContain('aria-label="5/5"');
    expect(html).toContain('alt="Anna"');
    expect(html).toContain('Sam tekst');
  });

  it('escapes original text', () => {
    const html = renderRebuild(plan([section(1, { intro: { heading: '<script>alert(1)</script>', text: ['"quoted" & <b>'], links: [] } })]));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
  });

  it('puts the booking form in place of a form, else before the footer', () => {
    const inPlace = renderRebuild(plan([section(1), section(2, { booking: true }), section(3)], { bookingAppended: false }));
    expect(inPlace.indexOf('id="booking"')).toBeGreaterThan(inPlace.indexOf('id="s-2"'));
    expect(inPlace.indexOf('id="booking"')).toBeLessThan(inPlace.indexOf('id="s-3"'));
    const appended = renderRebuild(plan([section(1)]));
    expect(appended.indexOf('id="booking"')).toBeLessThan(appended.indexOf('<footer'));
    expect(appended.match(/id="booking"/g)).toHaveLength(1);
    expect(appended).toContain('<option value="Implanty">Implanty</option>');
  });

  it('collapses a long section into details and renders an accordion natively', () => {
    const html = renderRebuild(plan([section(1, { collapsed: true }), section(2, { arrangement: 'accordion', items: [{ title: 'Pytanie?', text: ['Odpowiedź'], links: [] }] })]));
    expect(html).toContain('<h2 class="rb-heading">Sekcja 1</h2><details class="rb-collapsed"><summary>Czytaj więcej</summary><p>Tekst 1</p>');
    expect(html).toContain('<summary class="rb-item-title">Pytanie?</summary>');
  });

  it('renders an allowed iframe lazily with a title', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'embed', embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1', title: 'Mapa' }] })]));
    expect(html).toContain('<iframe src="https://www.google.com/maps/embed?pb=1" title="Mapa" loading="lazy"');
  });

  it('lazy-loads all but eager images and sets their size', () => {
    const html = renderRebuild(plan([section(1, { images: [{ src: 'https://x.pl/a.jpg', alt: '', width: 800, height: 600, eager: true }, { src: 'https://x.pl/b.jpg', alt: '' }] })]));
    expect(html).toContain('<img src="https://x.pl/a.jpg" alt="" width="800" height="600" decoding="async">');
    expect(html).toContain('<img src="https://x.pl/b.jpg" alt="" loading="lazy" decoding="async">');
  });

  it('never stretches an image past the width it had on the original page', () => {
    const html = renderRebuild(plan([section(1, { images: [{ src: 'https://x.pl/separator.png', alt: '', width: 45, height: 141 }],
      arrangement: 'card-grid', items: [{ text: ['Ikona'], image: { src: 'https://x.pl/icon.png', alt: '', width: 32, height: 32 }, links: [] }] })]));
    expect(html).toContain('width="45" height="141"');
    // The width attribute holds the original width and `img { max-width: 100% }` caps it at the column
    expect(html).toContain('img { max-width: 100%; height: auto; display: block; }');
    expect(html).not.toMatch(/\.rb-media img \{[^}]*\bwidth: 100%/);
    expect(html).not.toMatch(/\.rb-item-image \{[^}]*\bwidth: 100%/);
    // A narrower image sits in the middle of a centered section or card (Falco-Dent's team)
    expect(html).toMatch(/\[data-align=center\] \.rb-item-image[^{]*\{ margin-inline: auto; \}/);
  });

  it('renders the header nav, CTA and phone, and the footer contacts', () => {
    const html = renderRebuild(plan([section(1)]));
    expect(html).toContain('<a class="rb-nav-link" href="#s-2">Zespół</a>');
    expect(html).toContain('<a class="rb-cta" href="#booking">Umów wizytę</a>');
    expect(html).toContain('href="tel:+48510510706"');
    expect(html).toContain('href="mailto:a@b.pl"');
    expect(html).toContain('© 2026 Falco-Dent');
  });

  it('sets the tuned theme as CSS variables and no external font', () => {
    const html = renderRebuild(plan([section(1)]));
    expect(html).toContain('--rb-primary: #0e7490');
    expect(html).toContain('--rb-body-size: 16px');
    expect(html).not.toMatch(/fonts\.googleapis|@import/);
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<html lang="pl">');
  });

  it('draws an overlay over a background photo', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'banner', style: { backgroundImage: 'https://x.pl/h.jpg', overlay: 0.55, text: '#ffffff', align: 'center', paddingY: 96, fullBleed: true } })]));
    expect(html).toContain('--rb-overlay: 0.55');
    expect(html).toContain("--rb-bg-image: url('https://x.pl/h.jpg')");
  });

  it('renders every heading, title and text of a Falco-Dent-shaped plan', () => {
    const sections = [
      section(1, { arrangement: 'slider', headingLevel: 1, items: ['Nakładki', 'Estetyka', 'Laser', 'Medycyna'].map(item) }),
      section(2, { kind: 'reviews', arrangement: 'slider', items: ['Agi', 'Marta', 'Katarzyna'].map(item) }),
      section(6, { kind: 'features', arrangement: 'card-grid', columns: 4, items: Array.from({ length: 8 }, (_, i) => item(`Cecha${i}`)) }),
      section(8, { kind: 'team', arrangement: 'card-grid', columns: 3, items: Array.from({ length: 10 }, (_, i) => item(`Lekarz${i}`)) }),
      section(9, { kind: 'gallery', arrangement: 'gallery', images: [{ src: 'https://x.pl/g.jpg', alt: '' }] }),
      section(11, { collapsed: true, intro: { heading: 'REGULAMIN', text: ['x'.repeat(1500)], links: [] } }),
    ];
    const p = plan(sections);
    const html = renderRebuild(p);
    const strings = p.sections.flatMap((s) => [s.intro.heading, ...s.intro.text, ...s.items.flatMap((i) => [i.title, i.subtitle, ...i.text])]);
    for (const text of strings.filter((x): x is string => Boolean(x))) expect(html).toContain(text);
  });
  it('escapes quotes and javascript: text in attributes and copy', () => {
    const html = renderRebuild(
      plan([
        section(1, {
          arrangement: 'card-grid',
          intro: { heading: 'javascript:alert(1)', text: [], links: [] },
          items: [{ title: `Tom's "best"`, text: [], image: { src: 'https://x.pl/a.jpg?q="x"', alt: '" onerror="alert(1)' }, links: [] }],
        }),
      ]),
    );
    expect(html).toContain('javascript:alert(1)</h2>');
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toContain('Tom&#039;s &quot;best&quot;');
    expect(html).toContain('alt="&quot; onerror=&quot;alert(1)"');
    expect(html).toContain('src="https://x.pl/a.jpg?q=&quot;x&quot;"');
  });

  it('keeps a background photo URL inside its CSS url()', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'banner', style: { backgroundImage: "https://x.pl/a'b (1).jpg", overlay: 0.5, text: '#ffffff', align: 'center', paddingY: 96, fullBleed: true } })]));
    expect(html).toContain("--rb-bg-image: url('https://x.pl/a%27b%20%281%29.jpg')");
    expect(html).toContain('data-bg-image');
  });

  it('renders links by kind', () => {
    const html = renderRebuild(
      plan([
        section(1, {
          intro: {
            heading: 'H',
            text: [],
            links: [
              { label: 'Zapisz', href: '#booking', kind: 'booking' },
              { label: 'Zespół', href: '#s-2', kind: 'anchor' },
              { label: 'Mapa', href: 'https://maps.google.com/?q=1', kind: 'map' },
            ],
          },
        }),
      ]),
    );
    expect(html).toContain('<a class="rb-cta" href="#booking">Zapisz</a>');
    expect(html).toContain('<a class="rb-link" href="#s-2">Zespół</a>');
    expect(html).toContain('<a class="rb-link" href="https://maps.google.com/?q=1" target="_blank" rel="noopener">Mapa</a>');
  });

  it('sets the item style on the section', () => {
    const html = renderRebuild(
      plan([section(1, { arrangement: 'card-grid', items: [item('Anna')], itemStyle: { imageShape: 'round', radius: 12, border: true, shadow: true, background: '#f5f5f5', align: 'center' } })]),
    );
    expect(html).toContain('data-image-shape="round"');
    expect(html).toContain('data-item-border');
    expect(html).toContain('data-item-shadow');
    expect(html).toContain('data-item-align="center"');
    expect(html).toContain('--rb-item-radius: 12px');
    expect(html).toContain('--rb-item-bg: #f5f5f5');
    expect(html).toContain('[data-image-shape=round] .rb-item-image');
    const withText = renderRebuild(plan([section(1, { arrangement: 'card-grid', items: [item('Anna')], itemStyle: { background: '#ffffff', text: '#4a4a4a' } })]));
    expect(withText).toContain('--rb-item-text: #4a4a4a');
    expect(withText).toContain('.rb-item { color: var(--rb-item-text, inherit);');
  });

  it('places media beside the text on the chosen side', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'media-beside-text', mediaSide: 'left', split: 0.4, images: [{ src: 'https://x.pl/m.jpg', alt: 'M' }] })]));
    expect(html).toContain('data-media-side="left"');
    expect(html).toContain('--rb-split: 40%');
    expect(html).toContain('<div class="rb-media"><img src="https://x.pl/m.jpg" alt="M"');
  });

  it('puts the first section image in the media slot and the rest in a gallery', () => {
    const html = renderRebuild(plan([section(1, { images: ['a', 'b', 'c'].map((n) => ({ src: `https://x.pl/${n}.jpg`, alt: n })) })]));
    expect(html).toMatch(/<div class="rb-media"><img src="https:\/\/x\.pl\/a\.jpg"/);
    expect(html).toMatch(/<div class="rb-gallery"><img src="https:\/\/x\.pl\/b\.jpg"[^]*https:\/\/x\.pl\/c\.jpg/);
  });

  it('keeps gallery item captions and items without an image', () => {
    const html = renderRebuild(plan([section(1, { arrangement: 'gallery', items: [item('Anna'), { title: 'Bez zdjęcia', text: ['Opis'], links: [] }] })]));
    expect(html).toContain('<figcaption>Anna</figcaption>');
    expect(html).toContain('Bez zdjęcia');
    expect(html).toContain('Opis');
  });

  it('renders tabs as radio inputs with unique ids, extra groups included', () => {
    const tabs = [{ title: 'A', text: ['a'], links: [] }, { title: 'B', text: ['b'], links: [] }];
    const html = renderRebuild(
      plan([section(1, { arrangement: 'tabs', items: tabs, extra: [{ type: 'items', arrangement: 'tabs', items: tabs }, { type: 'text', text: ['Dodatkowy'] }] })]),
    );
    const ids = [...html.matchAll(/<input type="radio"[^>]* id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(html).toContain('<p>Dodatkowy</p>');
  });

  it('keeps items and extra blocks of a collapsed section inside its details', () => {
    const html = renderRebuild(plan([section(1, { collapsed: true, intro: { text: ['Długi'], links: [] }, items: [item('Anna')], extra: [{ type: 'text', text: ['Reszta'] }] })]));
    const details = html.slice(html.indexOf('<details class="rb-collapsed">'), html.indexOf('</details>'));
    expect(details).toContain('Anna');
    expect(details).toContain('Reszta');
    expect(details).toContain('<summary>Czytaj więcej</summary>');
  });

  it('keeps the heading of a collapsed section in the outline', () => {
    const html = renderRebuild(plan([section(1, { collapsed: true, headingLevel: 1, intro: { heading: 'Regulamin', text: ['x'.repeat(1500)], links: [] } }), section(2, { collapsed: true })]));
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="rb-heading">Regulamin</h1><details class="rb-collapsed">');
    expect(html).toContain('<h2 class="rb-heading">Sekcja 2</h2><details class="rb-collapsed">');
  });

  it('emits the booking form once however many sections ask for it', () => {
    const html = renderRebuild(plan([section(1, { booking: true }), section(2, { booking: true })], { bookingAppended: true }));
    expect(html.match(/id="booking"/g)).toHaveLength(1);
    expect(html.indexOf('id="booking"')).toBeLessThan(html.indexOf('id="s-2"'));
    const none = renderRebuild(plan([section(1)], { bookingAppended: false }));
    expect(none.match(/id="booking"/g)).toHaveLength(1);
  });

  it('lays out media beside text in two columns only when there is media', () => {
    const empty = renderRebuild(plan([section(1, { arrangement: 'media-beside-text' })]));
    expect(empty).not.toMatch(/<section [^>]*data-has-media/);
    expect(empty).toContain('[data-arrangement=media-beside-text][data-has-media] .rb-container { display: grid;');
    const map = renderRebuild(plan([section(1, { arrangement: 'media-beside-text', embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1', title: 'Mapa' }] })]));
    expect(map).toMatch(/<section [^>]*data-has-media/);
    expect(map).toContain('<div class="rb-media"><div class="rb-embed">');
  });

  it('names the slider track after the heading, else a generic label', () => {
    const named = renderRebuild(plan([section(1, { arrangement: 'slider', items: [item('Anna')] })]));
    expect(named).toContain('<div class="rb-track" tabindex="0" role="region" aria-label="Sekcja 1">');
    const unnamed = renderRebuild(plan([section(1, { arrangement: 'slider', intro: { text: [], links: [] }, items: [item('Anna')] })]));
    expect(unnamed).toContain('role="region" aria-label="Slajdy"');
  });

  it('never renders an empty accordion summary', () => {
    const html = renderRebuild(
      plan([
        section(1, {
          arrangement: 'accordion',
          items: [
            { text: [], image: { src: 'https://x.pl/a.jpg', alt: 'Gabinet' }, links: [] },
            { text: [], image: { src: 'https://x.pl/b.jpg', alt: '' }, links: [] },
          ],
        }),
      ]),
    );
    expect(html).toContain('<summary class="rb-item-title">Gabinet</summary>');
    expect(html).not.toMatch(/<summary[^>]*><\/summary>/);
    expect(html).toContain('<img src="https://x.pl/b.jpg"');
  });

  it('shows a phone without enough digits as text, not a tel: link', () => {
    const html = renderRebuild(plan([section(1)], { header: { nav: [], cta: { label: 'CTA' }, phone: 'tel. 12' }, footer: { contacts: { phone: 'tel. 12' }, social: [] } }));
    expect(html).not.toContain('href="tel:');
    expect(html).toContain('<span class="rb-phone">tel. 12</span>');
    expect(html).toContain('<li><span>tel. 12</span></li>');
  });

  it('drops an unbalanced quote from a font stack and keeps each font on its own line', () => {
    const html = renderRebuild(plan([section(1)], { theme: { ...plan([]).theme, headingFont: '"Open Sans, serif', bodyFont: "'Lato', sans-serif" } }));
    expect(html).toContain('--rb-heading-font: Open Sans, serif;\n');
    expect(html).toContain("--rb-body-font: 'Lato', sans-serif;\n");
  });

  it('renders a slider with one slide without controls and the rest hidden until the script runs', () => {
    const one = renderRebuild(plan([section(1, { arrangement: 'slider', items: [item('Anna')] })]));
    expect(one).not.toContain('data-slide-step="');
    const many = renderRebuild(plan([section(1, { arrangement: 'slider', items: [item('Anna'), item('Jan')] })]));
    expect(many).toContain('<div class="rb-slider-controls" hidden>');
    expect(many).toContain('aria-label="Następny"');
  });

  it('renders the original footer as a div with its anchor, without a second booking form', () => {
    const html = renderRebuild(plan([section(1)], { footer: { section: section(12, { booking: true, intro: { heading: 'Stopka', text: [], links: [] } }), contacts: {}, social: [] } }));
    const footer = html.slice(html.indexOf('<footer'));
    expect(footer).toContain('<div id="s-12" class="rb-section"');
    expect(html.match(/id="booking"/g)).toHaveLength(1);
    expect(footer).not.toContain('<ul>');
  });

  it('uses the logo as favicon and header image, else the monogram', () => {
    const logo = renderRebuild(plan([section(1)], { header: { nav: [], cta: { label: 'CTA' }, logo: { src: 'https://x.pl/logo.png', alt: 'Falco-Dent' } } }));
    expect(logo).toContain('<link rel="icon" href="https://x.pl/logo.png">');
    expect(logo).toContain('<img src="https://x.pl/logo.png" alt="Falco-Dent" class="rb-logo" decoding="async">');
    const mono = renderRebuild(plan([section(1)]));
    expect(mono).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(mono).toContain('<span class="rb-logo"><svg');
  });

  it('adds the tracker only with a public API URL', () => {
    expect(renderRebuild(plan([section(1)]))).not.toContain('revamp-tracker.js');
    const html = renderRebuild(plan([section(1)]), { publicApiUrl: 'https://api.x/api/v1', trackingToken: 'tok' });
    expect(html).toContain('<script src="https://api.x/api/v1/track/revamp-tracker.js" data-api="https://api.x" data-token="tok" async></script>');
    expect(html).toContain('booking_intent');
  });

  it('keeps unsafe characters out of the font stacks', () => {
    const html = renderRebuild(plan([section(1)], { theme: { ...plan([]).theme, bodyFont: 'Arial;}</style><script>x()</script>' } }));
    expect(html).not.toContain('</style><script>');
    expect(html).toContain('--rb-body-font: Arialstylescriptxscript;');
  });

  it('includes the responsive, reduced-motion and focus rules', () => {
    const html = renderRebuild(plan([section(1)]));
    for (const rule of ['@media (max-width: 900px)', '@media (max-width: 700px)', '@media (prefers-reduced-motion: reduce)', ':focus-visible', 'position: sticky', '.form-success-message']) {
      expect(html, rule).toContain(rule);
    }
  });
});
