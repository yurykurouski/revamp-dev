import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REBUILD_OMISSION_REASONS } from '@revamp/shared-types';
import type { IRebuildModernizeAnswer, IRebuildPlan, ISiteSection, ISiteSections } from '@revamp/shared-types';
import { RebuildPlanSchema, SITE_SECTIONS_LIMITS, parseRebuildChange, type SiteGroupingAnswer } from '@revamp/validation';
import { mergeRebuildEdits, planRebuild, RebuildInput } from '../rebuild-plan.service.js';
import { BANNER_OVERLAY, contrastRatio } from '../rebuild-tuning.js';
import { readGroupedSections } from '../site-grouping.js';
import type { RawSiteSections } from '../site-sections.page.js';
import { FONT_STACKS } from '../../templates/design.js';
import { getMvpStrings } from '../../templates/mvp-locale.js';

const section = (index: number, over: Partial<ISiteSection> = {}): ISiteSection => ({
  index, role: 'content', kind: 'other', arrangement: 'text',
  intro: { heading: `Sekcja ${index}`, text: ['Tekst sekcji.'], links: [] },
  items: [], extra: [], images: [], embeds: [], style: {}, ...over,
});

const read = (sections: ISiteSection[], over: Partial<ISiteSections> = {}): ISiteSections => ({
  sections, skipped: [], coverage: { pageChars: 1000, capturedChars: 980, ratio: 0.98, uncaptured: [] }, ...over,
});

const input = (sections: ISiteSection[], over: Partial<RebuildInput> = {}): RebuildInput => ({
  siteSections: read(sections),
  businessName: 'Falco-Dent',
  language: 'pl-PL',
  contacts: { phone: '+48 510 510 706', email: 'recepcja@falcodent.pl', address: 'ul. Kasprowicza 1, Warszawa' },
  socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/falcodent' }],
  primary: '#0e7490',
  year: 2026,
  ...over,
});

const header = section(0, {
  role: 'header', intro: { text: [], links: [
    { label: 'Zespół', href: 'https://falcodent.pl/#zespol', kind: 'link' },
    { label: 'Cennik', href: 'https://falcodent.pl/cennik/', kind: 'link' },
    { label: 'Umów wizytę', href: 'https://booksy.com/pl-pl/123', kind: 'cta' },
  ] },
  images: [{ src: 'https://falcodent.pl/logo.png', alt: 'Falco-Dent' }],
});
const hero = section(1, { role: 'hero', arrangement: 'banner', intro: { heading: 'Stomatologia estetyczna', text: ['Witamy'], links: [] },
  style: { backgroundImage: 'https://falcodent.pl/hero.jpg', textColor: '#ffffff' } });
const team = section(2, { kind: 'team', arrangement: 'card-grid', columns: 3, intro: { heading: 'Zespół', text: [], links: [] },
  items: [{ title: 'Dr Anna', subtitle: 'Ortodonta', text: ['Bio'], image: { src: 'https://falcodent.pl/a.jpg' }, links: [] }] });

describe('planRebuild (REV-110)', () => {
  it('keeps every section in order and validates', () => {
    const plan = planRebuild(input([header, hero, team]));
    expect(plan.sections.map((s) => s.id)).toEqual(['s-1', 's-2']);
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
    expect(plan.summary).toMatchObject({ coverage: 0.98, sections: 2 });
  });

  it('caps a pill item radius the reader keeps at 1000 px so the plan still validates', () => {
    const pills = section(1, { arrangement: 'card-grid', items: [{ title: 'A', text: [], links: [] }],
      itemStyle: { radius: 1000, border: false, shadow: false } });
    const plan = planRebuild(input([header, pills]));
    expect(plan.sections[0]!.itemStyle?.radius).toBe(999);
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });

  it('gives items on their own background a text color readable there (Falco-Dent offer on a photo)', () => {
    const offer = section(1, { arrangement: 'card-grid', items: [{ text: ['Implanty'], links: [] }],
      itemStyle: { background: '#ffffff' }, style: { backgroundImage: 'https://falcodent.pl/bg.jpg', textColor: '#4a4a4a' } });
    const dark = section(2, { arrangement: 'card-grid', items: [{ text: ['Laser'], links: [] }],
      itemStyle: { background: '#173784' }, style: { background: '#ffffff', textColor: '#4a4a4a' } });
    const plan = planRebuild(input([header, offer, dark]));
    const [onPhoto, onDark] = plan.sections;
    expect(onPhoto!.style.text).toBe('#ffffff');
    expect(onPhoto!.itemStyle?.text).toBe('#4a4a4a');
    expect(contrastRatio(onDark!.itemStyle!.text!, '#173784')).toBeGreaterThanOrEqual(4.5);
    expect(plan.summary.tuning).toContain('contrast:2');
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });

  it('drops items left empty once their links to other pages are gone, and records a section left empty (Falco-Dent marquee)', () => {
    const menu = { text: [], links: [{ label: 'Implanty', href: 'https://falcodent.pl/implanty/', kind: 'link' as const }] };
    const marquee = section(2, { arrangement: 'card-grid', intro: { text: [], links: [] }, items: [menu, menu] });
    const mixed = section(3, { arrangement: 'card-grid', items: [menu, { title: 'Laser', text: [], links: [] }] });
    const plan = planRebuild(input([header, hero, marquee, mixed]));
    expect(plan.sections.map((s) => s.id)).toEqual(['s-1', 's-3']);
    expect(plan.sections[1]!.items).toEqual([{ title: 'Laser', text: [], links: [] }]);
    expect(plan.summary.sections).toBe(2);
    expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'empty', sample: 'Implanty' });
    // Fixes are recorded only for sections that are rendered
    const pale = planRebuild(input([header, hero, { ...marquee, style: { background: '#ffffff', textColor: '#eeeeee' } }]));
    expect(pale.sections.map((s) => s.id)).toEqual(['s-1']);
    expect(pale.summary.tuning).not.toContain('contrast:2');
    // A photo banner without copy is still something to show
    const photo = section(4, { arrangement: 'banner', intro: { text: [], links: [] }, style: { backgroundImage: 'https://falcodent.pl/b.jpg' } });
    expect(planRebuild(input([header, hero, photo])).sections.map((s) => s.id)).toEqual(['s-1', 's-4']);
  });

  it('renders a hero slider of photos one photo slide at a time, each with its own photo under the overlay', () => {
    const slides = section(1, { role: 'hero', arrangement: 'slider', intro: { text: [], links: [] },
      items: [
        { title: 'Nakładki ortodontyczne', text: ['Przejrzysta droga do uśmiechu'], backgroundImage: 'https://falcodent.pl/ortheo.jpg', links: [] },
        { text: ['Stomatologia estetyczna'], image: { src: 'https://falcodent.pl/o-6.jpg', alt: 'Licówki porcelanowe' }, links: [] },
        { text: [], backgroundImage: 'https://falcodent.pl/team.jpg', links: [] },
        { text: ['Bez zdjęcia'], links: [] },
      ],
      style: { backgroundImage: 'https://falcodent.pl/ortheo.jpg', textColor: '#4a4a4a' } });
    const plan = planRebuild(input([header, slides, team]));
    const hero = plan.sections[0]!;
    expect(hero.photoSlides).toBe(true);
    expect(hero.items.map((i) => [i.backgroundImage, i.image?.src])).toEqual([
      ['https://falcodent.pl/ortheo.jpg', undefined],
      ['https://falcodent.pl/o-6.jpg', undefined],
      ['https://falcodent.pl/team.jpg', undefined],
      [undefined, undefined],
    ]);
    // A picture moved behind the caption keeps its original alt as the slide's text alternative; nothing is made up
    expect(hero.items.map((i) => i.backgroundAlt)).toEqual([undefined, 'Licówki porcelanowe', undefined, undefined]);
    // Each slide carries its photo; the section keeps none of its own, and the overlay is for the slides' photos
    expect(hero.style.backgroundImage).toBeUndefined();
    expect(hero.style.overlay).toBeGreaterThan(0);
    expect(plan.summary.tuning).toContain('overlay:1');
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
    // A slider of reviews further down stays a slider of cards
    const reviews = section(2, { arrangement: 'slider', items: [{ title: 'Anna', text: ['Polecam'], image: { src: 'https://falcodent.pl/a.jpg' }, links: [] }] });
    expect(planRebuild(input([header, slides, reviews])).sections[1]!.photoSlides).toBeUndefined();
  });

  it('keeps a photo slider\'s own intro copy readable on the section background, not white on white', () => {
    const slides = section(1, { role: 'hero', arrangement: 'slider', intro: { eyebrow: 'Witamy', heading: 'Stomatologia Falco-Dent', text: ['Nowoczesne leczenie'], links: [] },
      items: [{ title: 'Implanty', text: [], backgroundImage: 'https://falcodent.pl/i.jpg', links: [] }],
      style: { background: '#ffffff', textColor: '#ffffff' } });
    const plan = planRebuild(input([header, slides]));
    const hero = plan.sections[0]!;
    expect(hero.photoSlides).toBe(true);
    expect(hero.headingLevel).toBe(1);
    expect(contrastRatio(hero.style.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['overlay:1', 'contrast:1']));
    // On a transparent section the copy is read against the page background
    const bare = planRebuild(input([header, { ...slides, style: { textColor: '#ffffff' } }])).sections[0]!;
    expect(contrastRatio(bare.style.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('puts the largest picture in the media slot beside the text, not a small icon before it (Elefant)', () => {
    const about = section(1, { arrangement: 'media-beside-text', mediaSide: 'left', images: [
      { src: 'https://elefant.med.pl/icon.webp', width: 48, height: 48 },
      { src: 'https://elefant.med.pl/slonik.webp', width: 373, height: 349 },
      { src: 'https://elefant.med.pl/standardy.webp', width: 112, height: 112 },
    ] });
    const plan = planRebuild(input([header, about]));
    expect(plan.sections[0]!.images.map((i) => i.src)).toEqual([
      'https://elefant.med.pl/slonik.webp', 'https://elefant.med.pl/icon.webp', 'https://elefant.med.pl/standardy.webp',
    ]);
  });

  it('leaves out a footer left empty once its links to other pages are gone (Dentalux)', () => {
    const footer = section(9, { role: 'footer', intro: { text: [], links: [
      { label: 'Facebook', href: 'https://facebook.com/dentalux', kind: 'link' },
      { label: 'Polityka prywatności', href: 'https://dentalux.pl/polityka/', kind: 'link' },
    ] } });
    const plan = planRebuild(input([header, hero, { ...footer, intro: { ...footer.intro, heading: undefined } }]));
    expect(plan.footer.section).toBeUndefined();
    expect(plan.summary.tuning).toContain('footer:added');
    expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'empty', sample: 'Facebook' });
  });

  it('gives the hero heading the only h1', () => {
    const plan = planRebuild(input([header, hero, team]));
    expect(plan.sections.map((s) => s.headingLevel)).toEqual([1, 2]);
    expect(plan.hiddenH1).toBeUndefined();
  });

  it('uses a hidden business-name h1 when there is no hero heading', () => {
    const plan = planRebuild(input([header, team]));
    expect(plan.sections.every((s) => s.headingLevel === 2)).toBe(true);
    expect(plan.hiddenH1).toBe('Falco-Dent');
    expect(plan.summary.tuning).toContain('h1:hidden');
  });

  it('turns nav links into anchors of matching sections and drops the rest, recorded', () => {
    const plan = planRebuild(input([header, hero, team]));
    expect(plan.header.nav).toEqual([{ label: 'Zespół', href: '#s-2' }]);
    expect(plan.summary.omitted).toContainEqual({ what: 'nav_link', reason: 'other_page', sample: 'Cennik' });
  });

  it('points the header CTA and booking hosts to #booking with the original label', () => {
    const plan = planRebuild(input([header, hero]));
    expect(plan.header.cta.label).toBe('Umów wizytę');
    const withLink = planRebuild(input([header, section(1, { intro: { heading: 'H', text: [], links: [
      { label: 'Zapisz się', href: 'https://booksy.com/x', kind: 'link' },
      { label: 'Więcej', href: 'https://falcodent.pl/oferta/', kind: 'link' },
      { label: '510 510 706', href: 'tel:+48510510706', kind: 'phone' },
      { label: 'Klik', href: 'javascript:alert(1)', kind: 'cta' },
    ] } })]));
    expect(withLink.sections[0]!.intro.links).toEqual([
      { label: 'Zapisz się', href: '#booking', kind: 'booking' },
      { label: '510 510 706', href: 'tel:+48510510706', kind: 'phone' },
    ]);
    expect(withLink.summary.omitted.filter((o) => o.what === 'link')).toHaveLength(2);
  });

  it('falls back to the locale CTA label without a header CTA', () => {
    expect(planRebuild(input([hero])).header.cta.label).toBe(getMvpStrings('pl').sendRequest);
  });

  it('replaces the first form or widget with the booking form and keeps allowed iframes', () => {
    const plan = planRebuild(input([hero, section(2, { embeds: [
      { kind: 'form' },
      { kind: 'map', src: 'https://www.google.com/maps/embed?pb=1' },
      { kind: 'widget', src: 'https://booksy.com/widget' },
      { kind: 'video', src: 'https://evil.example/v' },
    ] })]));
    expect(plan.sections[1]).toMatchObject({ booking: true, embeds: [{ kind: 'map', src: 'https://www.google.com/maps/embed?pb=1', title: 'Mapa' }] });
    expect(plan.bookingAppended).toBe(false);
    expect(plan.summary.tuning).toContain('booking:replaced');
    expect(plan.summary.omitted.filter((o) => o.what === 'embed')).toHaveLength(2);
  });

  it('appends the booking form when nothing is replaced', () => {
    const plan = planRebuild(input([hero]));
    expect(plan.bookingAppended).toBe(true);
    expect(plan.summary.tuning).toContain('booking:appended');
  });

  it('adds a contacts-only footer when the site has none, and merges one that exists', () => {
    const none = planRebuild(input([hero]));
    expect(none.footer.section).toBeUndefined();
    expect(none.footer.contacts).toMatchObject({ phone: '+48 510 510 706', email: 'recepcja@falcodent.pl' });
    expect(none.summary.tuning).toContain('footer:added');
    const footer = section(9, { role: 'footer', kind: 'contact', intro: { text: ['Pon-Pt 9-20'], links: [] } });
    expect(planRebuild(input([hero, footer])).footer.section?.id).toBe('s-9');
  });

  it('collapses a long text section', () => {
    const plan = planRebuild(input([hero, section(2, { intro: { heading: 'RODO', text: ['x'.repeat(1300)], links: [] } })]));
    expect(plan.sections[1]!.collapsed).toBe(true);
    expect(plan.summary.tuning).toContain('collapse:2');
  });

  it('raises low contrast and overlays a banner photo', () => {
    const plan = planRebuild(input([hero, section(2, { style: { background: '#ffffff', textColor: '#cccccc' } })]));
    expect(plan.sections[0]!.style).toMatchObject({ overlay: 0.55, text: '#ffffff' });
    expect(contrastRatio(plan.sections[1]!.style.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['overlay:1', 'contrast:2']));
  });

  it('reads text on a transparent section against the page background', () => {
    const plan = planRebuild(input([hero, section(2, { style: { textColor: '#ffffff' } })]));
    expect(contrastRatio(plan.sections[1]!.style.text, plan.theme.pageBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('takes alt text only from the original, the title or the heading', () => {
    const plan = planRebuild(input([hero, team, section(3, { images: [{ src: 'https://x.pl/1.jpg' }], intro: { text: ['t'], links: [] } })]));
    expect(plan.sections[1]!.items[0]!.image).toMatchObject({ alt: 'Dr Anna', eager: undefined });
    expect(plan.sections[2]!.images[0]!.alt).toBe('');
    expect(plan.summary.tuning).toContain('alt:1');
  });

  it('never keeps a data: image', () => {
    const plan = planRebuild(input([hero, section(2, { images: [{ src: 'data:image/gif;base64,R0lG' }] })]));
    expect(plan.sections[1]!.images).toEqual([]);
    expect(plan.summary.omitted).toContainEqual(expect.objectContaining({ what: 'image' }));
  });

  it('lists the services sections item titles as booking options', () => {
    const services = section(3, { kind: 'services', arrangement: 'card-grid', items: [
      { title: 'Implanty', text: [], links: [] }, { title: 'Ortodoncja', text: [], links: [] },
    ] });
    expect(planRebuild(input([hero, services])).bookingServices).toEqual(['Implanty', 'Ortodoncja']);
  });

  it('lists a service repeated in the services and pricing sections once, in its first spelling', () => {
    const services = section(3, { kind: 'services', arrangement: 'card-grid', items: [
      { title: 'Implanty', text: [], links: [] }, { title: 'Ortodoncja', text: [], links: [] },
    ] });
    const pricing = section(4, { kind: 'pricing', arrangement: 'list', items: [
      { title: ' implanty ', text: [], links: [] }, { title: 'ORTODONCJA', text: [], links: [] }, { title: 'Wybielanie  zębów', text: [], links: [] },
      { title: 'wybielanie zębów', text: [], links: [] },
    ] });
    expect(planRebuild(input([hero, services, pricing])).bookingServices).toEqual(['Implanty', 'Ortodoncja', 'Wybielanie  zębów']);
  });

  it('carries the reader skipped blocks into the omissions', () => {
    const plan = planRebuild({ ...input([hero]), siteSections: read([hero], { skipped: [{ index: 12, reason: 'noise', sample: 'Polityka prywatności' }] }) });
    expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'noise', sample: 'Polityka prywatności' });
  });

  it('uses the header logo, else the brand logo', () => {
    expect(planRebuild(input([header, hero])).header.logo).toMatchObject({ src: 'https://falcodent.pl/logo.png', alt: 'Falco-Dent' });
    expect(planRebuild(input([hero], { logoUrl: 'https://x.pl/l.svg' })).header.logo?.src).toBe('https://x.pl/l.svg');
  });
});

describe('planRebuild guards and footer booking (REV-110)', () => {
  const valid = (plan: ReturnType<typeof planRebuild>) => expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();

  it('does not let a form only in the footer claim the booking slot', () => {
    const footer = section(9, { role: 'footer', kind: 'contact', embeds: [{ kind: 'form' }] });
    const plan = planRebuild(input([hero, footer]));
    expect(plan.bookingAppended).toBe(true);
    expect(plan.summary.tuning).toContain('booking:appended');
    expect(plan.footer.section?.booking).toBe(false);
    expect(plan.summary.omitted).toContainEqual({ what: 'embed', reason: 'second_form', sample: 'form' });
    valid(plan);
  });

  it('keeps an oversized, messy section inside the schema', () => {
    const long = 'x'.repeat(2500);
    const big = section(2, {
      intro: { eyebrow: long, heading: long, text: ['', long, ...Array.from({ length: 60 }, () => 't')], links: Array.from({ length: 60 }, (_, i) => ({ label: i ? `L${i}` : '', href: 'tel:+48510510706', kind: 'phone' as const })) },
      items: Array.from({ length: 80 }, (_, i) => ({ title: long, text: [], links: [], rating: 9, image: { src: `https://x.pl/${i}.jpg`, width: 0.2, height: 0.2 } })),
      images: Array.from({ length: 40 }, (_, i) => ({ src: `https://x.pl/i${i}.jpg`, alt: long })),
      columns: 12,
      embeds: Array.from({ length: 12 }, () => ({ kind: 'map' as const, src: 'https://www.google.com/maps/embed?pb=1' })),
      extra: Array.from({ length: 30 }, () => ({ type: 'text' as const, text: [long, ''] })),
    });
    valid(planRebuild(input([hero, big], { businessName: long, contacts: { phone: '+48 510 510 706', email: 'not an email' } })));
  });

  it('drops empty labels, unsafe urls and sections beyond the cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => section(i + 1, { intro: { heading: `H${i}`, text: ['t'], links: [] } }));
    const plan = planRebuild(input(many, { socialLinks: [{ url: 'https://' + 'a'.repeat(2100) }, { url: 'https://ok.pl/x' }] }));
    expect(plan.sections).toHaveLength(45);
    expect(plan.footer.social).toEqual([{ label: 'ok.pl', href: 'https://ok.pl/x' }]);
    valid(plan);
  });

  it('does not match an empty nav label to a section', () => {
    const h = section(0, { role: 'header', intro: { text: [], links: [{ label: ' ', href: 'https://falcodent.pl/x', kind: 'link' }] } });
    expect(planRebuild(input([h, hero])).header.nav).toEqual([]);
  });

  it('matches nav labels against headings ignoring diacritics', () => {
    const h = section(0, { role: 'header', intro: { text: [], links: [{ label: 'Zabka', href: 'https://falcodent.pl/#z', kind: 'link' }] } });
    expect(planRebuild(input([h, hero, section(2, { intro: { heading: 'Żabka', text: ['t'], links: [] } })])).header.nav).toEqual([{ label: 'Zabka', href: '#s-2' }]);
  });

  const plainHeader = (links: ISiteSection['intro']['links']) => section(0, { role: 'header', intro: { text: [], links } });
  const linked = (href: string, kind: 'phone' | 'email') =>
    planRebuild(input([hero, section(2, { intro: { heading: 'H', text: [], links: [{ label: 'L', href, kind }] } })])).sections[1]!.intro.links;

  it('decodes a percent-encoded tel: href before reading its digits', () => {
    expect(linked('tel:+48%20510%20510%20706', 'phone')).toEqual([{ label: 'L', href: 'tel:+48510510706', kind: 'phone' }]);
    const bad = planRebuild(input([hero, section(2, { intro: { heading: 'H', text: [], links: [{ label: 'L', href: 'tel:%E0%A4%A', kind: 'phone' }] } })]));
    expect(bad.sections[1]!.intro.links).toEqual([]);
    expect(bad.summary.omitted).toContainEqual({ what: 'link', reason: 'unsafe_url', sample: 'L' });
  });

  it('drops a footer email the schema would reject, keeping the plan valid', () => {
    for (const email of ['biuro@klinika-ząb.pl', 'info@firma.pl.', 'a..b@x.pl', 'a@b.c']) {
      const plan = planRebuild(input([hero], { contacts: { email, phone: '+48 510 510 706' } }));
      expect(plan.footer.contacts.email).toBeUndefined();
      valid(plan);
    }
  });

  it('anchors a nav label only on an equal or word-leading heading', () => {
    const plan = planRebuild(input([plainHeader([
      { label: 'O', href: 'https://falcodent.pl/o', kind: 'link' },
      { label: 'Zespół', href: 'https://falcodent.pl/z', kind: 'link' },
    ]), hero, section(2, { intro: { heading: 'Oferta', text: ['t'], links: [] } }), section(3, { intro: { heading: 'Zespół lekarzy', text: ['t'], links: [] } })]));
    expect(plan.header.nav).toEqual([{ label: 'Zespół', href: '#s-3' }]);
    expect(plan.summary.omitted).toContainEqual({ what: 'nav_link', reason: 'other_page', sample: 'O' });
  });

  it('records phone, email and map header links as contact_link omissions', () => {
    const plan = planRebuild(input([plainHeader([
      { label: '510 510 706', href: 'tel:+48510510706', kind: 'phone' },
      { label: 'Mail', href: 'mailto:a@b.pl', kind: 'email' },
      { label: 'Mapa', href: 'https://maps.google.com/x', kind: 'map' },
    ]), hero]));
    expect(plan.summary.omitted.filter((o) => o.what === 'nav_link' && o.reason === 'contact_link').map((o) => o.sample)).toEqual(['510 510 706', 'Mail', 'Mapa']);
  });

  it('lets the nav anchor to the footer section', () => {
    const footer = section(9, { role: 'footer', kind: 'contact', intro: { heading: 'Kontakt', text: ['t'], links: [] } });
    const plan = planRebuild(input([plainHeader([{ label: 'Kontakt', href: 'https://falcodent.pl/k', kind: 'link' }]), hero, footer]));
    expect(plan.header.nav).toEqual([{ label: 'Kontakt', href: '#s-9' }]);
  });

  it('emits a lowercase mailto:', () => {
    expect(linked('MAILTO:a@b.pl', 'email')).toEqual([{ label: 'L', href: 'mailto:a@b.pl', kind: 'email' }]);
  });

  it('cuts the alt of the brand logo and falls back for an empty business name', () => {
    const long = planRebuild(input([hero], { businessName: 'x'.repeat(400), logoUrl: 'https://x.pl/l.svg' }));
    expect(long.header.logo?.alt).toHaveLength(300);
    valid(long);
    const empty = planRebuild(input([team], { businessName: '   ' }));
    expect(empty.businessName).toBe('Business');
    expect(empty.hiddenH1).toBe('Business');
    valid(empty);
  });

  it('lets a later CTA label win over an empty first one', () => {
    const plan = planRebuild(input([plainHeader([
      { label: ' ', href: 'https://x.pl/a', kind: 'cta' },
      { label: 'Zapisz się', href: 'https://x.pl/b', kind: 'cta' },
    ]), hero]));
    expect(plan.header.cta.label).toBe('Zapisz się');
  });
});

describe('planRebuild with the operator edit (REV-111)', () => {
  const nav = section(0, {
    role: 'header',
    intro: { text: [], links: [{ label: 'Zespół', href: 'https://falcodent.pl/#zespol', kind: 'link' }, { label: 'Opinie', href: 'https://falcodent.pl/#opinie', kind: 'link' }] },
  });
  const about = section(2, { kind: 'about', intro: { heading: 'O nas', text: ['Pierwszy akapit.', 'Drugi akapit.'], links: [] },
    extra: [{ type: 'text', text: ['Dodatkowy tekst.'] }] });
  const services = section(3, { kind: 'services', arrangement: 'card-grid', intro: { heading: 'Zespół', text: [], links: [] },
    items: [{ title: 'Implanty', text: [], links: [] }, { title: 'Wybielanie', text: [], links: [] }], itemStyle: { radius: 4 } });
  const reviews = section(4, { kind: 'reviews', intro: { heading: 'Opinie', text: ['Polecam!'], links: [] } });
  const page = [nav, hero, about, services, reviews];

  it('plans exactly as without an edit when the edit changes nothing', () => {
    const plain = planRebuild(input(page));
    expect(planRebuild(input(page, { edit: undefined }))).toEqual(plain);
    expect(planRebuild(input(page, { edit: {} }))).toEqual(plain);
    expect(planRebuild(input(page, { edit: { order: [], hidden: [], dropped: [], sections: {}, theme: {} } }))).toEqual(plain);
  });

  it('leaves a hidden section out, records it, and drops the nav link to it', () => {
    const plan = planRebuild(input(page, { edit: { hidden: ['s-3'] } }));
    expect(plan.sections.map((s) => s.id)).toEqual(['s-1', 's-2', 's-4']);
    expect(plan.summary.sections).toBe(3);
    expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'hidden', sample: 'Zespół' });
    expect(plan.header.nav.map((n) => n.href)).toEqual(['#s-4']);
    expect(plan.bookingServices).toEqual([]);
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });

  it('appends the booking form when the hidden section held the original form', () => {
    const withForm = section(5, { intro: { heading: 'Kontakt', text: ['Napisz'], links: [] }, embeds: [{ kind: 'form' }] });
    expect(planRebuild(input([hero, withForm])).bookingAppended).toBe(false);
    const plan = planRebuild(input([hero, withForm, reviews], { edit: { hidden: ['s-5'] } }));
    expect(plan.bookingAppended).toBe(true);
    expect(plan.sections.some((s) => s.booking)).toBe(false);
    expect(plan.summary.tuning).toContain('booking:appended');
  });

  it('leaves dropped paragraphs, items and extra blocks out, each recorded', () => {
    const plan = planRebuild(input(page, { edit: { dropped: ['s-2.t0', 's-2.x0', 's-3.i1'] } }));
    const [, planAbout, planServices] = plan.sections;
    expect(planAbout!.intro.text).toEqual(['Drugi akapit.']);
    expect(planAbout!.extra).toEqual([]);
    expect(planServices!.items.map((i) => i.title)).toEqual(['Implanty']);
    expect(plan.bookingServices).toEqual(['Implanty']);
    expect(plan.summary.omitted).toEqual(
      expect.arrayContaining([
        { what: 'text', reason: 'dropped', sample: 'Pierwszy akapit.' },
        { what: 'text', reason: 'dropped', sample: 'Dodatkowy tekst.' },
        { what: 'item', reason: 'dropped', sample: 'Wybielanie' },
      ]),
    );
  });

  it('omits a section left with nothing once its pieces are dropped', () => {
    const bare = section(5, { intro: { text: ['Tylko tekst.'], links: [] } });
    const plan = planRebuild(input([hero, bare], { edit: { dropped: ['s-5.t0'] } }));
    expect(plan.sections.map((s) => s.id)).toEqual(['s-1']);
    expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'empty' });
  });

  it('puts the listed sections first, in that order, and the rest after in the original order', () => {
    const plan = planRebuild(input(page, { edit: { order: ['s-1', 's-4', 's-2'] } }));
    expect(plan.sections.map((s) => s.id)).toEqual(['s-1', 's-4', 's-2', 's-3']);
    expect(plan.summary.tuning).toContain('edit:order');
    expect(plan.sections[0]!.headingLevel).toBe(1);
  });

  it('restyles a section and keeps its text readable', () => {
    const plan = planRebuild(input(page, { edit: { sections: { 's-2': { background: 'dark', align: 'center', density: 'airy' } } } }));
    const style = plan.sections[1]!.style;
    expect(style).toMatchObject({ background: '#111827', align: 'center', paddingY: 112 });
    expect(contrastRatio(style.text, '#111827')).toBeGreaterThanOrEqual(4.5);
    expect(plan.summary.tuning).toContain('edit:style:2');
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });

  it.each([
    ['page', '#ffffff'],
    ['brand', '#0e7490'],
    ['tinted', '#ecf4f6'],
  ] as const)('gives a %s background', (background, hex) => {
    const plan = planRebuild(input(page, { edit: { sections: { 's-4': { background } } } }));
    expect(plan.sections[3]!.style.background).toBe(hex);
    expect(contrastRatio(plan.sections[3]!.style.text, hex)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a photo section photo, overlay and white text under a background pick', () => {
    const plan = planRebuild(input(page, { edit: { sections: { 's-1': { background: 'brand' } } } }));
    expect(plan.sections[0]!.style).toMatchObject({ backgroundImage: 'https://falcodent.pl/hero.jpg', overlay: 0.55, text: '#ffffff', background: '#0e7490' });
  });

  it('applies the theme: font, corners, spacing and heading case', () => {
    const plan = planRebuild(input(page, { edit: { theme: { font: 'serif', corners: 'extra-round', density: 'compact', headingCase: 'uppercase' }, sections: { 's-4': { density: 'airy' } } } }));
    expect(plan.theme).toMatchObject({ headingFont: FONT_STACKS.serif, bodyFont: FONT_STACKS.serif, buttonRadius: 999, headingUppercase: true });
    expect(plan.sections.map((s) => s.style.paddingY)).toEqual([48, 48, 48, 112]);
    expect(plan.sections.every((s) => s.itemStyle?.radius === 999)).toBe(true);
    expect(plan.summary.tuning).toContain('edit:theme');
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });

  it('changes only the headings for a display font, and nothing for the system font', () => {
    const plain = planRebuild(input(page));
    const display = planRebuild(input(page, { edit: { theme: { font: 'serif-display' } } }));
    expect(display.theme).toMatchObject({ headingFont: FONT_STACKS.display, bodyFont: plain.theme.bodyFont });
    const system = planRebuild(input(page, { edit: { theme: { font: 'system' } } }));
    expect(system.theme).toMatchObject({ headingFont: plain.theme.headingFont, bodyFont: plain.theme.bodyFont });
  });

  it('carries custom CSS through the sanitizer, and drops CSS that fails it', () => {
    const css = '.rb-heading { letter-spacing: .02em; }';
    const plan = planRebuild(input(page, { edit: { customCss: css } }));
    expect(plan.customCss).toContain('letter-spacing');
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
    const unsafe = planRebuild(input(page, { edit: { customCss: 'body { display: none; }' } }));
    expect(unsafe.customCss).toBeUndefined();
    expect(unsafe.summary.tuning).toContain('edit:css-dropped');
  });
});

describe('modernize (REV-114)', () => {
  // The anident.pl reading, as the vision grouping stores it (site-grouping.recorded.spec.ts)
  const anident = (): ISiteSections => {
    const r = JSON.parse(readFileSync(new URL('./fixtures/grouping/anident.json', import.meta.url), 'utf8'));
    const raw: RawSiteSections = { viewportWidth: r.viewportWidth, viewportHeight: r.viewportHeight, blocks: [], typography: r.typography, pageChars: r.pageChars, uncaptured: [], outline: r.outline };
    return readGroupedSections(raw, r.answer as SiteGroupingAnswer).sections!;
  };
  const anidentInput = (over: Partial<RebuildInput> = {}): RebuildInput => input([], { siteSections: anident(), businessName: 'Anident', ...over });
  const valid = (plan: IRebuildPlan) => {
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
    return plan;
  };
  const byId = (plan: IRebuildPlan, id: string) => plan.sections.find((s) => s.id === id);
  const t = getMvpStrings('pl-PL');

  it('plans exactly as today without a modernize layer', () => {
    const base = anidentInput();
    const plan = planRebuild(base);
    expect(planRebuild({ ...base, modernize: undefined })).toEqual(plan);
    expect({ summary: plan.summary, sections: plan.sections.map((s) => `${s.id}:${s.arrangement}`) }).toMatchSnapshot();
  });

  it('merges the layers with the operator winning per field, and the operator edit unchanged without a modernize layer', () => {
    const edit = { order: ['s-2'], sections: { 's-3': { background: 'dark' as const } } };
    expect(mergeRebuildEdits(undefined, edit).edit).toBe(edit);
    expect(mergeRebuildEdits(undefined, undefined).edit).toBeUndefined();
    const merged = mergeRebuildEdits(
      { sections: { 's-3': { background: 'tinted', align: 'center' } }, theme: { font: 'humanist', typeScale: 'modern' }, hero: { photo: 's-2.m0', style: 'split' } },
      { ...edit, theme: { font: 'serif' }, customCss: '.rb-heading { color: red; }' },
    );
    expect(merged.edit).toEqual({
      order: ['s-2'],
      customCss: '.rb-heading { color: red; }',
      sections: { 's-3': { background: 'dark', align: 'center' } },
      theme: { font: 'serif', typeScale: 'modern' },
      hero: { photo: 's-2.m0', style: 'split' },
    });
    expect(merged.from('sections.s-3.background')).toBe('edit');
    expect(merged.from('sections.s-3.align')).toBe('modernize');
    expect(merged.from('theme.font')).toBe('edit');
    expect(merged.from('theme.typeScale')).toBe('modernize');
    expect(merged.from('hero')).toBe('modernize');
    expect(mergeRebuildEdits({ hero: { photo: 's-2.m0', style: 'split' } }, { hero: { photo: 's-4.m0', style: 'banner' } }).edit?.hero).toEqual({ photo: 's-4.m0', style: 'banner' });
  });

  describe('cards from paragraphs (anident s-9)', () => {
    const faithful = planRebuild(anidentInput());
    const paragraphs = byId(faithful, 's-9')!.intro.text;
    const carded = (s: IRebuildPlan['sections'][number]) => [
      ...s.intro.text,
      ...s.items.flatMap((i) => i.text),
      ...s.extra.flatMap((b) => (b.type === 'text' ? b.text : [])),
    ];

    it('turns the short paragraphs into cards and keeps the long one after them as text', () => {
      const plan = valid(planRebuild(anidentInput({ modernize: { sections: { 's-9': { arrangement: 'card-grid' } } } })));
      const s9 = byId(plan, 's-9')!;
      expect(paragraphs).toHaveLength(26);
      // The longest carded paragraph is 135 characters: 3 columns
      expect(s9).toMatchObject({ arrangement: 'card-grid', collapsed: false, columns: 3 });
      // Cards made from bare paragraphs get a surface of their own, rounded by the theme's corners
      expect(s9.itemStyle).toMatchObject({ border: true });
      expect(byId(faithful, 's-9')!.itemStyle).toBeUndefined();
      expect(s9.items).toHaveLength(25);
      expect(s9.items.every((item, n) => item.text.length === 1 && item.text[0] === paragraphs[n] && item.links.length === 0)).toBe(true);
      expect(s9.intro.text).toEqual([]);
      expect(s9.intro.heading).toBe(byId(faithful, 's-9')!.intro.heading);
      expect(s9.extra[0]).toEqual({ type: 'text', text: [paragraphs[25]] });
      // Every paragraph appears exactly once, in the page's order (Review Focus 2)
      expect(carded(s9)).toEqual(paragraphs);
      expect(plan.summary.tuning).toContain('modernize:cards:9');
      expect(byId(faithful, 's-9')!.collapsed).toBe(true);
    });

    it("applies the operator's drops first", () => {
      const plan = valid(planRebuild(anidentInput({ modernize: { sections: { 's-9': { arrangement: 'card-grid' } } }, edit: { dropped: ['s-9.t0'] } })));
      const s9 = byId(plan, 's-9')!;
      expect(s9.items.map((i) => i.text[0])).not.toContain(paragraphs[0]);
      expect(s9.items).toHaveLength(24);
      expect(carded(s9)).toEqual(paragraphs.slice(1));
      expect(plan.summary.omitted).toContainEqual(expect.objectContaining({ what: 'text', reason: 'dropped' }));
    });

    it('uses 3 columns when no carded paragraph is over 160 characters, and keeps a long opening paragraph as intro', () => {
      const long = 'D'.repeat(320);
      const text = section(4, { intro: { heading: 'Atuty', text: [long, 'Krótko o nas.', 'Nowoczesny sprzęt.', 'Doświadczeni lekarze.'], links: [] } });
      const plan = valid(planRebuild(input([hero, text], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })));
      const s4 = byId(plan, 's-4')!;
      expect(s4).toMatchObject({ arrangement: 'card-grid', columns: 3 });
      expect(s4.intro.text).toEqual([long]);
      expect(s4.items.map((i) => i.text)).toEqual([['Krótko o nas.'], ['Nowoczesny sprzęt.'], ['Doświadczeni lekarze.']]);
      const wide = section(4, { intro: { heading: 'Atuty', text: ['A'.repeat(161), 'Krótko.', 'Sprzęt.'], links: [] } });
      expect(byId(planRebuild(input([hero, wide], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })), 's-4')).toMatchObject({ arrangement: 'card-grid', columns: 2 });
      const list = byId(planRebuild(input([hero, text], { modernize: { sections: { 's-4': { arrangement: 'list' } } } })), 's-4')!;
      expect(list).toMatchObject({ arrangement: 'list', items: s4.items, intro: { text: [long] } });
      expect(list.columns).toBeUndefined();
      expect(list.itemStyle).toBeUndefined();
    });

    it('leaves a section as text when the paragraphs after the cards would push an extra block past the cap', () => {
      const full = Array.from({ length: 20 }, (_, n) => ({ type: 'text' as const, text: [`Blok ${n}.`] }));
      const text = section(4, { intro: { heading: 'Atuty', text: ['Jeden.', 'Dwa.', 'Trzy.', 'E'.repeat(320)], links: [] }, extra: full });
      const plan = valid(planRebuild(input([hero, text], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })));
      expect(byId(plan, 's-4')).toMatchObject({ arrangement: 'text', items: [] });
      expect(byId(plan, 's-4')!.extra).toHaveLength(20);
      expect(plan.summary.tuning.some((code) => code.includes('cards:'))).toBe(false);
      // Without paragraphs after the run nothing is pushed out, so the cards are made
      const short = section(4, { intro: { heading: 'Atuty', text: ['Jeden.', 'Dwa.', 'Trzy.'], links: [] }, extra: full });
      expect(byId(planRebuild(input([hero, short], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })), 's-4')).toMatchObject({ arrangement: 'card-grid' });
    });

    it('leaves a section as text when the cards would push its items past the cap', () => {
      const items = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Punkt ${i}`, text: [], links: [] }));
      const paragraphs = { heading: 'Atuty', text: ['Jeden.', 'Dwa.', 'Trzy.'], links: [] };
      const over = section(4, { intro: paragraphs, items: items(SITE_SECTIONS_LIMITS.items - 2) });
      const plan = valid(planRebuild(input([hero, over], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })));
      expect(byId(plan, 's-4')).toMatchObject({ arrangement: 'text' });
      expect(byId(plan, 's-4')!.intro.text).toEqual(['Jeden.', 'Dwa.', 'Trzy.']);
      expect(plan.summary.tuning.some((code) => code.includes('cards:'))).toBe(false);
      // Exactly at the cap the cards are made
      const at = section(4, { intro: paragraphs, items: items(SITE_SECTIONS_LIMITS.items - 3) });
      const fits = byId(planRebuild(input([hero, at], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })), 's-4')!;
      expect(fits.arrangement).toBe('card-grid');
      expect(fits.items).toHaveLength(SITE_SECTIONS_LIMITS.items);
    });

    it('leaves a section that does not fit as text, with no code', () => {
      const text = section(4, { intro: { heading: 'Atuty', text: ['Jeden.', 'Dwa.'], links: [] } });
      const plan = valid(planRebuild(input([hero, text], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })));
      expect(byId(plan, 's-4')).toMatchObject({ arrangement: 'text', items: [] });
      expect(plan.summary.tuning.some((code) => code.includes('cards:'))).toBe(false);
    });
  });

  it('shows a list as cards, keeping its items', () => {
    const items = ['Implanty', 'Licówki', 'Wybielanie'].map((title) => ({ title, text: [], links: [] }));
    const list = section(4, { kind: 'services', arrangement: 'list', items });
    const plan = valid(planRebuild(input([hero, list], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })));
    expect(byId(plan, 's-4')).toMatchObject({ arrangement: 'card-grid', items, itemStyle: { border: true } });
    expect(plan.summary.tuning).toContain('modernize:cards:4');
    // Items with a style of their own keep it
    const styled = section(4, { kind: 'services', arrangement: 'list', items, itemStyle: { background: '#f3f4f6', radius: 8 } });
    const kept = byId(planRebuild(input([hero, styled], { modernize: { sections: { 's-4': { arrangement: 'card-grid' } } } })), 's-4')!;
    expect(kept.itemStyle).toMatchObject({ background: '#f3f4f6', radius: 8 });
    expect(kept.itemStyle?.border).toBeUndefined();
  });

  it('fills the media column up to twice the photo width, and moves the photo to the left', () => {
    const plan = valid(planRebuild(anidentInput({ modernize: { sections: { 's-2': { media: 'fill', mediaSide: 'left' } } } })));
    expect(byId(plan, 's-2')).toMatchObject({ mediaFit: 'fill', mediaMax: 704, mediaSide: 'left' });
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['modernize:fill:2', 'modernize:side:2']));
    const wide = section(4, { arrangement: 'media-beside-text', images: [{ src: 'https://x.pl/a.jpg', width: 900 }] });
    expect(byId(planRebuild(input([hero, wide], { modernize: { sections: { 's-4': { media: 'fill' } } } })), 's-4')!.mediaMax).toBe(1200);
  });

  describe('hero photo', () => {
    const photo = 'https://www.anident.pl/images/xanident-klinika-stomatologiczna-warszawa.jpg.pagespeed.ic.yNpcOzSGnX.webp';

    it('splits the hero with a photo from a later section, without changing the reading', () => {
      const base = anidentInput({ modernize: { hero: { photo: 's-2.m0', style: 'split' } } });
      const before = JSON.stringify(base.siteSections);
      const plan = valid(planRebuild(base));
      const s1 = byId(plan, 's-1')!;
      expect(s1).toMatchObject({ arrangement: 'media-beside-text', mediaSide: 'right', mediaFit: 'fill', headingLevel: 1 });
      expect(s1.images[0]).toMatchObject({ src: photo, eager: true });
      expect(byId(plan, 's-2')!.images.map((i) => i.src)).not.toContain(photo);
      expect(plan.summary.tuning).toContain('modernize:hero-photo:s-2.m0');
      // The anident hero's own links all go to other pages and are dropped: it gets the header's CTA
      expect(s1.intro.links).toEqual([{ label: t.sendRequest, href: '#booking', kind: 'booking' }]);
      expect(plan.summary.tuning).toContain('modernize:hero-cta');
      expect(JSON.stringify(base.siteSections)).toBe(before);
    });

    const opening = section(1, { role: 'hero', intro: { heading: 'Stomatologia estetyczna', text: ['Witamy'], links: [] } });
    const gallery = (width: number) => section(3, { arrangement: 'media-beside-text', intro: { heading: 'Gabinet', text: ['Nowoczesny gabinet.'], links: [] },
      images: [{ src: 'https://falcodent.pl/gabinet.jpg', alt: 'Gabinet', width, height: 800 }] });

    it("gives a hero without links the header's call to action", () => {
      const plan = valid(planRebuild(input([header, opening, gallery(600)], { modernize: { hero: { photo: 's-3.m0', style: 'split' } } })));
      expect(byId(plan, 's-1')!.intro.links).toContainEqual({ label: 'Umów wizytę', href: '#booking', kind: 'booking' });
      expect(plan.header.cta.label).toBe('Umów wizytę');
      expect(plan.summary.tuning).toContain('modernize:hero-cta');
      const plain = valid(planRebuild(input([opening, gallery(600)], { modernize: { hero: { photo: 's-3.m0', style: 'split' } } })));
      expect(byId(plain, 's-1')!.intro.links).toEqual([{ label: t.sendRequest, href: '#booking', kind: 'booking' }]);
    });

    it('gives a hero that has a link no call to action', () => {
      const linked = { ...opening, intro: { ...opening.intro, links: [{ label: 'Zadzwoń', href: 'tel:+48510510706', kind: 'phone' as const }] } };
      const plan = valid(planRebuild(input([header, linked, gallery(600)], { modernize: { hero: { photo: 's-3.m0', style: 'split' } } })));
      expect(byId(plan, 's-1')!.intro.links.map((l) => l.kind)).toEqual(['phone']);
      expect(plan.summary.tuning.some((code) => code.endsWith('hero-cta'))).toBe(false);
    });

    it('gives a hero whose only link goes to another page the call to action', () => {
      const away = { ...opening, intro: { ...opening.intro, links: [{ label: 'Cennik', href: 'https://falcodent.pl/cennik/', kind: 'link' as const }] } };
      const plan = valid(planRebuild(input([header, away, gallery(600)], { modernize: { hero: { photo: 's-3.m0', style: 'split' } } })));
      expect(byId(plan, 's-1')!.intro.links).toEqual([{ label: 'Umów wizytę', href: '#booking', kind: 'booking' }]);
      expect(plan.summary.tuning).toContain('modernize:hero-cta');
      expect(plan.summary.omitted).toContainEqual({ what: 'link', reason: 'other_page', sample: 'Cennik' });
    });

    it('lays a wide photo behind the hero as a banner', () => {
      const plan = valid(planRebuild(input([header, opening, gallery(1200)], { modernize: { hero: { photo: 's-3.m0', style: 'banner' } } })));
      const s1 = byId(plan, 's-1')!;
      expect(s1.style).toMatchObject({ backgroundImage: 'https://falcodent.pl/gabinet.jpg', overlay: BANNER_OVERLAY, text: '#ffffff' });
      expect(s1.images).toEqual([]);
      expect(plan.summary.tuning).toEqual(expect.arrayContaining(['overlay:1', 'modernize:hero-photo:s-3.m0']));
      expect(byId(plan, 's-3')!.images).toEqual([]);
    });

    it('omits the source section left empty, and the nav link to it (Review Focus 3)', () => {
      const nav = section(0, { role: 'header', intro: { text: [], links: [{ label: 'Galeria', href: 'https://falcodent.pl/#galeria', kind: 'link' }] } });
      const only = section(3, { arrangement: 'gallery', intro: { text: [], links: [] }, images: [{ src: 'https://falcodent.pl/gabinet.jpg', width: 1200 }] });
      const plan = valid(planRebuild(input([nav, opening, only], { modernize: { hero: { photo: 's-3.m0', style: 'banner' } } })));
      expect(plan.sections.map((s) => s.id)).toEqual(['s-1']);
      expect(plan.summary.omitted).toContainEqual({ what: 'section', reason: 'empty' });
      expect(plan.summary.omitted).toContainEqual({ what: 'nav_link', reason: 'other_page', sample: 'Galeria' });
    });

    it("ignores side and fill on the source section once its only photo moved (Review Focus 1)", () => {
      const plan = valid(planRebuild(anidentInput({ modernize: { hero: { photo: 's-2.m0', style: 'split' } }, edit: { sections: { 's-2': { mediaSide: 'left', media: 'fill' } } } })));
      const s2 = byId(plan, 's-2')!;
      expect(s2.images).toEqual([]);
      expect(s2.mediaFit).toBeUndefined();
      expect(s2.mediaMax).toBeUndefined();
      expect(s2.mediaSide).not.toBe('left');
      expect(plan.summary.tuning.filter((code) => /:(side|fill|style):2$/.test(code))).toEqual([]);
      const small = section(3, { arrangement: 'media-beside-text', intro: { heading: 'Gabinet', text: ['Tekst.'], links: [] }, images: [{ src: 'https://falcodent.pl/g.jpg', width: 600 }] });
      valid(planRebuild(input([opening, small], { modernize: { hero: { photo: 's-3.m0', style: 'split' }, sections: { 's-3': { mediaSide: 'left', media: 'fill' } } } })));
    });
  });

  it('applies the modern type scale', () => {
    const plan = valid(planRebuild(anidentInput({ modernize: { theme: { typeScale: 'modern' } } })));
    expect(plan.theme).toMatchObject({ h1Size: 56, h2Size: 36 });
    expect(plan.theme.bodySize).toBeGreaterThanOrEqual(17);
    expect(plan.summary.tuning).toContain('modernize:type');
    const big = planRebuild(input([hero], { siteSections: read([hero], { typography: { heading: { family: 'Arial', size: 34, weight: 700, uppercase: false }, body: { family: 'Arial', size: 19, weight: 400, color: '#111111' } } }), modernize: { theme: { typeScale: 'modern' } } }));
    expect(big.theme.bodySize).toBe(19);
  });

  it('records modernize style and theme codes for its own fields', () => {
    const plan = valid(planRebuild(anidentInput({ modernize: { sections: { 's-3': { background: 'tinted' } }, theme: { font: 'humanist' } } })));
    expect(byId(plan, 's-3')!.style.background).toBe('#ecf4f6');
    expect(plan.theme.headingFont).toBe(FONT_STACKS.humanist);
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['modernize:style:3', 'modernize:theme']));
    expect(plan.summary.tuning).not.toContain('edit:style:3');
    expect(plan.summary.tuning).not.toContain('edit:theme');
  });

  it("lets the operator's choice win over the modernize layer", () => {
    const plan = valid(planRebuild(anidentInput({
      modernize: { sections: { 's-3': { background: 'tinted' } }, theme: { font: 'humanist' } },
      edit: { sections: { 's-3': { background: 'dark' } }, theme: { font: 'serif' } },
    })));
    expect(byId(plan, 's-3')!.style.background).toBe('#111827');
    expect(plan.summary.tuning).toContain('edit:style:3');
    expect(plan.summary.tuning).not.toContain('modernize:style:3');
    expect(plan.theme).toMatchObject({ headingFont: FONT_STACKS.serif, bodyFont: FONT_STACKS.serif });
    expect(plan.summary.tuning).toContain('edit:theme');
    expect(plan.summary.tuning).not.toContain('modernize:theme');
  });

  it("records the operator's own choice of the new fields as edit codes", () => {
    const plan = valid(planRebuild(anidentInput({ edit: { sections: { 's-9': { arrangement: 'card-grid' }, 's-4': { media: 'fill' } }, theme: { typeScale: 'modern' } } })));
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['edit:cards:9', 'edit:fill:4', 'edit:type']));
    expect(plan.summary.tuning.some((code) => code.startsWith('modernize:'))).toBe(false);
  });
});

describe('planRebuild search and sharing tags (REV-118)', () => {
  const failed = { https: true, viewport: true, title: true, metaDescription: false, singleH1: true, favicon: true, structuredData: false, openGraph: false };

  it('builds the tags from the verified data and the page photo, and validates', () => {
    const plan = planRebuild(input([header, hero, team], { site: { metaDescription: 'Gabinet w Warszawie', paragraphs: [] }, originalUrl: 'https://falcodent.pl/' }));
    expect(plan.seo).toEqual({
      description: 'Gabinet w Warszawie',
      image: 'https://falcodent.pl/hero.jpg',
      locale: 'pl_PL',
      localBusiness: {
        name: 'Falco-Dent',
        url: 'https://falcodent.pl/',
        telephone: '+48 510 510 706',
        email: 'recepcja@falcodent.pl',
        address: 'ul. Kasprowicza 1, Warszawa',
        image: 'https://falcodent.pl/hero.jpg',
        sameAs: ['https://facebook.com/falcodent'],
      },
    });
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  });

  it('records the tags the audit found missing on the original', () => {
    const plan = planRebuild(input([header, hero], { site: { metaDescription: 'Gabinet', paragraphs: [] }, originalStandards: failed }));
    expect(plan.summary.tuning).toEqual(expect.arrayContaining(['seo:description', 'seo:og', 'seo:jsonld']));
  });

  it('records nothing when the original already had the tags or was not measured', () => {
    const had = { ...failed, metaDescription: true, structuredData: true, openGraph: true };
    for (const over of [{ originalStandards: had }, {}]) {
      const plan = planRebuild(input([header, hero], { site: { metaDescription: 'Gabinet', paragraphs: [] }, ...over }));
      expect(plan.summary.tuning.filter((code) => code.startsWith('seo:'))).toEqual([]);
    }
  });

  it('never shares a small or unsized image, taking the first one of at least 200 px a side', () => {
    const images = section(1, { role: 'hero', intro: { heading: 'Witamy', text: ['Tekst'], links: [] }, images: [
      { src: 'https://falcodent.pl/separator.png', alt: '', width: 57, height: 179 },
      { src: 'https://falcodent.pl/unsized.jpg', alt: 'Gabinet' },
      { src: 'https://falcodent.pl/gabinet.jpg', alt: 'Gabinet', width: 800, height: 600 },
    ] });
    expect(planRebuild(input([header, images])).seo.image).toBe('https://falcodent.pl/gabinet.jpg');
  });

  it('falls back to the logo for og:image when no section has a photo', () => {
    const text = section(1, { role: 'hero', intro: { heading: 'Witamy', text: ['Tekst'], links: [] } });
    expect(planRebuild(input([header, text])).seo.image).toBe('https://falcodent.pl/logo.png');
  });
});

describe('planRebuild change codes and their facts (REV-119)', () => {
  const recorded = (name: string): { siteSections: ISiteSections; answer: IRebuildModernizeAnswer } =>
    JSON.parse(readFileSync(new URL(`./fixtures/modernize/${name}.json`, import.meta.url), 'utf8'));

  /** Every code and omission a plan records has an entry in the vocabulary the dashboard explains */
  const expectExplainable = (plan: IRebuildPlan) => {
    for (const code of plan.summary.tuning) expect(parseRebuildChange(code), code).toBeDefined();
    for (const { what, reason } of plan.summary.omitted) {
      expect(REBUILD_OMISSION_REASONS[what] as readonly string[], `${what}:${reason}`).toContain(reason);
    }
    for (const fact of plan.summary.facts ?? []) expect(plan.summary.tuning).toContain(fact.code);
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
  };

  it('records only codes and omissions the dashboard explains, on recorded pages at both levels', () => {
    for (const name of ['anident', 'falcodent']) {
      const { siteSections, answer } = recorded(name);
      expectExplainable(planRebuild(input(siteSections.sections, { siteSections })));
      expectExplainable(planRebuild(input(siteSections.sections, { siteSections, modernize: answer })));
    }
  });

  it('records the codes of the operator edit and every fix, each one explainable', () => {
    const pale = section(2, { intro: { heading: 'Nasze usługi', text: ['x'.repeat(2000)], links: [] }, style: { background: '#ffffff', textColor: '#bbbbbb' } });
    const form = section(3, { intro: { heading: 'Kontakt', text: ['Napisz'], links: [] },
      embeds: [{ kind: 'form' }, { kind: 'form' }, { kind: 'video', src: 'https://evil.example/v' }] });
    const photos = section(4, { arrangement: 'media-beside-text', intro: { heading: 'Gabinet', text: ['Tekst'], links: [
      { label: 'Blog', href: 'https://falcodent.pl/blog/', kind: 'link' }, { label: '', href: 'https://falcodent.pl/x', kind: 'link' },
    ] }, images: [{ src: 'https://falcodent.pl/g.jpg', width: 1200, height: 800 }, { src: 'data:image/png;base64,AA' }] });
    const cards = section(5, { intro: { heading: 'Dlaczego my', text: ['Jeden.', 'Dwa.', 'Trzy.', 'Cztery.'], links: [] } });
    const plain = section(1, { role: 'hero', intro: { heading: 'Witamy', text: ['Tekst'], links: [] } });
    const sections = [header, plain, pale, form, photos, cards, section(6), section(7)];
    const siteSections = read(sections, {
      skipped: [{ reason: 'noise', sample: 'Cookies' }],
      typography: { heading: { size: 30 }, body: { size: 14, lineHeight: 1.3 } },
    } as Partial<ISiteSections>);
    const plan = planRebuild(input(sections, {
      siteSections,
      edit: {
        auditId: 'a1',
        order: ['s-2', 's-1'],
        hidden: ['s-6'],
        dropped: ['s-7.t0'],
        sections: { 's-4': { mediaSide: 'left', media: 'fill', background: 'tinted' }, 's-5': { arrangement: 'card-grid' } },
        theme: { font: 'serif', typeScale: 'modern' },
        customCss: 'body { color: red',
      },
    }));
    expectExplainable(plan);
    expect(plan.summary.tuning).toEqual(expect.arrayContaining([
      'contrast:2', 'collapse:2', 'font:body-16', 'line-height:1.5', 'booking:replaced', 'edit:order', 'edit:side:4', 'edit:fill:4',
      'edit:style:4', 'edit:cards:5', 'edit:type', 'edit:theme',
    ]));
    expect(plan.summary.omitted.map((o) => `${o.what}:${o.reason}`)).toEqual(expect.arrayContaining([
      'section:noise', 'section:hidden', 'embed:second_form', 'embed:host_not_allowed', 'link:other_page', 'image:not_http',
    ]));
  });

  it('records the measured values behind a code, with the heading of its section', () => {
    const pale = section(2, { intro: { heading: 'Nasze usługi', text: ['Tekst'], links: [] }, style: { background: '#ffffff', textColor: '#bbbbbb' } });
    const siteSections = read([header, hero, pale], { typography: { heading: { size: 30 }, body: { size: 14.4, lineHeight: 1.25 } } } as Partial<ISiteSections>);
    const plan = planRebuild(input([header, hero, pale], { siteSections }));
    const facts = new Map((plan.summary.facts ?? []).map(({ code, ...fact }) => [code, fact]));
    const contrast = facts.get('contrast:2')!;
    expect(contrast).toMatchObject({ section: 'Nasze usługi', from: '#bbbbbb', background: '#ffffff' });
    expect(contrast.ratioBefore).toBeLessThan(4.5);
    expect(contrast.ratioAfter).toBeGreaterThanOrEqual(4.5);
    expect(contrast.ratioAfter).toBe(Math.floor(contrastRatio(String(contrast.to), '#ffffff') * 100) / 100);
    expect(facts.get('overlay:1')).toEqual({ section: 'Stomatologia estetyczna', value: BANNER_OVERLAY });
    expect(facts.get('font:body-16')).toEqual({ from: 14, to: 16 });
    expect(facts.get('line-height:1.5')).toEqual({ from: 1.25, to: 1.5 });
  });

  it('records an empty facts list when nothing was measured, so it reads apart from a summary saved before facts', () => {
    const plain = section(1, { role: 'hero', intro: { heading: 'Witamy', text: ['Tekst'], links: [] } });
    expect(planRebuild(input([header, plain])).summary.facts).toEqual([]);
  });

  it('records no fact for a section the page does not render', () => {
    const pale = section(2, { arrangement: 'card-grid', intro: { text: [], links: [] }, style: { background: '#ffffff', textColor: '#eeeeee' },
      items: [{ text: [], links: [{ label: 'Implanty', href: 'https://falcodent.pl/implanty/', kind: 'link' }] }] });
    const plan = planRebuild(input([header, hero, pale]));
    expect(plan.summary.tuning).not.toContain('contrast:2');
    expect(plan.summary.facts!.map((fact) => fact.code)).not.toContain('contrast:2');
  });
});
