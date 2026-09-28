import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { IBentoTemplateData, IMvpDesign, MVP_LAYOUT_VARIANTS, MvpLayoutVariant } from '@revamp/shared-types';
import { bentoTemplateService } from '../../services/template.service.js';
import { LAYOUT_SECTION_ORDER, generateBentoHtml } from '../bento.template.js';
import { designCss, elementDeclarations, hasDesign, renderDesignBlock, resolveSectionOrder } from '../design.js';

const data: IBentoTemplateData = {
  businessName: 'Warsaw Dental Center',
  palette: { primary: '#0e7490', secondary: '#1e293b', accent: '#0e7490' },
  contacts: { phone: '+48 22 542 18 04', email: 'kontakt@wdc.example', address: 'ul. Powstańców 7a, Warszawa' },
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

const design: IMvpDesign = {
  sectionOrder: ['reviews', 'block-1', 'services'],
  hidden: ['gallery', 'trust'],
  hero: { align: 'left', order: ['headline', 'actions', 'subheadline'] },
  theme: { font: 'serif-display', density: 'airy', corners: 'sharp', heroStyle: 'dark' },
  elements: { 'hero.headline': { size: '2xl', weight: 'black' }, 'cta.primary': { radius: 'pill', background: 'accent' } },
  blocks: [
    { id: 'block-1', type: 'highlight', style: 'brand', title: 'Open since <2010>', body: 'English-speaking team.' },
    { id: 'block-2', type: 'cta', title: 'Book your visit', buttonText: 'Book now' },
  ],
};

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

async function openPage(layout: MvpLayoutVariant, pageDesign: IMvpDesign | undefined = design): Promise<Window> {
  const window = new Window({
    url: 'https://mvp.example/',
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  windows.push(window);
  window.document.write(bentoTemplateService.render({ ...data, layout, design: pageDesign }));
  await window.happyDOM.waitUntilComplete();
  return window;
}

const sections = (window: Window) =>
  Array.from(window.document.querySelectorAll('main > section')).map((section) => section.id || section.className);

describe('MVP design spec (REV-92)', () => {
  describe('hasDesign', () => {
    it.each([undefined, null, {}, { hidden: [] }, { hero: {} }, { elements: { 'hero.badge': {} } }, { hero: { order: [] } }])(
      'treats %j as no design',
      (value) => expect(hasDesign(value as IMvpDesign)).toBe(false),
    );
    it('sees any real choice', () => {
      expect(hasDesign({ theme: { corners: 'sharp' } })).toBe(true);
      expect(hasDesign({ elements: { 'hero.badge': { size: 'lg' } } })).toBe(true);
    });
  });

  describe('resolveSectionOrder', () => {
    const layoutOrder = LAYOUT_SECTION_ORDER.bento;
    it('keeps the layout order without a design', () => {
      expect(resolveSectionOrder(layoutOrder, undefined)).toEqual(layoutOrder);
    });
    it('puts listed sections first, then the rest in layout order, then the other blocks', () => {
      expect(resolveSectionOrder(layoutOrder, design)).toEqual([
        'reviews',
        'block-1',
        'services',
        'about',
        'gallery',
        'block-2',
      ]);
    });
    it('ignores a listed block the design does not define', () => {
      expect(resolveSectionOrder(layoutOrder, { sectionOrder: ['block-3', 'gallery'] })).toEqual([
        'gallery',
        'about',
        'services',
        'reviews',
      ]);
    });
  });

  describe('designCss', () => {
    it('is empty without a design', () => {
      expect(designCss(undefined)).toBe('');
      expect(designCss({})).toBe('');
    });

    it('scales an element size from the template default', () => {
      expect(elementDeclarations('hero.headline', { size: '2xl' })).toEqual(['font-size: clamp(3.9rem, 9.75vw, 6.825rem)']);
      expect(elementDeclarations('about.body', { size: 'sm' })).toEqual(['font-size: 0.88rem']);
      // Boxes have no text size of their own
      expect(elementDeclarations('service.card', { size: 'xl' })).toEqual([]);
    });

    it('maps color tokens to palette roles and adds light text on dark backgrounds', () => {
      expect(elementDeclarations('cta.primary', { background: 'accent' })).toEqual([
        'color: #ffffff',
        'background: var(--brand-accent)',
      ]);
      expect(elementDeclarations('cta.primary', { background: 'primary', color: 'text' })).toEqual([
        'color: var(--color-text-main)',
        'background: var(--brand-primary)',
      ]);
    });

    it('writes each part of the design as !important rules', () => {
      const css = designCss(design);
      expect(css).toContain("font-family: 'Iowan Old Style'");
      expect(css).toContain('.hero-section { padding-top: 5.25rem !important; padding-bottom: 3.75rem !important; }');
      expect(css).toContain('--radius-xl: 0 !important');
      expect(css).toContain('.hero-section { background: #0f172a !important; }');
      expect(css).toContain('text-align: left !important');
      expect(css).toContain('.hero-section .hero-headline { order: 0 !important; }');
      expect(css).toContain('.hero-section .hero-actions { order: 1 !important; }');
      expect(css).toContain('.hero-section .hero-badge { order: 3 !important; }');
      expect(css).toContain('body.revamp-designed .hero-headline { font-size: clamp(');
      expect(css).toContain('body.revamp-designed [data-revamp-cta="primary-booking"] { color: #ffffff !important; background: var(--brand-accent) !important; border-radius: 9999px !important; }');
      expect(css).toContain('.revamp-block-brand');
      // No external resources, ever
      expect(css).not.toMatch(/url\(|@import|@font-face/);
    });

    it('puts element styles after the hero style, so an element style set on purpose wins', () => {
      const css = designCss({ theme: { heroStyle: 'dark' }, elements: { 'hero.headline': { color: 'primary' } } });
      expect(css.indexOf('.hero-section .hero-headline')).toBeLessThan(css.indexOf('body.revamp-designed .hero-headline'));
    });

    it.each(['dark', 'brand'] as const)('keeps the hero badge and buttons readable on a %s hero', (heroStyle) => {
      const css = designCss({ theme: { heroStyle } });
      expect(css).toContain('.hero-section .hero-badge { background: rgba(255, 255, 255, 0.1) !important; color: #e2e8f0 !important;');
      expect(css).toContain('.hero-section .btn-secondary { background: transparent !important; color: #ffffff !important;');
    });

    it('rings the primary button on a dark hero, whatever the brand color', () => {
      expect(designCss({ theme: { heroStyle: 'dark' } })).toContain(
        '.hero-section .btn-primary { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35) !important; }',
      );
    });

    it('moves the split hero photo to the left on wide screens', () => {
      expect(designCss({ hero: { imageSide: 'left' } })).toContain('.hero-split-image { order: -1 !important; }');
    });
  });

  describe('custom blocks', () => {
    it('renders each type with escaped text, a booking link for a CTA and a known icon', () => {
      const highlight = renderDesignBlock(design.blocks![0]!);
      expect(highlight).toContain('data-revamp-section="block-1"');
      expect(highlight).toContain('revamp-block-highlight revamp-block-brand');
      expect(highlight).toContain('Open since &lt;2010&gt;');

      const cta = renderDesignBlock(design.blocks![1]!);
      expect(cta).toContain('href="#booking"');
      expect(cta).toContain('data-revamp-cta="block"');
      expect(cta).toContain('revamp-block-plain');

      const features = renderDesignBlock({
        id: 'block-3',
        type: 'features',
        title: 'Why us',
        items: [{ title: 'Calm care', text: 'Sedation available', icon: 'not-an-icon' }],
      });
      expect(features).toContain('revamp-feature-title">Calm care');
      expect(features).toContain('<svg');
    });
  });

  describe('rendered page', () => {
    it('renders identically with no design or an empty one', () => {
      const stamp = (html: string) => html.replace(/© \d+/, '');
      for (const layout of MVP_LAYOUT_VARIANTS) {
        expect(stamp(generateBentoHtml({ ...data, layout, design: {} }))).toBe(stamp(generateBentoHtml({ ...data, layout })));
      }
    });

    it('adds the custom CSS in its own style after the design styles (REV-93)', () => {
      const html = generateBentoHtml({
        ...data,
        design: { theme: { corners: 'sharp' }, customCss: '/* x */ .hero-headline { letter-spacing: .1em; }' },
      });
      const designAt = html.indexOf('<style id="revamp-design-css">');
      const customAt = html.indexOf('<style id="revamp-custom-css">');
      expect(designAt).toBeGreaterThan(0);
      expect(customAt).toBeGreaterThan(designAt);
      expect(html).toContain('.hero-headline { letter-spacing: .1em; }');
      expect(html).not.toContain('/* x */');
    });

    it('treats custom CSS alone as a design, and leaves out CSS that fails the check', () => {
      expect(hasDesign({ customCss: '.hero-badge { color: red; }' })).toBe(true);
      expect(generateBentoHtml({ ...data, design: { customCss: '.hero-badge { color: red; }' } })).toContain('revamp-custom-css');
      const unsafe = generateBentoHtml({ ...data, design: { customCss: '.site-footer { display: none; }' } });
      expect(unsafe).not.toContain('revamp-custom-css');
      expect(unsafe).not.toContain('.site-footer { display: none; }');
    });

    it('orders sections and blocks, drops hidden ones and keeps the hero and booking form', async () => {
      const page = await openPage('bento');
      const doc = page.document;
      expect(sections(page)).toEqual(['hero-section', 'reviews', 'block-1', 'services', 'about', 'block-2', 'booking']);
      expect(doc.getElementById('gallery')).toBeNull();
      expect(doc.querySelector('.trust-signals-bar')).toBeNull();
      expect(doc.body.classList.contains('revamp-designed')).toBe(true);
      expect(doc.getElementById('revamp-design-css')?.textContent).toContain('revamp-designed');
      // Verified contacts stay wherever the design moves things
      expect(doc.querySelector('.site-footer')?.textContent).toContain('+48 22 542 18 04');
    });

    it.each(MVP_LAYOUT_VARIANTS.filter((layout) => layout !== 'bento'))(
      'keeps the design order after a live switch to %s',
      async (to) => {
        const page = await openPage('bento');
        page.postMessage({ type: 'REVAMP_SET_LAYOUT', layout: to, animate: false }, '*');
        await page.happyDOM.waitUntilComplete();
        const fresh = await openPage(to);
        expect(sections(page).slice(1)).toEqual(sections(fresh).slice(1));
        expect(sections(page).slice(1, 4)).toEqual(['reviews', 'block-1', 'services']);
        // The hidden trust bar stays hidden in the switched-in hero
        expect(page.document.querySelector('.trust-signals-bar')).toBeNull();
      },
    );
  });
});
