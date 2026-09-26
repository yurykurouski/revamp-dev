import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { Lead } from '../Lead.model.js';
import { Audit } from '../Audit.model.js';
import { EmailCampaign } from '../EmailCampaign.model.js';
import { AnalyticsEvent } from '../AnalyticsEvent.model.js';

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

    it('should fail validation when required fields are missing', () => {
      const lead = new Lead({});
      const err = lead.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors['businessName']).toBeDefined();
      expect(err?.errors['originalUrl']).toBeDefined();
      expect(err?.errors['domain']).toBeDefined();
      expect(err?.errors['contactEmail']).toBeDefined();
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
      expect(audit.scores.design).toBe(0);
      expect(audit.extractedBrandTokens.primaryColor).toBe('#000000');
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
});


