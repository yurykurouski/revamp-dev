import { describe, it, expect } from 'vitest';
import { BentoTemplateService, bentoTemplateService } from '../template.service.js';
import { resolveTrackerUrls } from '../../templates/bento.template.js';
import { env } from '../../config/env.js';
import { IBentoTemplateData, ILead, IAudit, MVP_LAYOUT_VARIANTS } from '@revamp/shared-types';

describe('BentoTemplateService (@revamp/workers)', () => {
  const sampleTemplateData: IBentoTemplateData = {
    businessName: 'Dent-Prestige Dental',
    niche: 'dental',
    palette: {
      primary: '#5c5bed',
      secondary: '#b8c4fe',
      accent: '#5c5bed',
    },
    contacts: {
      phone: '+7 (812) 345-67-89',
      email: 'dent@dentprestige.ru',
      address: '45 Ligovsky Avenue',
      workingHours: 'Mon-Sat: 08:00 - 21:00',
      city: 'Saint Petersburg',
    },
    hero: {
      badge: '✨ Special offer of the month',
      headline: 'A beautiful, healthy smile in 1 visit at Dent-Prestige',
      subheadline: 'Pain-free treatment to international standards with a 5-year guarantee.',
      primaryCtaText: 'Book an appointment',
      secondaryCtaText: 'Call the clinic',
    },
    services: [
      {
        title: 'Dental implants',
        description: 'Premium turnkey Swiss implants with a lifetime guarantee.',
        lucideIconName: 'shield-check',
        badge: 'Top pick',
        highlight: true,
      },
      {
        title: 'Laser whitening',
        description: 'Safely whitens enamel up to 8 shades in 45 minutes.',
        lucideIconName: 'sparkles',
      },
      {
        title: 'Bite correction',
        description: 'Aligners and modern braces for a perfect smile.',
        lucideIconName: 'smile',
      },
      {
        title: 'Urgent care & diagnostics',
        description: 'Fast relief of acute pain and precise 3D imaging.',
        lucideIconName: 'activity',
      },
    ],
    trustSignals: [
      { metric: '4.9 ★', label: 'Rating on Google Maps' },
      { metric: '14 yrs', label: 'Of practice in Saint Petersburg' },
      { metric: '8,000+', label: 'Happy, healthy patients' },
    ],
    reviews: [
      {
        author: 'Olivia Wilson',
        rating: 5,
        comment: 'A very professional approach! The treatment was completely painless.',
        date: 'Yesterday',
        source: 'Google Maps',
      },
    ],
    trackingToken: 'track_token_abc123',
    publicApiUrl: 'http://localhost:4000/api/v1',
  };

  it('should render a valid, self-contained HTML5 document', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(html).toContain('</html>');
  });

  it('should satisfy strict bundle size constraint (< 300 KB DoD)', () => {
    const html = bentoTemplateService.render(sampleTemplateData);
    const byteLength = Buffer.byteLength(html, 'utf8');

    // Total size should be far below 300 KB limit (typically ~25-45 KB)
    expect(byteLength).toBeLessThan(BentoTemplateService.MAX_BUNDLE_SIZE_BYTES);
    expect(byteLength).toBeLessThan(75 * 1024); // Less than 75 KB
    expect(byteLength).toBeGreaterThan(5 * 1024);
  });

  it('should inject dynamic CSS variables based on extracted palette', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('--brand-primary: #5c5bed;');
    expect(html).toContain('--brand-secondary: #b8c4fe;');
    expect(html).toContain('--brand-accent: #5c5bed;');
    expect(html).toContain('--brand-primary-rgb: 92, 91, 237;');
  });

  it('should render Module 1: Sticky Header with 1-click call and booking anchor', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('class="site-header"');
    expect(html).toContain('Dent-Prestige');
    expect(html).toContain('href="tel:+78123456789"');
    expect(html).toContain('href="#booking"');
  });

  it('should render Module 2: Hero Section with headline, CTAs, and trust signals', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('class="hero-section"');
    expect(html).toContain('Special offer of the month');
    expect(html).toContain('A beautiful, healthy smile in 1 visit at Dent-Prestige');
    expect(html).toContain('Book an appointment');
    expect(html).toContain('Call the clinic');
    expect(html).toContain('4.9 ★');
    expect(html).toContain('14 yrs');
  });

  it('should render Module 3: Bento Services Grid with Lucide SVG icons', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('class="bento-grid"');
    expect(html).toContain('Dental implants');
    expect(html).toContain('Laser whitening');
    expect(html).toContain('bento-card-large');
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  });

  it('should render Module 4: Social Proof & Reviews with author and rating', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('class="reviews-section"');
    expect(html).toContain('Olivia Wilson');
    expect(html).toContain('Google Maps');
    expect(html).toContain('The treatment was completely painless');
  });

  it('should render Module 5: Interactive Booking Form with accessible inputs and success state', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('id="lead-booking-form"');
    expect(html).toContain('id="lead-name"');
    expect(html).toContain('id="lead-phone"');
    expect(html).toContain('id="lead-service"');
    expect(html).toContain('id="booking-submit-btn"');
    expect(html).toContain('id="booking-success-message"');
    expect(html).toContain('Thank you for reaching out!');
    expect(html).toContain('track_token_abc123'); // Telemetry token in client script
  });

  it('should render Module 6: Footer with contact info and Revamp attribution', () => {
    const html = bentoTemplateService.render(sampleTemplateData);

    expect(html).toContain('class="site-footer"');
    expect(html).toContain('45 Ligovsky Avenue');
    expect(html).toContain('Mon-Sat: 08:00 - 21:00');
    expect(html).toContain('Prototype built by the Revamp platform');
  });

  it('should render monogram fallback when no logoUrl is provided', () => {
    const html = bentoTemplateService.render({
      ...sampleTemplateData,
      logoUrl: undefined,
      monogramSvg: undefined,
    });

    expect(html).toContain('brand-logo-fallback');
    expect(html).toContain('<svg');
  });

  it('should render custom logo image when logoUrl is provided', () => {
    const html = bentoTemplateService.render({
      ...sampleTemplateData,
      logoUrl: 'https://listonosz.site/favicon.svg',
    });

    expect(html).toContain('<img src="https://listonosz.site/favicon.svg"');
    expect(html).toContain('class="brand-logo-img"');
  });

  it('should render SVG monogram when monogramSvg is provided', () => {
    const monogram = '<svg id="custom-monogram"><circle cx="10" cy="10" r="10"/></svg>';
    const html = bentoTemplateService.render({
      ...sampleTemplateData,
      logoUrl: undefined,
      monogramSvg: monogram,
    });

    expect(html).toContain('<div class="brand-logo-monogram">');
    expect(html).toContain('id="custom-monogram"');
  });

  describe('favicon (REV-56)', () => {
    const iconHrefs = (html: string) =>
      [...html.matchAll(/<link rel="icon" href="([^"]*)">/g)].map((m) => m[1].replace(/&#039;/g, "'").replace(/&amp;/g, '&'));

    it('uses the site logo as the icon when the logo URL is known', () => {
      const html = bentoTemplateService.render({
        ...sampleTemplateData,
        logoUrl: 'https://listonosz.site/logo.png?v=1&size=2',
      });

      expect(iconHrefs(html)).toEqual(['https://listonosz.site/logo.png?v=1&size=2']);
      expect(html).toContain('href="https://listonosz.site/logo.png?v=1&amp;size=2"');
    });

    it('inlines the monogram SVG as a data URI when there is no logo URL', () => {
      const monogram = '<svg id="custom-monogram"><circle cx="10" cy="10" r="10"/></svg>';
      const html = bentoTemplateService.render({ ...sampleTemplateData, logoUrl: undefined, monogramSvg: monogram });

      const [href] = iconHrefs(html);
      expect(href.startsWith('data:image/svg+xml,')).toBe(true);
      expect(decodeURIComponent(href.slice('data:image/svg+xml,'.length))).toBe(monogram);
    });

    it('inlines the generated initials monogram when the site has no logo or monogram', () => {
      const html = bentoTemplateService.render({ ...sampleTemplateData, logoUrl: undefined, monogramSvg: undefined });

      const [href] = iconHrefs(html);
      expect(href.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('fill="#5c5bed"');
      expect(svg).toContain('>DD</text>');
    });

    it('declares exactly one icon inside <head> in every layout', () => {
      for (const layout of MVP_LAYOUT_VARIANTS) {
        const html = bentoTemplateService.render({ ...sampleTemplateData, layout });
        const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
        expect(iconHrefs(head)).toHaveLength(1);
        expect(iconHrefs(html)).toHaveLength(1);
      }
    });
  });

  it('should fallback gracefully on unknown Lucide icons', () => {
    const html = bentoTemplateService.render({
      ...sampleTemplateData,
      services: [
        {
          title: 'Custom Service',
          description: 'Description',
          lucideIconName: 'non-existent-icon-xyz',
        },
      ],
    });

    // Should still render a valid SVG (the sparkles fallback)
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  });

  it('should escape HTML to prevent XSS injection in content', () => {
    const xssData: IBentoTemplateData = {
      ...sampleTemplateData,
      businessName: 'Clean & Safe <script>alert("xss")</script>',
      hero: {
        ...sampleTemplateData.hero,
        headline: 'Dangerous <img src=x onerror=alert(1)> Headline',
      },
    };

    const html = bentoTemplateService.render(xssData);

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('should renderFromAudit constructing a complete template from Mongo Lead & Audit', () => {
    const lead: Partial<ILead> = {
      businessName: 'Listonosz Auto Service',
      niche: 'auto',
      contactPhone: '+48 500 123 456',
      contactEmail: 'contact@listonosz.site',
      city: 'Warsaw',
    };

    const audit: Partial<IAudit> = {
      extractedBrandTokens: {
        primaryColor: '#5c5bed',
        secondaryColor: '#b8c4fe',
        accentColor: '#5c5bed',
        fontFamilies: ['Inter', 'sans-serif'],
      },
    };

    const html = bentoTemplateService.renderFromAudit(lead, audit);

    expect(html).toContain('Listonosz Auto Service');
    expect(html).toContain('--brand-primary: #5c5bed;');
    expect(html).toContain('+48 500 123 456');
    expect(html).toContain('class="bento-grid"');
  });

  describe('MVP language (REV-25)', () => {
    it('declares the site language and localises the template chrome', () => {
      const html = bentoTemplateService.render({ ...sampleTemplateData, language: 'pl' });
      expect(html).toContain('<html lang="pl">');
      expect(html).toContain('Godziny otwarcia');
      expect(html).toContain('Wszelkie prawa zastrzeżone.');
      expect(html).toContain('<span>Umów się</span>');
      expect(html).not.toContain('Opening hours');
      expect(html).not.toContain('Book now');
    });

    it('keeps English chrome but the real lang attribute for languages without a dictionary', () => {
      const html = bentoTemplateService.render({ ...sampleTemplateData, language: 'de' });
      expect(html).toContain('<html lang="de">');
      expect(html).toContain('Opening hours');
    });

    it('keeps the full site language tag and still localises by its primary subtag', () => {
      const html = bentoTemplateService.render({ ...sampleTemplateData, language: 'ru-BY' });
      expect(html).toContain('<html lang="ru-BY">');
      expect(html).toContain('Часы работы');
    });

    it('normalises underscores and drops malformed site language tags when rendering from an audit', () => {
      const site = { headings: [], paragraphs: [], serviceItems: [], navItems: [], testimonials: [], images: [] };
      const lead = { businessName: 'Galeria Bemowo' };
      expect(bentoTemplateService.renderFromAudit(lead, { extractedContent: { ...site, language: 'en_GB' } })).toContain(
        '<html lang="en-GB">',
      );
      expect(
        bentoTemplateService.renderFromAudit(lead, { extractedContent: { ...site, language: 'pl"><script>' } }),
      ).toContain('<html lang="en">');
    });

    it('defaults to English when no language is given', () => {
      const html = bentoTemplateService.render(sampleTemplateData);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('Book now');
    });

    it('rejects a malformed language code', () => {
      expect(() => bentoTemplateService.render({ ...sampleTemplateData, language: '"><script>' })).toThrow();
    });

    it('passes the localised confirmation text to the client script safely', () => {
      const html = bentoTemplateService.render({ ...sampleTemplateData, language: 'ru' });
      expect(html).toContain('"successDetail":"Спасибо, {name}!');
      expect(html).not.toContain("'Thank you, ' + nameVal");
    });

    it('renders an MVP from an audit in the original site language', () => {
      const html = bentoTemplateService.renderFromAudit(
        { businessName: 'Galeria Bemowo', niche: 'other' },
        {
          extractedContent: {
            language: 'pl-PL',
            h1: 'Wyjątkowe miejsce na zakupy',
            headings: [],
            paragraphs: [],
            serviceItems: [{ title: 'Sklepy' }],
            navItems: [],
            testimonials: [{ text: 'Świetne miejsce na zakupy!' }],
            images: [],
          },
        },
      );
      expect(html).toContain('<html lang="pl-PL">');
      expect(html).toContain('Sklepy — Galeria Bemowo.');
      expect(html).toContain('>Klient</div>');
      expect(html).toContain('Strona');
    });
  });

  describe('renderFromAudit grounding (REV-23)', () => {
    const baseTokens = {
      primaryColor: '#9a7d42',
      secondaryColor: '#1e293b',
      accentColor: '#9a7d42',
      fontFamilies: ['Inter'],
    };

    const fullAudit: Partial<IAudit> = {
      extractedBrandTokens: { ...baseTokens, logoUrl: 'https://wdc.example/logo.png' },
      extractedContacts: {
        phone: '+48 22 542 18 04',
        email: 'kontakt@wdc.example',
        address: 'ulica Topiel 11, 00-342 Warszawa',
        workingHours: 'Pon - Pt 09:00 — 21:00',
        socialLinks: [
          { platform: 'instagram', url: 'https://www.instagram.com/wdc_pl/' },
          { platform: 'facebook', url: 'javascript:alert(1)' },
        ],
      },
      extractedContent: {
        h1: 'Best dental clinic in Warsaw',
        metaDescription: 'Modern dental center with a full range of services.',
        ogImage: 'https://wdc.example/og-logo.png',
        headings: [],
        paragraphs: ['We take care of your smile with modern equipment and experienced specialists.'],
        serviceItems: [{ title: 'Veneers', description: 'Thin ceramic shells.' }],
        navItems: [],
        testimonials: [{ text: 'Doctors and staff speak English fluently.', author: 'Abhijit C.' }],
        images: ['https://wdc.example/clinic.jpg', 'https://wdc.example/team.jpg', 'https://wdc.example/room.jpg'],
      },
      generatedContent: {
        hero: {
          badge: '★ 4.9 rating',
          headline: 'Best dental clinic in Warsaw',
          subheadline: 'Modern dental center with a full range of services.',
          primaryCtaText: 'Book an appointment',
          secondaryCtaText: 'Call us',
        },
        about: { heading: 'About Warsaw Dental Center', body: 'We take care of your smile.' },
        servicesHeading: 'What Warsaw Dental Center offers',
        services: [{ title: 'Veneers', description: 'Thin ceramic shells.', lucideIconName: 'sparkles' }],
        trustSignals: [],
        offerNotice: '',
      },
    };

    const lead: Partial<ILead> = {
      businessName: 'Warsaw Dental Center',
      niche: 'dental',
      contactEmail: 'owner@example.com',
      originalUrl: 'https://wdc.example',
    };

    it('should render the real contacts, hours, testimonials and images from the audit', () => {
      const html = bentoTemplateService.renderFromAudit(lead, fullAudit, fullAudit.generatedContent);

      expect(html).toContain('+48 22 542 18 04');
      expect(html).toContain('kontakt@wdc.example');
      expect(html).toContain('ulica Topiel 11, 00-342 Warszawa');
      expect(html).toContain('Pon - Pt 09:00 — 21:00');
      expect(html).toContain('Doctors and staff speak English fluently.');
      expect(html).toContain('Abhijit C.');
      expect(html).toContain('About Warsaw Dental Center');
      expect(html).toContain('What Warsaw Dental Center offers');
      expect(html).toContain('https://www.instagram.com/wdc_pl/');
      expect(html).not.toContain('javascript:alert');
      // og:image that is a logo is not used as the hero photo
      expect(html).toContain('class="hero-image" src="https://wdc.example/clinic.jpg"');
      expect(html).toContain('https://www.google.com/maps/search/');
    });

    it('should never render placeholder contacts, fake reviews or invented metrics', () => {
      const html = bentoTemplateService.renderFromAudit(
        { businessName: 'Bare Business', niche: 'auto' },
        { extractedBrandTokens: baseTokens },
      );

      expect(html).not.toMatch(/\+7 \(812\)|Saint Petersburg|Mon–Sun|Alex Mitchell|Kate Smith|Daniel Cooper|4\.9 ★|10\+ yrs|Official guarantee/);
      expect(html).not.toContain('href="tel:');
      expect(html).not.toContain('id="reviews"');
      expect(html).not.toContain('class="trust-signals-bar"');
      expect(html).not.toContain('Opening hours');
      expect(html).toContain('Send us a request');
    });

    it('should produce different pages for different businesses', () => {
      const dental = bentoTemplateService.renderFromAudit(lead, fullAudit, fullAudit.generatedContent);
      const mall = bentoTemplateService.renderFromAudit(
        { businessName: 'Galeria Bemowo', niche: 'other' },
        {
          extractedBrandTokens: { ...baseTokens, primaryColor: '#d0001c' },
          extractedContacts: { phone: '225697290', address: 'ul. Powstańców Śląskich 126', socialLinks: [] },
          extractedContent: {
            headings: [],
            paragraphs: [],
            serviceItems: [{ title: 'Sklepy' }, { title: 'Restauracje' }],
            navItems: [],
            testimonials: [],
            images: [],
          },
        },
      );

      expect(mall).not.toBe(dental);
      expect(mall).toContain('Sklepy');
      expect(mall).toContain('--brand-primary: #d0001c;');
      expect(mall).not.toContain('Topiel');
      expect(dental).not.toContain('Powstańców');
    });

    it('should treat null generated fields from Mongo as absent', () => {
      const html = bentoTemplateService.renderFromAudit(lead, fullAudit, {
        ...fullAudit.generatedContent!,
        about: null as unknown as undefined,
        servicesHeading: null as unknown as undefined,
      });

      expect(html).not.toContain('id="about"');
      expect(html).toContain('What Warsaw Dental Center offers');
    });
  });

  describe('telemetry tracker URLs (REV-52)', () => {
    it('loads the tracker from the absolute API URL and points data-api at the API origin', () => {
      const html = bentoTemplateService.render({
        ...sampleTemplateData,
        publicApiUrl: 'https://api.revamp.io/api/v1/',
        trackingToken: 'tok-123',
      });

      expect(html).toContain(
        '<script src="https://api.revamp.io/api/v1/track/revamp-tracker.js" data-api="https://api.revamp.io" data-token="tok-123" async></script>',
      );
      expect(html).toContain('navigator.sendBeacon("https://api.revamp.io/api/v1/track/mvp-event"');
      expect(html).not.toMatch(/src="\/api\/v1\/track\//);
      expect(html).not.toContain("'/api/v1/track/");
    });

    it('omits the tracker instead of using a relative path when no API URL is known', () => {
      const html = bentoTemplateService.render({
        ...sampleTemplateData,
        publicApiUrl: undefined,
        trackingToken: 'tok-123',
      });

      expect(html).not.toContain('revamp-tracker.js');
      expect(html).not.toContain('/track/mvp-event');
    });

    it('escapes the tracking token in the tracker tag and the booking beacon', () => {
      const html = bentoTemplateService.render({
        ...sampleTemplateData,
        publicApiUrl: 'http://localhost:4000/api/v1',
        trackingToken: `a"b'</script>`,
      });

      expect(html).toContain('data-token="a&quot;b&#039;&lt;/script&gt;"');
      expect(html).toContain('token: "a\\"b\'\\u003c/script>"');
    });

    it('rejects a non-http API URL', () => {
      expect(() =>
        bentoTemplateService.render({ ...sampleTemplateData, publicApiUrl: 'javascript:alert(1)' }),
      ).toThrow();
    });

    it('renders MVPs from an audit with the configured PUBLIC_API_URL', () => {
      const html = bentoTemplateService.renderFromAudit({ businessName: 'Listonosz Auto Service' });
      const apiBase = env.PUBLIC_API_URL.replace(/\/+$/, '');

      expect(html).toContain(`<script src="${apiBase}/track/revamp-tracker.js" data-api="${new URL(apiBase).origin}"`);
    });

    it('resolves tracker URLs and rejects unparseable API URLs', () => {
      expect(resolveTrackerUrls('http://localhost:4000/api/v1')).toEqual({
        scriptSrc: 'http://localhost:4000/api/v1/track/revamp-tracker.js',
        apiOrigin: 'http://localhost:4000',
        eventUrl: 'http://localhost:4000/api/v1/track/mvp-event',
      });
      expect(resolveTrackerUrls(undefined)).toBeNull();
      expect(resolveTrackerUrls('not a url')).toBeNull();
    });
  });

  it('should list all supported Lucide icon identifiers', () => {
    const icons = bentoTemplateService.getSupportedIcons();

    expect(Array.isArray(icons)).toBe(true);
    expect(icons).toContain('wrench');
    expect(icons).toContain('shield-check');
    expect(icons).toContain('sparkles');
    expect(icons).toContain('award');
    expect(icons).toContain('phone');
    expect(icons).toContain('calendar');
  });

  it('should reject invalid template data with Zod error', () => {
    expect(() =>
      bentoTemplateService.render({
        businessName: '',
        palette: { primary: 'invalid', secondary: '#fff', accent: '#000' },
        contacts: {},
        hero: { headline: '', subheadline: '' },
        services: [],
      } as unknown as IBentoTemplateData),
    ).toThrow();
  });
});

describe('MVP layout variants (REV-54)', () => {
  const data: IBentoTemplateData = {
    businessName: 'Warsaw Dental Center',
    palette: { primary: '#9a7d42', secondary: '#1e293b', accent: '#9a7d42' },
    contacts: {
      phone: '+48 22 542 18 04',
      email: 'kontakt@wdc.example',
      address: 'ulica Topiel 11, 00-342 Warszawa',
      workingHours: 'Pon - Pt 09:00 — 21:00',
    },
    hero: {
      badge: '★ 4.9 rating',
      headline: 'Best dental clinic in Warsaw',
      subheadline: 'Modern dental center with a full range of services.',
    },
    about: { heading: 'About us', body: 'We take care of your smile.' },
    services: [
      { title: 'Veneers', description: 'Thin ceramic shells.', lucideIconName: 'sparkles' },
      { title: 'Implants <b>', description: 'Titanium & ceramic.', lucideIconName: 'shield-check' },
    ],
    trustSignals: [{ metric: '14 yrs', label: 'In Warsaw' }],
    reviews: [{ author: 'Abhijit C.', comment: 'Doctors speak English fluently.', source: 'Website' }],
    heroImageUrl: 'https://wdc.example/hero.jpg',
    gallery: ['https://wdc.example/1.jpg', 'https://wdc.example/2.jpg', 'https://wdc.example/3.jpg'],
  };
  const render = (layout?: IBentoTemplateData['layout']) => bentoTemplateService.render({ ...data, layout });
  const indexOf = (html: string, marker: string) => {
    const index = html.indexOf(marker);
    expect(index, marker).toBeGreaterThan(-1);
    return index;
  };

  it('renders the original Bento layout when no layout is given', () => {
    const html = render();
    expect(html).toContain('<body class="layout-bento">');
    expect(html).toContain('class="bento-grid"');
    expect(html).toContain('bento-card bento-card-large');
    expect(html).not.toContain('LAYOUT:');
    expect(render('bento')).toBe(html);
  });

  it.each([
    ['split', 'hero-split', 'class="service-tiles"'],
    ['editorial', 'hero-editorial', 'class="numbered-services"'],
    ['compact', 'hero-compact', 'class="service-tiles service-tiles-compact"'],
  ] as const)('renders the %s layout with its own hero, services markup and styles', (layout, heroClass, servicesMarker) => {
    const html = render(layout);
    expect(html).toContain(`<body class="layout-${layout}">`);
    expect(html).toContain(`hero-section ${heroClass}`);
    expect(html).toContain(servicesMarker);
    expect(html).not.toContain('class="bento-grid"');
    expect(html).toContain(`LAYOUT: ${layout.toUpperCase()}`);
    // Only the active layout's CSS is inlined
    for (const other of ['SPLIT', 'EDITORIAL', 'COMPACT'].filter((name) => name !== layout.toUpperCase())) {
      expect(html).not.toContain(`LAYOUT: ${other}`);
    }
  });

  it.each(['bento', 'split', 'editorial', 'compact'] as const)(
    'keeps the same grounded content in the %s layout',
    (layout) => {
      const html = render(layout);
      expect(html).toContain('Best dental clinic in Warsaw');
      expect(html).toMatch(/<h3 class="[^"]+">Veneers<\/h3>/);
      expect(html).toContain('Implants &lt;b&gt;');
      expect(html).not.toContain('Implants <b>');
      expect(html).toContain('href="tel:+48225421804"');
      expect(html).toContain('href="mailto:kontakt@wdc.example"');
      expect(html).toContain('https://www.google.com/maps/search/');
      expect(html).toContain('src="https://wdc.example/hero.jpg"');
      expect(html).toContain('src="https://wdc.example/3.jpg"');
      expect(html).toContain('Doctors speak English fluently.');
      expect(html).toContain('id="lead-booking-form"');
      expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(BentoTemplateService.MAX_BUNDLE_SIZE_BYTES);
    },
  );

  it('orders the sections per layout', () => {
    const bento = render('bento');
    expect(indexOf(bento, 'id="about"')).toBeLessThan(indexOf(bento, 'id="services"'));
    expect(indexOf(bento, 'id="services"')).toBeLessThan(indexOf(bento, 'id="gallery"'));

    // Image-led: the gallery comes straight after the hero
    const split = render('split');
    expect(indexOf(split, 'id="gallery"')).toBeLessThan(indexOf(split, 'id="services"'));
    expect(indexOf(split, 'id="services"')).toBeLessThan(indexOf(split, 'id="about"'));

    // Text-led: About first, the gallery last
    const editorial = render('editorial');
    expect(indexOf(editorial, 'id="about"')).toBeLessThan(indexOf(editorial, 'id="services"'));
    expect(indexOf(editorial, 'id="reviews"')).toBeLessThan(indexOf(editorial, 'id="gallery"'));

    // Brochure: services straight after the contacts hero
    const compact = render('compact');
    expect(indexOf(compact, 'id="services"')).toBeLessThan(indexOf(compact, 'id="about"'));

    for (const html of [bento, split, editorial, compact]) {
      expect(indexOf(html, 'id="booking"')).toBeGreaterThan(indexOf(html, 'id="services"'));
    }
  });

  it('numbers the services in the editorial layout', () => {
    const html = render('editorial');
    expect(html).toContain('<span class="numbered-service-index">01</span>');
    expect(html).toContain('<span class="numbered-service-index">02</span>');
  });

  it('puts only the verified contacts in the compact hero', () => {
    const html = render('compact');
    const hero = html.slice(indexOf(html, 'hero-compact"'), indexOf(html, '<!-- MODULE 3'));
    expect(hero).toContain('<ul class="quick-facts">');
    expect(hero).toContain('href="tel:+48225421804"');
    expect(hero).toContain('Pon - Pt 09:00 — 21:00');

    const phoneOnly = bentoTemplateService.render({ ...data, layout: 'compact', contacts: { phone: '+48 22 542 18 04' } });
    const phoneOnlyHero = phoneOnly.slice(indexOf(phoneOnly, 'hero-compact"'), indexOf(phoneOnly, '<!-- MODULE 3'));
    expect(phoneOnlyHero).toContain('href="tel:+48225421804"');
    expect(phoneOnlyHero).not.toContain('mailto:');
    expect(phoneOnlyHero).not.toContain('google.com/maps');

    const noContacts = bentoTemplateService.render({ ...data, layout: 'compact', contacts: {} });
    expect(noContacts).not.toContain('<ul class="quick-facts">');
  });

  it('falls back to a single column split hero when there is no photo', () => {
    const html = bentoTemplateService.render({ ...data, layout: 'split', heroImageUrl: undefined });
    expect(html).toContain('hero-split hero-split-no-image');
    expect(html).not.toContain('class="hero-split-image"');
  });

  describe('split gallery fill (REV-58)', () => {
    const images = (count: number) => Array.from({ length: count }, (_, i) => `https://wdc.example/g${i + 1}.jpg`);
    const galleryGrid = (html: string) => html.match(/<div class="(gallery-grid[^"]*)">/)?.[1];

    it.each([2, 3, 4, 5, 6])('tags the split gallery grid with its image count (%i images)', (count) => {
      const html = bentoTemplateService.render({ ...data, layout: 'split', about: undefined, gallery: images(count) });
      expect(galleryGrid(html)).toBe(`gallery-grid gallery-count-${count}`);
      expect(html.match(/class="gallery-image"/g)).toHaveLength(count);
    });

    it('counts only the gallery images left after the About block takes the first one', () => {
      const html = bentoTemplateService.render({ ...data, layout: 'split', gallery: images(5) });
      expect(galleryGrid(html)).toBe('gallery-grid gallery-count-4');
    });

    it('ships a span rule for every count that would leave a gap', () => {
      const html = render('split');
      expect(html).toContain('.layout-split .gallery-count-2 .gallery-image:last-child { grid-column: span 2; grid-row: span 2; }');
      expect(html).toContain('.layout-split .gallery-count-3 .gallery-image:not(:first-child) { grid-column: span 2; }');
      expect(html).toContain('.layout-split .gallery-count-4 .gallery-image:last-child { grid-column: span 2; }');
      expect(html).toContain('.layout-split .gallery-count-6 .gallery-image:nth-child(n+4) { grid-column: span 2; }');
      expect(html).toContain('.layout-split .gallery-count-5 .gallery-image:first-child { grid-column: span 2; }');
    });

    it.each(['bento', 'editorial', 'compact'] as const)('leaves the %s gallery markup unchanged', (layout) => {
      const html = bentoTemplateService.render({ ...data, layout, about: undefined, gallery: images(4) });
      expect(galleryGrid(html)).toBe('gallery-grid');
      expect(html).not.toContain('gallery-count-');
    });
  });

  it('rejects an unknown layout', () => {
    expect(() => bentoTemplateService.render({ ...data, layout: 'grid' as never })).toThrow();
  });

  it('renders the layout chosen for a lead from its audit', () => {
    const lead: Partial<ILead> = { businessName: 'Warsaw Dental Center', niche: 'dental' };
    const audit: Partial<IAudit> = {
      extractedContent: {
        headings: [],
        paragraphs: ['We take care of your smile.'],
        serviceItems: [{ title: 'Veneers', description: 'Thin ceramic shells.' }],
        navItems: [],
        testimonials: [],
        images: [],
      },
    };
    expect(bentoTemplateService.renderFromAudit(lead, audit, undefined, 'editorial')).toContain(
      '<body class="layout-editorial">',
    );
    expect(bentoTemplateService.renderFromAudit(lead, audit)).toContain('<body class="layout-bento">');
  });
});
