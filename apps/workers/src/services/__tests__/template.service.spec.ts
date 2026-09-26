import { describe, it, expect } from 'vitest';
import { BentoTemplateService, bentoTemplateService } from '../template.service.js';
import { IBentoTemplateData, ILead, IAudit } from '@revamp/shared-types';

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
