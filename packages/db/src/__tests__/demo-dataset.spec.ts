import { describe, expect, it } from 'vitest';
import { DesignCritiqueOutputSchema, MvpPageVersionSchema, MvpStandardsSchema, MvpThemeSchema } from '@revamp/validation';
import { DEMO_OPERATOR_EMAIL, DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD, DEMO_VIEWER_EMAIL, buildDemoDataset, demoDocumentIds } from '../seed/demo-dataset.js';
import { verifyPassword } from '../password.js';
import { Business } from '../models/Business.model.js';
import { Membership } from '../models/Membership.model.js';
import { Organization } from '../models/Organization.model.js';
import { User } from '../models/User.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { Audit } from '../models/Audit.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { Lead } from '../models/Lead.model.js';
import { MvpProject } from '../models/MvpProject.model.js';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const ds = buildDemoDataset(NOW);
const ids = (docs: { _id: unknown }[]) => new Set(docs.map((d) => String(d._id)));
const hasDesignError = (audit: (typeof ds.audits)[number]) =>
  (audit.measurementErrors ?? []).some((e) => e.measurement === 'design');

describe('buildDemoDataset (REV-199)', () => {
  it('covers every required lead status', () => {
    const statuses = new Set(ds.leads.map((l) => l.status));
    for (const s of ['QUEUED', 'AUDITED', 'AUDIT_FAILED', 'NEEDS_APPROVAL', 'SENT', 'CLICKED', 'UNSUBSCRIBED']) {
      expect(statuses.has(s as never), s).toBe(true);
    }
  });

  it('has documents in every collection', () => {
    for (const docs of [ds.leads, ds.audits, ds.mvpProjects, ds.emailCampaigns, ds.analyticsEvents, ds.pages, ds.organizations, ds.users, ds.memberships, ds.businesses]) {
      expect(docs.length).toBeGreaterThan(0);
    }
  });

  it('every document passes its Mongoose schema', () => {
    const pairs: [typeof Lead | typeof Audit | typeof MvpProject | typeof EmailCampaign | typeof AnalyticsEvent | typeof Organization | typeof User | typeof Membership | typeof Business, object[]][] = [
      [Lead, ds.leads],
      [Audit, ds.audits],
      [MvpProject, ds.mvpProjects],
      [EmailCampaign, ds.emailCampaigns],
      [AnalyticsEvent, ds.analyticsEvents],
      [Organization, ds.organizations],
      [User, ds.users],
      [Membership, ds.memberships],
      [Business, ds.businesses],
    ];
    for (const [Model, docs] of pairs) {
      for (const doc of docs) {
        const error = new (Model as typeof Lead)(doc).validateSync();
        expect(error, `${Model.modelName} ${String((doc as { _id: unknown })._id)}: ${error?.message}`).toBeUndefined();
      }
    }
  });

  it('references point at seeded documents, and an MVP audit belongs to its lead', () => {
    const leads = ids(ds.leads);
    const audits = ids(ds.audits);
    const mvps = ids(ds.mvpProjects);
    const campaigns = ids(ds.emailCampaigns);
    for (const a of ds.audits) expect(leads.has(String(a.leadId))).toBe(true);
    for (const m of ds.mvpProjects) {
      expect(leads.has(String(m.leadId))).toBe(true);
      expect(audits.has(String(m.auditId))).toBe(true);
      const audit = ds.audits.find((a) => String(a._id) === String(m.auditId));
      expect(String(audit?.leadId)).toBe(String(m.leadId));
    }
    for (const c of ds.emailCampaigns) {
      expect(leads.has(String(c.leadId))).toBe(true);
      if (c.auditId) expect(audits.has(String(c.auditId))).toBe(true);
      if (c.mvpProjectId) expect(mvps.has(String(c.mvpProjectId))).toBe(true);
    }
    for (const e of ds.analyticsEvents) {
      if (e.leadId) expect(leads.has(String(e.leadId))).toBe(true);
      if (e.campaignId) expect(campaigns.has(String(e.campaignId))).toBe(true);
      if (e.mvpProjectId) expect(mvps.has(String(e.mvpProjectId))).toBe(true);
    }
  });

  it('every MVP page is in the dataset and its paths match the slug', () => {
    for (const m of ds.mvpProjects) {
      const page = ds.pages.find((p) => p.slug === m.previewSlug);
      expect(page).toBeDefined();
      expect(m.storageHtmlPath).toBe(`v/${m.previewSlug}/index.html`);
      expect(m.versions?.[0]?.storagePath).toBe(`v/${m.previewSlug}/versions/1.html`);
      expect(page?.indexHtml).toContain('<h1');
      expect(page?.versionHtml).toContain('{{phone}}');
    }
  });

  it('Mixed fields pass their Zod schemas', () => {
    for (const m of ds.mvpProjects) {
      expect(MvpThemeSchema.safeParse(m.theme).success).toBe(true);
      expect(MvpStandardsSchema.safeParse(m.standards).success).toBe(true);
      for (const v of m.versions ?? []) expect(MvpPageVersionSchema.safeParse(v).error).toBeUndefined();
    }
    for (const a of ds.audits.filter((a) => a.status === 'COMPLETED' && !hasDesignError(a))) {
      expect(DesignCritiqueOutputSchema.safeParse(a.designCritique).error).toBeUndefined();
    }
  });

  it('includes the edge cases', () => {
    expect(ds.leads.some((l) => !l.contactEmail)).toBe(true);
    expect(ds.audits.some((a) => (a.measurementErrors ?? []).some((e) => e.measurement === 'performance'))).toBe(true);
    expect(ds.audits.some((a) => hasDesignError(a) && a.aiFallbackUsed)).toBe(true);
  });

  it('uses only .test domains and emails', () => {
    for (const l of ds.leads) {
      expect(l.domain).toMatch(/\.test$/);
      expect(new URL(l.originalUrl).hostname).toMatch(/\.test$/);
      if (l.contactEmail) expect(l.contactEmail).toMatch(/@[a-z0-9.-]+\.test$/);
    }
    for (const c of ds.emailCampaigns) {
      expect(c.recipientEmail).toMatch(/@[a-z0-9.-]+\.test$/);
      expect(c.senderEmail).toMatch(/@[a-z0-9.-]+\.test$/);
    }
  });

  it('has a demo studio whose owner can sign in with the documented demo password (REV-206)', async () => {
    expect(ds.organizations).toHaveLength(1);
    expect(ds.users).toHaveLength(3);
    expect(ds.memberships).toHaveLength(3);
    const [user] = ds.users;
    const [membership] = ds.memberships;
    expect(user!.email).toBe(DEMO_OWNER_EMAIL);
    expect(DEMO_OWNER_EMAIL).toMatch(/@[a-z0-9.-]+\.test$/);
    expect(await verifyPassword(DEMO_OWNER_PASSWORD, user!.passwordHash)).toBe(true);
    expect(await verifyPassword(`${DEMO_OWNER_PASSWORD}x`, user!.passwordHash)).toBe(false);
    expect(membership).toMatchObject({ role: 'owner' });
    expect(String(membership!.userId)).toBe(String(user!._id));
    expect(String(membership!.organizationId)).toBe(String(ds.organizations[0]!._id));
  });

  it('has an operator and a viewer in the demo studio, who sign in with the same demo password (REV-207)', async () => {
    const byEmail = new Map(ds.users.map((u) => [u.email, u]));
    for (const [email, role] of [[DEMO_OWNER_EMAIL, 'owner'], [DEMO_OPERATOR_EMAIL, 'operator'], [DEMO_VIEWER_EMAIL, 'viewer']] as const) {
      const user = byEmail.get(email);
      expect(user, email).toBeDefined();
      expect(email).toMatch(/@[a-z0-9.-]+\.test$/);
      expect(await verifyPassword(DEMO_OWNER_PASSWORD, user!.passwordHash)).toBe(true);
      const membership = ds.memberships.find((m) => String(m.userId) === String(user!._id));
      expect(membership?.role, email).toBe(role);
      expect(String(membership!.organizationId)).toBe(String(ds.organizations[0]!._id));
    }
    // One studio with exactly one owner, so the last-owner rule can be shown
    expect(ds.memberships.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('has a shared business per demo lead, and every demo lead and audit points at it (REV-208)', () => {
    expect(ds.businesses).toHaveLength(ds.leads.length);
    const byId = new Map(ds.businesses.map((b) => [String(b._id), b]));
    expect(new Set(ds.businesses.map((b) => b.domain)).size).toBe(ds.businesses.length);
    const studio = String(ds.organizations[0]!._id);
    for (const lead of ds.leads) {
      const business = byId.get(String(lead['businessId']));
      expect(business, lead.businessName).toBeDefined();
      expect(business!.domain).toBe(lead.domain);
      expect(business!.businessName).toBe(lead.businessName);
      // The demo leads belong to the demo studio
      expect(String(lead['tenantId'])).toBe(studio);
    }
    const leadBusiness = new Map(ds.leads.map((l) => [String(l._id), String(l['businessId'])]));
    for (const audit of ds.audits) expect(String(audit['businessId'])).toBe(leadBusiness.get(String(audit.leadId)));
  });

  it('is deterministic for a given time and has unique ids', () => {
    expect(buildDemoDataset(NOW)).toEqual(ds);
    const all = Object.values(demoDocumentIds(ds)).flat().map(String);
    expect(new Set(all).size).toBe(all.length);
  });

  it('never claims a model provider wrote the demo pages', () => {
    for (const m of ds.mvpProjects) {
      expect(m['provider']).toBeUndefined();
      for (const v of m.versions) expect(v.provider).toBeUndefined();
    }
  });

  it('marks every lead as demo data', () => {
    for (const l of ds.leads) {
      expect(l.tags).toContain('demo-seed');
      expect(l.businessName.startsWith('Demo ')).toBe(true);
    }
  });
});
