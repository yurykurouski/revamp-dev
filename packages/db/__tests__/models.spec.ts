import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { Lead } from '../src/models/Lead.model.js';
import { Audit } from '../src/models/Audit.model.js';
import { EmailCampaign } from '../src/models/EmailCampaign.model.js';
import { AnalyticsEvent } from '../src/models/AnalyticsEvent.model.js';
import { MvpProject } from '../src/models/MvpProject.model.js';

describe('Mongoose Models (Lead, Audit, EmailCampaign & AnalyticsEvent)', () => {

  describe('Lead Model', () => {
    it('should create valid lead document instance with defaults', () => {
      const lead = new Lead({
        businessName: 'Dr. Smile Dental',
        originalUrl: 'https://drsmile.example.com',
        domain: 'drsmile.example.com',
        contactEmail: 'contact@drsmile.example.com',
      });

      const err = lead.validateSync();
      expect(err).toBeUndefined();
      expect(lead.status).toBe('QUEUED');
      expect(lead.niche).toBe('other');
      expect(lead.tags).toEqual([]);
    });

    it('should accept the real_estate niche and reject unknown niches (REV-106)', () => {
      const base = { businessName: 'Home Realty', originalUrl: 'https://home.example.com', domain: 'home.example.com' };
      expect(new Lead({ ...base, niche: 'real_estate' }).validateSync()).toBeUndefined();
      expect(new Lead({ ...base, niche: 'space_exploration' }).validateSync()?.errors['niche']).toBeDefined();
    });

    it('should fail validation when required fields are missing', () => {
      const lead = new Lead({});
      const err = lead.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors['businessName']).toBeDefined();
      expect(err?.errors['originalUrl']).toBeDefined();
      expect(err?.errors['domain']).toBeDefined();
      // The audit fills the email from the site when the operator gives none (REV-45)
      expect(err?.errors['contactEmail']).toBeUndefined();
    });

    it('should transform _id to id and remove __v in toJSON', () => {
      const lead = new Lead({
        businessName: 'Apex Auto',
        originalUrl: 'https://apexauto.com',
        domain: 'apexauto.com',
        contactEmail: 'info@apexauto.com',
      });

      const json = lead.toJSON();
      expect(json.id).toBeDefined();
      expect(json.__v).toBeUndefined();
    });
  });

  describe('Audit Model', () => {
    it('should create valid audit document with default scores and status', () => {
      const leadId = new mongoose.Types.ObjectId();
      const audit = new Audit({
        leadId,
      });

      const err = audit.validateSync();
      expect(err).toBeUndefined();
      expect(audit.status).toBe('QUEUED');
      expect(audit.scores.total).toBe(0);
      // An unscored pillar stays absent, the design one included (REV-100, REV-101)
      expect(audit.scores.design).toBeUndefined();
      expect(audit.scores.performance).toBeUndefined();
      expect(audit.extractedBrandTokens.primaryColor).toBe('#000000');
      // Unread standards and an unrun scan stay absent (REV-102)
      expect(audit.standardsChecks).toBeUndefined();
      expect(audit.axeViolations).toBeUndefined();
    });

    it('stores web vitals under webVitals, not lighthouseMetrics (REV-102)', () => {
      const audit = new Audit({
        leadId: new mongoose.Types.ObjectId(),
        webVitals: { lcp: 1800, cls: 0.02 },
        lighthouseMetrics: { lcp: 9999 },
      } as Record<string, unknown>);

      expect(audit.webVitals).toEqual({ lcp: 1800, cls: 0.02 });
      expect(audit.toObject()).not.toHaveProperty('lighthouseMetrics');
    });

    it('requires every standards check once the checks are stored (REV-102)', () => {
      const checks = { https: true, viewport: true, title: true, favicon: false, structuredData: false, openGraph: true };
      const audit = new Audit({ leadId: new mongoose.Types.ObjectId(), standardsChecks: checks });
      const partial = new Audit({ leadId: new mongoose.Types.ObjectId(), standardsChecks: { https: true } });

      expect(audit.validateSync()).toBeUndefined();
      expect(audit.toObject().standardsChecks).toEqual(checks);
      expect(partial.validateSync()?.errors['standardsChecks.favicon']).toBeDefined();
    });

    it('keeps the axe violations as given (REV-102)', () => {
      const axeViolations = [
        {
          id: 'image-alt',
          impact: 'critical',
          description: 'Images must have alternate text',
          help: 'Images must have alternate text',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
          tags: ['wcag2a'],
          nodeCount: 1,
          nodes: [{ target: 'img.hero', html: '<img class="hero">' }],
        },
      ];
      const audit = new Audit({ leadId: new mongoose.Types.ObjectId(), axeViolations });

      expect(audit.validateSync()).toBeUndefined();
      expect(audit.axeViolations).toEqual(axeViolations);
    });

    it("accepts a 'design' measurement error for a templated critique (REV-101)", () => {
      const audit = new Audit({
        leadId: new mongoose.Types.ObjectId(),
        measurementErrors: [{ measurement: 'design', message: 'The Vision model gave no valid critique' }],
      });
      const unknown = new Audit({
        leadId: new mongoose.Types.ObjectId(),
        measurementErrors: [{ measurement: 'layout', message: 'x' }],
      });

      expect(audit.validateSync()).toBeUndefined();
      expect(unknown.validateSync()).toBeDefined();
    });

    it('keeps the original site layout and the reason it could not be read (REV-104)', () => {
      const siteLayout = {
        sections: [{ kind: 'services', heading: 'Usługi' }],
        hero: { media: 'side', mediaSide: 'right', align: 'left', tone: 'light' },
        nav: { itemCount: 5, centeredLogo: false, sticky: true, hasCta: true },
        density: 'airy',
      };
      const read = new Audit({ leadId: new mongoose.Types.ObjectId(), siteLayout });
      expect(read.toObject().siteLayout).toEqual(siteLayout);
      const unread = new Audit({ leadId: new mongoose.Types.ObjectId(), siteLayoutError: 'No block starts on the first screen' });
      expect(unread.toObject().siteLayoutError).toBe('No block starts on the first screen');
      expect(unread.toObject().siteLayout).toBeUndefined();
    });

    it('keeps the original site sections and the reason they could not be read (REV-109)', () => {
      const siteSections = {
        sections: [
          {
            index: 1,
            role: 'hero',
            kind: 'other',
            arrangement: 'banner',
            intro: { heading: 'Gabinet', headingLevel: 1, text: ['Witamy.'], links: [] },
            items: [],
            extra: [],
            images: [],
            embeds: [],
            style: { background: '#112233' },
          },
        ],
        skipped: [{ index: 3, reason: 'noise', sample: 'Wszelkie prawa zastrzeżone' }],
        coverage: { pageChars: 100, capturedChars: 97, ratio: 0.97, uncaptured: [] },
      };
      const read = new Audit({ leadId: new mongoose.Types.ObjectId(), siteSections });
      expect(read.toObject().siteSections).toEqual(siteSections);
      const unread = new Audit({ leadId: new mongoose.Types.ObjectId(), siteSectionsError: 'layout walk failed: timeout' });
      expect(unread.toObject().siteSectionsError).toBe('layout walk failed: timeout');
      expect(unread.toObject().siteSections).toBeUndefined();
    });

    it('keeps the reading source and a sections measurement error (REV-113)', () => {
      const siteSections = {
        sections: [],
        skipped: [{ index: 1, reason: 'unassigned', sample: 'Licznik odwiedzin' }],
        coverage: { pageChars: 100, capturedChars: 90, ratio: 0.9, uncaptured: [] },
        source: 'llm',
      };
      const measurementErrors = [{ measurement: 'sections', message: 'No vision model' }];
      const audit = new Audit({ leadId: new mongoose.Types.ObjectId(), siteSections, measurementErrors });
      expect(audit.validateSync()).toBeUndefined();
      const read = audit.toObject();
      expect(read.siteSections).toEqual(siteSections);
      expect(read.measurementErrors?.map(({ measurement, message }) => ({ measurement, message }))).toEqual(measurementErrors);
    });

    it('should fail validation if leadId is missing', () => {
      const audit = new Audit({});
      const err = audit.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors['leadId']).toBeDefined();
    });

    it('should support populated a11y violations and critical flaws', () => {
      const leadId = new mongoose.Types.ObjectId();
      const audit = new Audit({
        leadId,
        a11ySummary: {
          violationsCount: 2,
          contrastIssuesCount: 1,
          missingAltCount: 1,
          criticalViolations: [
            { id: 'color-contrast', description: 'Low contrast', selector: '.hero p' },
          ],
        },
        designCritique: {
          criticalFlaws: [
            { title: 'No CTA', impact: 'Low conversion', recommendation: 'Add CTA' },
          ],
        },
      });

      const err = audit.validateSync();
      expect(err).toBeUndefined();
      expect(audit.a11ySummary.criticalViolations).toHaveLength(1);
      expect(audit.designCritique.criticalFlaws).toHaveLength(1);
    });
  });

  describe('EmailCampaign Model', () => {
    it('should create valid email campaign document with defaults', () => {
      const leadId = new mongoose.Types.ObjectId();
      const campaign = new EmailCampaign({
        leadId,
        senderEmail: 'outreach@revampdemo.com',
        recipientEmail: 'director@listonosz.site',
        subject: 'Redesign concept',
        bodyHtml: '<p>Hello</p>',
        trackingToken: 'tok-123456',
      });

      const err = campaign.validateSync();
      expect(err).toBeUndefined();
      expect(campaign.status).toBe('DRAFT');
      expect(campaign.requiresManualReview).toBe(true);
      expect(campaign.metrics.openCount).toBe(0);
      expect(campaign.metrics.clickCount).toBe(0);
    });

    it('should fail validation when required fields are missing', () => {
      const campaign = new EmailCampaign({});
      const err = campaign.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors['leadId']).toBeDefined();
      expect(err?.errors['senderEmail']).toBeDefined();
      expect(err?.errors['recipientEmail']).toBeDefined();
      expect(err?.errors['subject']).toBeDefined();
      expect(err?.errors['bodyHtml']).toBeDefined();
      expect(err?.errors['trackingToken']).toBeDefined();
    });
  });

  describe('AnalyticsEvent Model (REV-18)', () => {
    it('should create valid analytics event with defaults', () => {
      const event = new AnalyticsEvent({
        eventType: 'dwell_time',
        trackingToken: 'tok-xyz',
        dwellTimeSeconds: 45,
        scrollDepthPercent: 80,
        ipHash: 'abc123hash',
        userAgent: 'Mozilla/5.0 Chrome',
      });

      const err = event.validateSync();
      expect(err).toBeUndefined();
      expect(event.eventType).toBe('dwell_time');
      expect(event.dwellTimeSeconds).toBe(45);
      expect(event.scrollDepthPercent).toBe(80);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should fail validation when eventType is missing or invalid', () => {
      const missing = new AnalyticsEvent({});
      const err1 = missing.validateSync();
      expect(err1).toBeDefined();
      expect(err1?.errors['eventType']).toBeDefined();

      const invalid = new AnalyticsEvent({ eventType: 'invalid_type' });
      const err2 = invalid.validateSync();
      expect(err2).toBeDefined();
      expect(err2?.errors['eventType']).toBeDefined();
    });
  });

  describe('MvpProject Model', () => {
    it('keeps the rebuild summary (REV-110)', () => {
      const doc = new MvpProject({
        auditId: new mongoose.Types.ObjectId(),
        leadId: new mongoose.Types.ObjectId(),
        previewSlug: 's',
        fullPreviewUrl: 'u',
        storageHtmlPath: 'p',
        rebuild: { coverage: 0.98, sections: 2, omitted: [], tuning: ['alt:1'] },
      });
      expect(doc.toObject().rebuild).toEqual({ coverage: 0.98, sections: 2, omitted: [], tuning: ['alt:1'] });
    });
  });
});


