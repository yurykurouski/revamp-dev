import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { Lead } from '../Lead.model.js';
import { Audit } from '../Audit.model.js';

describe('Mongoose Models (Lead & Audit)', () => {
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
});
