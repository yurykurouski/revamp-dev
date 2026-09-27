import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { IBentoTemplateData, MVP_LAYOUT_VARIANTS, MvpLayoutVariant } from '@revamp/shared-types';
import { BentoTemplateService, bentoTemplateService } from '../../services/template.service.js';
import { LAYOUT_SECTION_ORDER } from '../bento.template.js';

const data: IBentoTemplateData = {
  businessName: 'Warsaw Dental Center',
  palette: { primary: '#0e7490', secondary: '#1e293b', accent: '#0e7490' },
  contacts: {
    phone: '+48 22 542 18 04',
    email: 'kontakt@wdc.example',
    address: 'ul. Powstańców Śląskich 7a, Warszawa',
    workingHours: 'Pon - Pt 09:00 — 21:00',
  },
  hero: { headline: 'Best dental clinic in Warsaw', subheadline: 'English-speaking dentists since 2010.' },
  about: { heading: 'About us', body: 'Family clinic in the heart of Warsaw.' },
  services: [
    { title: 'Veneers', description: 'Thin ceramic shells.', lucideIconName: 'sparkles' },
    { title: 'Implants', description: 'Titanium & ceramic.', lucideIconName: 'shield-check' },
  ],
  trustSignals: [{ metric: '14 yrs', label: 'In Warsaw' }],
  reviews: [{ author: 'Abhijit C.', comment: 'Doctors speak English fluently.', source: 'Website' }],
  heroImageUrl: 'https://wdc.example/hero.jpg',
  gallery: ['https://wdc.example/1.jpg', 'https://wdc.example/2.jpg', 'https://wdc.example/3.jpg'],
};

const windows: Window[] = [];

/** Opens the rendered MVP in happy-dom with its inline scripts running, as the preview iframe does */
async function openPage(
  layout: MvpLayoutVariant,
  overrides: Partial<IBentoTemplateData> = {},
  options: { reducedMotion?: boolean } = {},
): Promise<Window> {
  const window = new Window({
    url: 'https://mvp.example/',
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      ...(options.reducedMotion ? { device: { prefersReducedMotion: 'reduce' } } : {}),
    },
  });
  windows.push(window);
  window.document.write(bentoTemplateService.render({ ...data, ...overrides, layout }));
  await window.happyDOM.waitUntilComplete();
  return window;
}

/** Posts a message to the page the way the dashboard does, and waits for it to be handled */
async function send(window: Window, message: unknown): Promise<void> {
  window.postMessage(message, '*');
  await window.happyDOM.waitUntilComplete();
}

const text = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();

/** What the visitor sees of a page, in DOM order */
function snapshot(window: Window) {
  const doc = window.document;
  return {
    bodyClass: doc.body.className,
    hero: doc.querySelector('[data-revamp-part="hero"]')?.className,
    services: doc.querySelector('[data-revamp-part="services"]')?.className,
    sections: Array.from(doc.querySelectorAll('main > section')).map((section) => section.id || section.className),
    aboutReverse: doc.getElementById('about')?.classList.contains('about-reverse'),
    layoutCss: text(doc.getElementById('revamp-layout-css')?.textContent),
    mainText: text(doc.querySelector('main')?.textContent),
  };
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

describe('live MVP layout switch (REV-84)', () => {
  const pairs = MVP_LAYOUT_VARIANTS.flatMap((from) =>
    MVP_LAYOUT_VARIANTS.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it.each(pairs)('switches from %s to %s into the page a fresh render of that layout shows', async (from, to) => {
    const switched = await openPage(from);
    await send(switched, { type: 'REVAMP_SET_LAYOUT', layout: to, animate: false });
    const fresh = await openPage(to);

    expect(snapshot(switched)).toEqual(snapshot(fresh));
    expect(snapshot(switched).sections.slice(1)).toEqual([...LAYOUT_SECTION_ORDER[to], 'booking']);
  });

  it('switches back to the original layout with the original elements', async () => {
    const window = await openPage('split');
    const before = snapshot(window);
    const hero = window.document.querySelector('[data-revamp-part="hero"]');

    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'editorial', animate: false });
    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'compact', animate: false });
    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: false });

    expect(snapshot(window)).toEqual(before);
    expect(window.document.querySelector('[data-revamp-part="hero"]')).toBe(hero);
  });

  it('keeps the booking form working after a switch', async () => {
    const window = await openPage('bento');
    const form = window.document.getElementById('lead-booking-form');
    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'compact', animate: false });
    expect(window.document.getElementById('lead-booking-form')).toBe(form);
    expect(window.document.querySelectorAll('#lead-booking-form')).toHaveLength(1);
  });

  it('ignores unknown layouts, the current layout and other messages', async () => {
    const window = await openPage('bento');
    const before = snapshot(window);
    for (const message of [
      { type: 'REVAMP_SET_LAYOUT', layout: 'masonry' },
      { type: 'REVAMP_SET_LAYOUT', layout: 'toString' },
      { type: 'REVAMP_SET_LAYOUT', layout: 'bento' },
      { type: 'REVAMP_SET_LAYOUT' },
      { type: 'SOMETHING_ELSE', layout: 'split' },
      null,
      'split',
    ]) {
      await send(window, message);
    }
    expect(snapshot(window)).toEqual(before);
  });

  it('animates the switch with a View Transition when the browser has one', async () => {
    const window = await openPage('bento');
    const startViewTransition = vi.fn((update: () => void) => update());
    Object.assign(window.document, { startViewTransition });

    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'split' });

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(snapshot(window).bodyClass).toBe('layout-split');
  });

  it('switches instantly without a transition when asked not to animate', async () => {
    const window = await openPage('bento');
    const startViewTransition = vi.fn((update: () => void) => update());
    Object.assign(window.document, { startViewTransition });

    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: false });

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(snapshot(window).bodyClass).toBe('layout-split');
  });

  it('switches instantly for visitors who prefer reduced motion', async () => {
    const window = await openPage('bento', {}, { reducedMotion: true });
    const startViewTransition = vi.fn((update: () => void) => update());
    Object.assign(window.document, { startViewTransition });

    await send(window, { type: 'REVAMP_SET_LAYOUT', layout: 'compact' });

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(snapshot(window).bodyClass).toBe('layout-compact');
  });

  it('ships the transition styles and names the parts that glide', async () => {
    const html = bentoTemplateService.render({ ...data, layout: 'bento' });
    expect(html).toContain('view-transition-name: revamp-hero');
    expect(html).toContain('::view-transition-old(*)');
    expect(html).toContain('::view-transition-new(revamp-header) { animation: none; }');
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*::view-transition-group/);
  });

  it.each(MVP_LAYOUT_VARIANTS)('stays within the bundle size limit with every layout embedded (%s)', (layout) => {
    const long = (length: number) => '&<>"'.repeat(Math.ceil(length / 4)).slice(0, length);
    const heavy: IBentoTemplateData = {
      ...data,
      businessName: long(100),
      contacts: { phone: '+48 22 542 18 04', email: 'kontakt@wdc.example', address: long(150), workingHours: long(100) },
      hero: {
        badge: long(50),
        headline: long(120),
        subheadline: long(250),
        primaryCtaText: long(40),
        secondaryCtaText: long(40),
      },
      about: { heading: long(80), body: long(900) },
      servicesHeading: long(80),
      services: Array.from({ length: 10 }, () => ({
        title: long(60),
        description: long(200),
        badge: long(30),
        lucideIconName: 'sparkles',
      })),
      trustSignals: Array.from({ length: 4 }, () => ({ metric: long(25), label: long(60) })),
      reviews: Array.from({ length: 6 }, () => ({ author: long(60), comment: long(300), rating: 5 })),
      gallery: Array.from({ length: 8 }, (_, i) => `https://wdc.example/${'g'.repeat(200)}${i}.jpg`),
      footerTagline: long(300),
    };
    // render() throws above the limit; the size is asserted too so a regression shows the number
    const html = bentoTemplateService.render({ ...heavy, layout });
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(BentoTemplateService.MAX_BUNDLE_SIZE_BYTES);
    for (const other of MVP_LAYOUT_VARIANTS.filter((variant) => variant !== layout)) {
      expect(html).toContain(`<template data-revamp-layout="${other}">`);
    }
    expect(html).not.toContain(`<template data-revamp-layout="${layout}">`);
  });
});
