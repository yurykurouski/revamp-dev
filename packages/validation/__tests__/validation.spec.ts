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
});
