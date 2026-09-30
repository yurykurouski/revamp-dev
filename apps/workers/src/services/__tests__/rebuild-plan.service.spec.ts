import { describe, expect, it } from 'vitest';
import type { ISiteSection, ISiteSections } from '@revamp/shared-types';
import { RebuildPlanSchema } from '@revamp/validation';
import { planRebuild, RebuildInput } from '../rebuild-plan.service.js';
import { contrastRatio } from '../rebuild-tuning.js';
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
    // Each slide carries its photo; the section keeps none of its own, and captions are white over the overlay
    expect(hero.style.backgroundImage).toBeUndefined();
    expect(hero.style.text).toBe('#ffffff');
    expect(hero.style.overlay).toBeGreaterThan(0);
    expect(() => RebuildPlanSchema.parse(plan)).not.toThrow();
    // A slider of reviews further down stays a slider of cards
    const reviews = section(2, { arrangement: 'slider', items: [{ title: 'Anna', text: ['Polecam'], image: { src: 'https://falcodent.pl/a.jpg' }, links: [] }] });
    expect(planRebuild(input([header, slides, reviews])).sections[1]!.photoSlides).toBeUndefined();
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
