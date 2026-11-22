import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, EMAIL_GUESSED_TAG } from '@revamp/shared-types';
import { GenerateMvpSchema, leadFieldsFromAudit } from '../src/index.js';

const audit = (overrides: Record<string, unknown> = {}) => ({
  scores: { total: 63 },
  siteComplexity: { class: 'SIMPLE_MULTIPAGE' as const },
  extractedContacts: { phone: '+48 22 123 45 67', email: 'hello@clinic.example' },
  ...overrides,
});

describe('LEAD_ALREADY_EXISTS (REV-208)', () => {
  it('is an API error code, and the guessed-email tag is shared', () => {
    expect(API_ERROR_CODES).toContain('LEAD_ALREADY_EXISTS');
    expect(EMAIL_GUESSED_TAG).toBe('email-guessed');
  });
});

describe('leadFieldsFromAudit (REV-208)', () => {
  it('takes the score, the complexity class and the one-page flag from the audit', () => {
    expect(leadFieldsFromAudit(audit(), {}).set).toMatchObject({ totalScore: 63, siteComplexity: 'SIMPLE_MULTIPAGE', onePageBrochure: false });
    expect(leadFieldsFromAudit(audit({ siteComplexity: { class: 'ONE_PAGE_BROCHURE' } }), {}).set).toMatchObject({
      siteComplexity: 'ONE_PAGE_BROCHURE',
      onePageBrochure: true,
    });
  });

  it('fills a missing phone and a missing email from the site', () => {
    const { set, clearsEmailGuess } = leadFieldsFromAudit(audit(), {});
    expect(set).toMatchObject({ contactPhone: '+48 22 123 45 67', contactEmail: 'hello@clinic.example' });
    expect(clearsEmailGuess).toBe(false);
  });

  it('keeps the phone and the email the lead already has', () => {
    const { set } = leadFieldsFromAudit(audit(), { contactPhone: '+48 600 000 000', contactEmail: 'owner@clinic.example' });
    expect(set).not.toHaveProperty('contactPhone');
    expect(set).not.toHaveProperty('contactEmail');
  });

  it('replaces a guessed email with the one published on the site and says to drop the guess tag', () => {
    const lead = { contactEmail: 'info@clinic.example', tags: ['demo', EMAIL_GUESSED_TAG] };
    const { set, clearsEmailGuess } = leadFieldsFromAudit(audit(), lead);
    expect(set['contactEmail']).toBe('hello@clinic.example');
    expect(clearsEmailGuess).toBe(true);
  });

  it('keeps a guessed email when the site publishes none, and the tag with it', () => {
    const { set, clearsEmailGuess } = leadFieldsFromAudit(audit({ extractedContacts: {} }), { contactEmail: 'info@clinic.example', tags: [EMAIL_GUESSED_TAG] });
    expect(set).not.toHaveProperty('contactEmail');
    expect(clearsEmailGuess).toBe(false);
  });

  it('copes with an audit without contacts, scores or complexity', () => {
    expect(leadFieldsFromAudit({}, {}).set).toEqual({ onePageBrochure: false });
    expect(leadFieldsFromAudit({ scores: { total: 0 } }, {}).set).toMatchObject({ totalScore: 0 });
  });
});

describe('GenerateMvpSchema leadId (REV-208 review)', () => {
  it('takes the lead the request is for, which decides whose lead is generated when the audit is shared', () => {
    expect(GenerateMvpSchema.parse({ auditId: 'a1', leadId: 'l1' }).leadId).toBe('l1');
  });

  it('still accepts a request without one (an older client)', () => {
    expect(GenerateMvpSchema.parse({ auditId: 'a1' }).leadId).toBeUndefined();
  });

  it('refuses an empty lead id', () => {
    expect(GenerateMvpSchema.safeParse({ auditId: 'a1', leadId: '' }).success).toBe(false);
  });
});
