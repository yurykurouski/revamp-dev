import { describe, it, expect } from 'vitest';
import {
  CreateLeadSchema,
  TriggerAuditSchema,
  GenerateMvpSchema,
  UpdateMvpTokensSchema,
  ApproveOutreachSchema,
  RejectOutreachSchema,
  TestEmailOutreachSchema,
  DesignCritiqueOutputSchema,
  MvpContentOutputSchema,
  EmailDraftOutputSchema,
  BentoTemplateDataSchema,
  MvpTrackEventSchema,
  StartDiscoverySchema,
  DiscoveredBusinessSchema,
  ReverseGeocodeQuerySchema,
  ImportDiscoverySchema,
  mvpGenerationMode,
  MVP_REGENERATABLE_STATUSES,
} from '../src/index.js';

describe('Validation Schemas (@revamp/validation)', () => {
  describe('CreateLeadSchema', () => {
    it('should validate a complete valid lead payload', () => {
      const input = {
        businessName: 'Apex Dental Care',
        originalUrl: 'https://apexdental.com',
        contactEmail: 'contact@apexdental.com',
        niche: 'dental',
        city: 'Chicago',
        contactPhone: '+1 312 555 0199',
        ownerName: 'Dr. John Doe',
      };

      const parsed = CreateLeadSchema.parse(input);
      expect(parsed.businessName).toBe('Apex Dental Care');
      expect(parsed.originalUrl).toBe('https://apexdental.com');
      expect(parsed.niche).toBe('dental');
    });

    it('should apply default niche "other" and normalize URL without protocol', () => {
      const input = {
        businessName: 'Apex Auto Repair',
        originalUrl: 'apexautorepair.com',
        contactEmail: 'info@apexautorepair.com',
      };

      const parsed = CreateLeadSchema.parse(input);
      expect(parsed.niche).toBe('other');
      expect(parsed.originalUrl).toBe('https://apexautorepair.com');
    });

    it('should reject invalid URL format', () => {
      const input = {
        businessName: 'Bad URL Clinic',
        originalUrl: 'http://',
        contactEmail: 'info@badurl.com',
      };

      expect(() => CreateLeadSchema.parse(input)).toThrow();
    });

    it('should reject invalid email format', () => {
      const input = {
        businessName: 'Bad Email Clinic',
        originalUrl: 'https://valid-url.com',
        contactEmail: 'not-an-email',
      };

      expect(() => CreateLeadSchema.parse(input)).toThrow();
    });

    it('should reject business name that is too short', () => {
      const input = {
        businessName: 'A',
        originalUrl: 'https://valid-url.com',
        contactEmail: 'info@valid.com',
      };

      expect(() => CreateLeadSchema.parse(input)).toThrow();
    });

    it('should reject unknown niche', () => {
      const input = {
        businessName: 'Valid Clinic',
        originalUrl: 'https://valid-url.com',
        contactEmail: 'info@valid.com',
        niche: 'space_exploration',
      };

      expect(() => CreateLeadSchema.parse(input)).toThrow();
    });
  });

  describe('TriggerAuditSchema', () => {
    it('should parse valid trigger audit input with defaults', () => {
      const parsed = TriggerAuditSchema.parse({ leadId: 'lead-123' });
      expect(parsed.leadId).toBe('lead-123');
      expect(parsed.force).toBe(false);
    });

    it('should allow force flag to be true', () => {
      const parsed = TriggerAuditSchema.parse({ leadId: 'lead-123', force: true });
      expect(parsed.force).toBe(true);
    });

    it('should reject empty leadId', () => {
      expect(() => TriggerAuditSchema.parse({ leadId: '' })).toThrow();
    });
  });

  describe('GenerateMvpSchema', () => {
    it('should parse valid generate MVP payload with default forceRegenerate', () => {
      const parsed = GenerateMvpSchema.parse({ auditId: 'audit-456' });
      expect(parsed.auditId).toBe('audit-456');
      expect(parsed.forceRegenerate).toBe(false);
    });

    it('should reject empty auditId', () => {
      expect(() => GenerateMvpSchema.parse({ auditId: '' })).toThrow();
    });

    it('should accept forceRegenerate and reject non-boolean values (REV-31)', () => {
      expect(GenerateMvpSchema.parse({ auditId: 'a', forceRegenerate: true }).forceRegenerate).toBe(true);
      expect(() => GenerateMvpSchema.parse({ auditId: 'a', forceRegenerate: 'true' })).toThrow();
    });
  });

  describe('mvpGenerationMode (REV-31)', () => {
    it('allows a first generation only from AUDITED', () => {
      expect(mvpGenerationMode('AUDITED')).toBe('first');
    });

    it.each(['MVP_READY', 'NEEDS_APPROVAL', 'AWAITING_APPROVAL', 'APPROVED'])('allows regenerating a %s lead', (status) => {
      expect(mvpGenerationMode(status)).toBe('regenerate');
      expect(MVP_REGENERATABLE_STATUSES).toContain(status);
    });

    it.each([
      'QUEUED', 'PENDING', 'AUDITING', 'GENERATING', 'SCHEDULED', 'SENT', 'DISPATCHED',
      'OPENED', 'CLICKED', 'ENGAGED', 'REPLIED', 'REJECTED', 'UNSUBSCRIBED', '', undefined, null,
    ])('blocks generation for %s', (status) => {
      expect(mvpGenerationMode(status)).toBe('blocked');
    });
  });

  describe('UpdateMvpTokensSchema', () => {
    it('should validate hex colors', () => {
      const valid = {
        primaryColor: '#0070f3',
        secondaryColor: '#fff',
        accentColor: '#123456',
        headline: 'Modern Dentistry',
      };
      const parsed = UpdateMvpTokensSchema.parse(valid);
      expect(parsed.primaryColor).toBe('#0070f3');
      expect(parsed.secondaryColor).toBe('#fff');
    });

    it('should reject invalid hex color', () => {
      expect(() => UpdateMvpTokensSchema.parse({ primaryColor: 'blue' })).toThrow();
      expect(() => UpdateMvpTokensSchema.parse({ primaryColor: '#12345' })).toThrow();
    });
  });

  describe('ApproveOutreachSchema & RejectOutreachSchema', () => {
    it('should parse approve outreach with default operator', () => {
      const parsed = ApproveOutreachSchema.parse({});
      expect(parsed.approvedBy).toBe('operator');
    });

    it('should parse valid ISO schedule datetime', () => {
      const now = new Date().toISOString();
      const parsed = ApproveOutreachSchema.parse({ scheduleTime: now, approvedBy: 'admin' });
      expect(parsed.scheduleTime).toBe(now);
      expect(parsed.approvedBy).toBe('admin');
    });

    it('should reject invalid ISO datetime in approve schema', () => {
      expect(() => ApproveOutreachSchema.parse({ scheduleTime: 'tomorrow' })).toThrow();
    });

    it('should parse valid reject reason and reject too short reason', () => {
      const parsed = RejectOutreachSchema.parse({ reason: 'Website already renovated' });
      expect(parsed.reason).toBe('Website already renovated');

      expect(() => RejectOutreachSchema.parse({ reason: 'no' })).toThrow();
    });
  });

  describe('TestEmailOutreachSchema', () => {
    it('should validate test email address', () => {
      const parsed = TestEmailOutreachSchema.parse({ testEmail: 'dev@revamp.io' });
      expect(parsed.testEmail).toBe('dev@revamp.io');
    });

    it('should reject invalid test email', () => {
      expect(() => TestEmailOutreachSchema.parse({ testEmail: 'not-an-email' })).toThrow();
    });
  });

  describe('Autonomous Agent Schemas (DesignCritique, MvpContent, EmailDraft)', () => {
    it('should validate DesignCritiqueOutputSchema', () => {
      const validCritique = {
        visualHierarchyRating: 75,
        mobileFriendlinessRating: 40,
        primaryCtaFound: true,
        datedDesignFactors: ['Table-based layout', 'Cluttered sidebar'],
        criticalFlaws: [
          { title: 'No mobile CTA', impact: 'High bounce rate', recommendation: 'Add sticky button' },
          { title: 'Low contrast', impact: 'Unreadable text', recommendation: 'Use darker font' },
          { title: 'Slow LCP', impact: 'Slow initial view', recommendation: 'Compress hero image' },
        ],
        quickWins: ['Add booking CTA', 'Fix header contrast', 'Enable mobile viewport'],
      };

      const parsed = DesignCritiqueOutputSchema.parse(validCritique);
      expect(parsed.visualHierarchyRating).toBe(75);
      expect(parsed.criticalFlaws).toHaveLength(3);
      expect(parsed.quickWins).toHaveLength(3);
    });

    it('should reject DesignCritiqueOutputSchema if criticalFlaws count is not 3', () => {
      const invalidCritique = {
        visualHierarchyRating: 80,
        mobileFriendlinessRating: 80,
        primaryCtaFound: true,
        datedDesignFactors: [],
        criticalFlaws: [
          { title: 'Single flaw', impact: 'Moderate', recommendation: 'Fix it' },
        ],
        quickWins: ['Win 1', 'Win 2', 'Win 3'],
      };

      expect(() => DesignCritiqueOutputSchema.parse(invalidCritique)).toThrow();
    });

    it('should validate MvpContentOutputSchema', () => {
      const validContent = {
        hero: {
          badge: 'Top Rated in Chicago',
          headline: 'Pain-Free Dental Care When You Need It Most',
          subheadline: 'Advanced technology and gentle care for the entire family.',
          primaryCtaText: 'Book Appointment',
          secondaryCtaText: 'View Prices',
        },
        services: [
          { title: 'Implants', description: 'Lifetime warranty implants', lucideIconName: 'shield' },
          { title: 'Whitening', description: 'Laser teeth whitening', lucideIconName: 'sparkles' },
          { title: 'Orthodontics', description: 'Invisible aligners', lucideIconName: 'smile' },
        ],
        trustSignals: [
          { metric: '15+ Years', label: 'Serving Chicago' },
          { metric: '4.9 ★', label: 'Google Rating' },
          { metric: '5,000+', label: 'Happy Patients' },
        ],
        offerNotice: 'First checkup is free for new patients',
      };

      const parsed = MvpContentOutputSchema.parse(validContent);
      expect(parsed.hero.headline).toBe('Pain-Free Dental Care When You Need It Most');
      expect(parsed.services).toHaveLength(3);
      expect(parsed.trustSignals).toHaveLength(3);
    });

    it('should accept grounded MVP content with no trust signals, an about block and a single service (REV-23)', () => {
      const parsed = MvpContentOutputSchema.parse({
        hero: { badge: '📍 Warsaw', headline: 'H', subheadline: 'S', primaryCtaText: 'Book', secondaryCtaText: 'Call' },
        about: { heading: 'About us', body: 'Real story from the site.' },
        servicesHeading: 'What we offer',
        services: [{ title: 'Implants', description: 'Titanium implants', lucideIconName: 'shield-check' }],
        trustSignals: [],
        offerNotice: '',
      });

      expect(parsed.trustSignals).toEqual([]);
      expect(parsed.about?.heading).toBe('About us');
    });

    it('should reject MVP content with more than 3 trust signals or no services', () => {
      const base = {
        hero: { badge: 'b', headline: 'h', subheadline: 's', primaryCtaText: 'p', secondaryCtaText: 'c' },
        offerNotice: '',
      };
      const signal = { metric: '1', label: 'x' };

      expect(() =>
        MvpContentOutputSchema.parse({
          ...base,
          services: [{ title: 't', description: 'd', lucideIconName: 'i' }],
          trustSignals: [signal, signal, signal, signal],
        }),
      ).toThrow();
      expect(() => MvpContentOutputSchema.parse({ ...base, services: [], trustSignals: [] })).toThrow();
    });

    it('should validate EmailDraftOutputSchema', () => {
      const validDraft = {
        subject: 'Quick question regarding Dr. Smile Dental website',
        previewText: 'We noticed a few mobile experience flaws and created a prototype.',
        bodyHtml: '<p>Hello Dr. Smith,</p>',
        bodyPlainText: 'Hello Dr. Smith,',
      };

      const parsed = EmailDraftOutputSchema.parse(validDraft);
      expect(parsed.subject).toContain('Dr. Smile Dental');
    });

    it('should reject EmailDraftOutputSchema if subject exceeds 80 characters', () => {
      const longSubject = 'A'.repeat(85);
      const invalidDraft = {
        subject: longSubject,
        previewText: 'Preview',
        bodyHtml: '<p>Text</p>',
        bodyPlainText: 'Text',
      };

      expect(() => EmailDraftOutputSchema.parse(invalidDraft)).toThrow();
    });
  });

  describe('BentoTemplateDataSchema (REV-11)', () => {
    it('should validate a complete BentoTemplateData payload', () => {
      const data = {
        businessName: 'Smile Dental',
        niche: 'dental',
        palette: {
          primary: '#5c5bed',
          secondary: '#b8c4fe',
          accent: '#5c5bed',
        },
        contacts: {
          phone: '+7 (812) 123-45-67',
          email: 'info@smiledental.ru',
          address: '100 Nevsky Avenue',
          city: 'Saint Petersburg',
        },
        hero: {
          badge: '✨ Deal of the month',
          headline: 'A perfect smile without pain or overpaying',
          subheadline: 'Modern technology and pain-free treatment with a 5-year guarantee.',
          primaryCtaText: 'Book online',
          secondaryCtaText: 'Call us',
        },
        services: [
          {
            title: 'Dental implants',
            description: 'Swiss implants with a lifetime guarantee from leading surgeons.',
            lucideIconName: 'shield-check',
            badge: 'Top pick',
            highlight: true,
          },
          {
            title: 'Zoom 4 whitening',
            description: 'Whitens enamel up to 8 shades in a single visit.',
            lucideIconName: 'sparkles',
          },
        ],
        trustSignals: [
          { metric: '4.9 ★', label: 'Rating on Google Maps' },
          { metric: '15 yrs', label: 'Of flawless reputation' },
        ],
        reviews: [
          {
            author: 'Maria P.',
            rating: 5,
            comment: 'Great clinic, friendly doctors!',
            source: 'Google Maps',
          },
        ],
      };

      const parsed = BentoTemplateDataSchema.parse(data);
      expect(parsed.businessName).toBe('Smile Dental');
      expect(parsed.palette.primary).toBe('#5c5bed');
      expect(parsed.services).toHaveLength(2);
      expect(parsed.reviews).toHaveLength(1);
    });

    it('should validate grounded site sections and reject non-URL images or socials (REV-23)', () => {
      const base = {
        businessName: 'Warsaw Dental Center',
        palette: { primary: '#9a7d42', secondary: '#1e293b', accent: '#9a7d42' },
        contacts: {},
        hero: { headline: 'Best clinic', subheadline: 'Modern dental center' },
        services: [{ title: 'Veneers', description: 'Thin ceramic shells' }],
      };

      const parsed = BentoTemplateDataSchema.parse({
        ...base,
        about: { heading: 'About us', body: 'Our story.' },
        gallery: ['https://wdc.example/a.jpg'],
        heroImageUrl: 'https://wdc.example/hero.jpg',
        socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/wdc' }],
        reviews: [{ author: 'Anna', comment: 'Great experience overall', source: 'Website' }],
      });
      expect(parsed.reviews?.[0]?.rating).toBeUndefined();

      expect(() => BentoTemplateDataSchema.parse({ ...base, gallery: ['not-a-url'] })).toThrow();
      expect(() =>
        BentoTemplateDataSchema.parse({ ...base, socialLinks: [{ platform: 'x', url: 'javascript:alert(1)' }] }),
      ).toThrow();
    });

    it('should accept BCP 47 site language tags and reject malformed ones (REV-25)', () => {
      const base = {
        businessName: 'Galeria Bemowo',
        palette: { primary: '#9a7d42', secondary: '#1e293b', accent: '#9a7d42' },
        contacts: {},
        hero: { headline: 'Zakupy', subheadline: 'Galeria handlowa' },
        services: [{ title: 'Sklepy', description: 'Sklepy i usługi' }],
      };

      for (const language of ['pl', 'pl-PL', 'sr-Latn-RS', 'fil']) {
        expect(BentoTemplateDataSchema.parse({ ...base, language }).language).toBe(language);
      }
      expect(BentoTemplateDataSchema.parse(base).language).toBeUndefined();
      for (const language of ['', 'p', 'pl_PL', 'pl-', 'polish', 'pl"><script>']) {
        expect(() => BentoTemplateDataSchema.parse({ ...base, language })).toThrow();
      }
    });

    it('should reject invalid hex color in palette', () => {
      const invalid = {
        businessName: 'Auto Fix',
        palette: {
          primary: 'invalid-hex',
          secondary: '#b8c4fe',
          accent: '#5c5bed',
        },
        contacts: {},
        hero: {
          headline: 'Headline',
          subheadline: 'Subheadline',
        },
        services: [{ title: 'Service', description: 'Description' }],
      };

      expect(() => BentoTemplateDataSchema.parse(invalid)).toThrow();
    });

    it('should reject empty services list', () => {
      const emptyServices = {
        businessName: 'Auto Fix',
        palette: {
          primary: '#5c5bed',
          secondary: '#b8c4fe',
          accent: '#5c5bed',
        },
        contacts: {},
        hero: {
          headline: 'Headline',
          subheadline: 'Subheadline',
        },
        services: [],
      };

      expect(() => BentoTemplateDataSchema.parse(emptyServices)).toThrow();
    });
  });

  describe('MvpTrackEventSchema (REV-18 Telemetry)', () => {
    it('should validate valid telemetry dwell_time event with token', () => {
      const valid = {
        token: 'tok-123456',
        eventType: 'dwell_time',
        dwellTimeSeconds: 32,
        scrollDepthPercent: 75,
        metadata: { referrer: 'https://mail.google.com' },
      };

      const parsed = MvpTrackEventSchema.parse(valid);
      expect(parsed.token).toBe('tok-123456');
      expect(parsed.eventType).toBe('dwell_time');
      expect(parsed.dwellTimeSeconds).toBe(32);
      expect(parsed.scrollDepthPercent).toBe(75);
    });

    it('should validate valid CTA click event with mvpProjectId', () => {
      const valid = {
        mvpProjectId: 'mvp-789',
        eventType: 'cta_click',
        metadata: { buttonId: 'book-now-btn' },
      };

      const parsed = MvpTrackEventSchema.parse(valid);
      expect(parsed.mvpProjectId).toBe('mvp-789');
      expect(parsed.eventType).toBe('cta_click');
    });

    it('should reject if none of token, trackingToken, mvpProjectId, or leadId are provided', () => {
      const invalid = {
        eventType: 'pageview',
        dwellTimeSeconds: 10,
      };

      expect(() => MvpTrackEventSchema.parse(invalid)).toThrow(
        /One of token, trackingToken, mvpProjectId, or leadId must be provided/,
      );
    });

    it('should reject negative dwellTimeSeconds', () => {
      const invalid = {
        token: 'tok-abc',
        eventType: 'dwell_time',
        dwellTimeSeconds: -5,
      };

      expect(() => MvpTrackEventSchema.parse(invalid)).toThrow();
    });

    it('should reject scrollDepthPercent greater than 100', () => {
      const invalid = {
        token: 'tok-abc',
        eventType: 'scroll_depth',
        scrollDepthPercent: 120,
      };

      expect(() => MvpTrackEventSchema.parse(invalid)).toThrow();
    });

    it('should validate valid token_usage event for AI budget tracking', () => {
      const valid = {
        leadId: 'lead-12345',
        eventType: 'token_usage',
        metadata: {
          agent: 'DesignCritiqueAgent',
          model: 'claude-3-5-sonnet',
          promptTokens: 1200,
          completionTokens: 350,
          totalTokens: 1550,
        },
      };

      const parsed = MvpTrackEventSchema.parse(valid);
      expect(parsed.leadId).toBe('lead-12345');
      expect(parsed.eventType).toBe('token_usage');
      expect(parsed.metadata?.['totalTokens']).toBe(1550);
    });

    it('should reject invalid eventType', () => {
      const invalid = {
        token: 'tok-abc',
        eventType: 'unknown_event_type',
      };

      expect(() => MvpTrackEventSchema.parse(invalid)).toThrow();
    });
  });

  describe('StartDiscoverySchema', () => {
    it('should apply defaults for provider and limit', () => {
      const result = StartDiscoverySchema.safeParse({ niche: 'dental', location: 'Vilnius' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe('osm');
        expect(result.data.limit).toBe(20);
      }
    });

    it('should coerce a numeric string limit and trim location', () => {
      const result = StartDiscoverySchema.parse({
        provider: 'google',
        niche: 'auto',
        location: '  Warsaw  ',
        limit: '50',
      });
      expect(result.limit).toBe(50);
      expect(result.location).toBe('Warsaw');
    });

    it('should enforce limit boundaries 1..100', () => {
      expect(StartDiscoverySchema.safeParse({ niche: 'dental', location: 'Riga', limit: 1 }).success).toBe(true);
      expect(StartDiscoverySchema.safeParse({ niche: 'dental', location: 'Riga', limit: 100 }).success).toBe(true);
      expect(StartDiscoverySchema.safeParse({ niche: 'dental', location: 'Riga', limit: 0 }).success).toBe(false);
      expect(StartDiscoverySchema.safeParse({ niche: 'dental', location: 'Riga', limit: 101 }).success).toBe(false);
      expect(StartDiscoverySchema.safeParse({ niche: 'dental', location: 'Riga', limit: 2.5 }).success).toBe(false);
    });

    it('should reject unknown providers and too-short locations', () => {
      expect(StartDiscoverySchema.safeParse({ provider: 'bing', niche: 'dental', location: 'Riga' }).success).toBe(false);
      expect(StartDiscoverySchema.safeParse({ niche: 'dental', location: 'R' }).success).toBe(false);
      expect(StartDiscoverySchema.safeParse({ niche: 'dental' }).success).toBe(false);
    });

    it('should require a keyword when niche is other', () => {
      const missing = StartDiscoverySchema.safeParse({ niche: 'other', location: 'Minsk' });
      expect(missing.success).toBe(false);
      if (!missing.success) {
        expect(missing.error.issues[0]?.path).toEqual(['keyword']);
      }
      expect(StartDiscoverySchema.safeParse({ location: 'Minsk', keyword: 'bakery' }).success).toBe(true);
    });
  });

  describe('DiscoveredBusinessSchema', () => {
    const base = { provider: 'osm', externalId: 'node/1', name: 'Smile Dental' };

    it('should accept a minimal and a full listing', () => {
      expect(DiscoveredBusinessSchema.safeParse(base).success).toBe(true);
      expect(
        DiscoveredBusinessSchema.safeParse({
          ...base,
          website: 'https://smile.lt/',
          phone: '+370 600 00000',
          email: 'hello@smile.lt',
          address: 'Gedimino pr. 1, Vilnius',
          city: 'Vilnius',
          lat: 54.68,
          lng: 25.28,
        }).success,
      ).toBe(true);
    });

    it('should reject non-http websites, bad emails, long phones, and out-of-range coordinates', () => {
      expect(DiscoveredBusinessSchema.safeParse({ ...base, website: 'javascript:alert(1)' }).success).toBe(false);
      expect(DiscoveredBusinessSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
      expect(DiscoveredBusinessSchema.safeParse({ ...base, phone: '1'.repeat(31) }).success).toBe(false);
      expect(DiscoveredBusinessSchema.safeParse({ ...base, lat: 91 }).success).toBe(false);
      expect(DiscoveredBusinessSchema.safeParse({ ...base, name: 'A' }).success).toBe(false);
    });
  });

  describe('ReverseGeocodeQuerySchema', () => {
    it('should coerce query-string coordinates and accept a language tag', () => {
      expect(ReverseGeocodeQuerySchema.parse({ lat: '54.6872', lng: '25.2797', lang: 'be' })).toEqual({
        lat: 54.6872,
        lng: 25.2797,
        lang: 'be',
      });
      expect(ReverseGeocodeQuerySchema.parse({ lat: '-90', lng: '180' })).toEqual({ lat: -90, lng: 180 });
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: 1, lng: 2, lang: 'pt-BR' }).success).toBe(true);
    });

    it('should reject out-of-range, missing, empty, and non-numeric coordinates', () => {
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: '90.1', lng: '0' }).success).toBe(false);
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: '0', lng: '-180.5' }).success).toBe(false);
      expect(ReverseGeocodeQuerySchema.safeParse({ lng: '10' }).success).toBe(false);
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: '', lng: '10' }).success).toBe(false);
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: 'north', lng: '10' }).success).toBe(false);
    });

    it('should reject malformed language tags', () => {
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: 1, lng: 2, lang: 'english!' }).success).toBe(false);
      expect(ReverseGeocodeQuerySchema.safeParse({ lat: 1, lng: 2, lang: 'e' }).success).toBe(false);
    });
  });

  describe('ImportDiscoverySchema', () => {
    it('should accept 1 to 100 unique ids', () => {
      expect(ImportDiscoverySchema.safeParse({ externalIds: ['node/1'] }).success).toBe(true);
      expect(
        ImportDiscoverySchema.safeParse({ externalIds: Array.from({ length: 100 }, (_, i) => `node/${i}`) }).success,
      ).toBe(true);
    });

    it('should reject empty, oversized, duplicate, and blank-id selections', () => {
      expect(ImportDiscoverySchema.safeParse({ externalIds: [] }).success).toBe(false);
      expect(
        ImportDiscoverySchema.safeParse({ externalIds: Array.from({ length: 101 }, (_, i) => `node/${i}`) }).success,
      ).toBe(false);
      expect(ImportDiscoverySchema.safeParse({ externalIds: ['node/1', 'node/1'] }).success).toBe(false);
      expect(ImportDiscoverySchema.safeParse({ externalIds: [''] }).success).toBe(false);
      expect(ImportDiscoverySchema.safeParse({}).success).toBe(false);
    });
  });
});
