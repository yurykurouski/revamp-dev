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
});
