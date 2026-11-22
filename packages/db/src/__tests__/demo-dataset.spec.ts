import { describe, expect, it } from 'vitest';
import { DesignCritiqueOutputSchema, MvpPageVersionSchema, MvpStandardsSchema, MvpThemeSchema } from '@revamp/validation';
import { DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD, buildDemoDataset, demoDocumentIds } from '../seed/demo-dataset.js';
import { verifyPassword } from '../password.js';
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
    for (const docs of [ds.leads, ds.audits, ds.mvpProjects, ds.emailCampaigns, ds.analyticsEvents, ds.pages, ds.organizations, ds.users, ds.memberships]) {
      expect(docs.length).toBeGreaterThan(0);
    }
  });

  it('every document passes its Mongoose schema', () => {
    const pairs: [typeof Lead | typeof Audit | typeof MvpProject | typeof EmailCampaign | typeof AnalyticsEvent | typeof Organization | typeof User | typeof Membership, object[]][] = [
      [Lead, ds.leads],
      [Audit, ds.audits],
      [MvpProject, ds.mvpProjects],
      [EmailCampaign, ds.emailCampaigns],
      [AnalyticsEvent, ds.analyticsEvents],
      [Organization, ds.organizations],
      [User, ds.users],
      [Membership, ds.memberships],
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
    expect(ds.users).toHaveLength(1);
    expect(ds.memberships).toHaveLength(1);
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
