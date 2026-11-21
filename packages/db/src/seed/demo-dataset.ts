import { Types } from 'mongoose';
import {
  AnalyticsEventType,
  AuditMeasurement,
  AuditStatus,
  EmailCampaignStatus,
  IMvpPageVersion,
  IMvpStandards,
  IMvpTheme,
  IStandardsChecks,
  LeadStatus,
  NicheType,
  STANDARDS_CHECKS,
  STANDARDS_POINTS,
} from '@revamp/shared-types';

// REV-199: the fixed demo dataset `npm run db:seed` loads. Test data that lives in a script, never read at runtime
// (REV-45): every domain and email is a reserved `.test` name, which never resolves, so the email worker's MX
// pre-flight bounces any send. Ids are fixed, so seeding is idempotent and only ever touches these documents.

export const DEMO_SEED_TAG = 'demo-seed';

type Extra = { [key: string]: unknown };

export interface DemoLead extends Extra {
  _id: Types.ObjectId;
  businessName: string;
  originalUrl: string;
  domain: string;
  niche: NicheType;
  city: string;
  contactEmail?: string;
  contactPhone?: string;
  status: LeadStatus;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoAudit extends Extra {
  _id: Types.ObjectId;
  leadId: Types.ObjectId;
  status: AuditStatus;
  measurementErrors?: { measurement: AuditMeasurement; message: string }[];
  aiFallbackUsed?: boolean;
  designCritique?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoMvpProject extends Extra {
  _id: Types.ObjectId;
  leadId: Types.ObjectId;
  auditId: Types.ObjectId;
  previewSlug: string;
  fullPreviewUrl: string;
  storageHtmlPath: string;
  theme: IMvpTheme;
  standards: IMvpStandards;
  versions: IMvpPageVersion[];
}

export interface DemoEmailCampaign extends Extra {
  _id: Types.ObjectId;
  leadId: Types.ObjectId;
  auditId?: Types.ObjectId;
  mvpProjectId?: Types.ObjectId;
  status: EmailCampaignStatus;
  senderEmail: string;
  recipientEmail: string;
  trackingToken: string;
}

export interface DemoAnalyticsEvent extends Extra {
  _id: Types.ObjectId;
  leadId?: Types.ObjectId;
  campaignId?: Types.ObjectId;
  mvpProjectId?: Types.ObjectId;
  eventType: AnalyticsEventType;
  timestamp: Date;
}

export interface DemoPage {
  slug: string;
  /** The published page: placeholders filled with the fake contacts, as `v/<slug>/index.html` */
  indexHtml: string;
  /** The raw page as the model would have written it, as `v/<slug>/versions/1.html` */
  versionHtml: string;
}

export interface DemoDataset {
  leads: DemoLead[];
  audits: DemoAudit[];
  mvpProjects: DemoMvpProject[];
  emailCampaigns: DemoEmailCampaign[];
  analyticsEvents: DemoAnalyticsEvent[];
  pages: DemoPage[];
}

export interface DemoStorage {
  s3Endpoint: string;
  demosBucket: string;
}

export type DemoCollection = 'leads' | 'audits' | 'mvpProjects' | 'emailCampaigns' | 'analyticsEvents';

/** Fixed ids: prefix `5eed`, one byte for the collection, then the index */
const KIND = { lead: 1, audit: 2, mvp: 3, campaign: 4, event: 5 } as const;
const demoId = (kind: keyof typeof KIND, n: number) =>
  new Types.ObjectId(`5eed${KIND[kind].toString(16).padStart(2, '0')}${n.toString(16).padStart(18, '0')}`);

const SENDER = 'outreach@revamp-demo.test';
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface LeadSpec {
  key: string;
  name: string;
  niche: NicheType;
  city: string;
  status: LeadStatus;
  email?: string;
  phone: string;
  /** Days before `now` the lead was added */
  age: number;
}

const LEADS: LeadSpec[] = [
  { key: 'dental', name: 'Demo Dental Studio', niche: 'dental', city: 'Warsaw', status: 'QUEUED', email: 'hello@dental-studio.test', phone: '+48 22 000 0001', age: 0 },
  { key: 'auto', name: 'Demo Auto Repair', niche: 'auto', city: 'Vilnius', status: 'AUDIT_FAILED', email: 'service@auto-repair.test', phone: '+370 5 000 0002', age: 1 },
  { key: 'law', name: 'Demo Law Office', niche: 'legal', city: 'Krakow', status: 'AUDITED', email: 'office@law-office.test', phone: '+48 12 000 0003', age: 2 },
  { key: 'beauty', name: 'Demo Beauty Salon', niche: 'beauty', city: 'Gdansk', status: 'AUDITED', phone: '+48 58 000 0004', age: 3 },
  { key: 'fitness', name: 'Demo Fitness Club', niche: 'fitness', city: 'Wroclaw', status: 'NEEDS_APPROVAL', email: 'team@fitness-club.test', phone: '+48 71 000 0005', age: 4 },
  { key: 'bistro', name: 'Demo Bistro', niche: 'restaurant', city: 'Poznan', status: 'SENT', email: 'chef@bistro.test', phone: '+48 61 000 0006', age: 6 },
  { key: 'builders', name: 'Demo Builders', niche: 'construction', city: 'Lodz', status: 'OPENED', email: 'info@builders.test', phone: '+48 42 000 0007', age: 8 },
  { key: 'clinic', name: 'Demo Clinic', niche: 'medical', city: 'Kaunas', status: 'CLICKED', email: 'reception@clinic.test', phone: '+370 37 000 0008', age: 10 },
  { key: 'realty', name: 'Demo Realty', niche: 'real_estate', city: 'Riga', status: 'ENGAGED', email: 'agents@realty.test', phone: '+371 6 000 0009', age: 12 },
  { key: 'florist', name: 'Demo Florist', niche: 'other', city: 'Minsk', status: 'UNSUBSCRIBED', email: 'flowers@florist.test', phone: '+375 17 000 0010', age: 14 },
];

/** Statuses whose lead has a generated MVP and an email campaign */
const OUTREACH: LeadStatus[] = ['NEEDS_APPROVAL', 'SENT', 'OPENED', 'CLICKED', 'ENGAGED', 'UNSUBSCRIBED'];
const CAMPAIGN_STATUS: Partial<Record<LeadStatus, EmailCampaignStatus>> = {
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  SENT: 'DELIVERED',
  OPENED: 'DELIVERED',
  CLICKED: 'DELIVERED',
  ENGAGED: 'DELIVERED',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
};
/** Tracking events each outreach status has had, in order */
const EVENTS: Partial<Record<LeadStatus, AnalyticsEventType[]>> = {
  OPENED: ['open'],
  CLICKED: ['open', 'click', 'pageview', 'scroll_depth', 'dwell_time'],
  ENGAGED: ['open', 'click', 'pageview', 'scroll_depth', 'dwell_time', 'cta_click', 'booking_intent'],
  UNSUBSCRIBED: ['open', 'unsubscribe'],
};

const PALETTES: [string, string, string, string, string][] = [
  ['#1f4e79', '#f2a900', '#ffffff', '#f4f6f8', '#1a1a1a'],
  ['#7a1f2b', '#d4a373', '#fffaf5', '#f5ece3', '#2b2b2b'],
  ['#14532d', '#84cc16', '#ffffff', '#f0fdf4', '#111827'],
];

function standardsOf(checks: Required<IStandardsChecks>): IMvpStandards {
  return { checks, score: STANDARDS_CHECKS.reduce((sum, c) => sum + (checks[c] ? STANDARDS_POINTS[c] : 0), 0) };
}

const ORIGINAL_CHECKS: Required<IStandardsChecks> = {
  https: true,
  viewport: false,
  title: true,
  metaDescription: false,
  singleH1: false,
  favicon: true,
  structuredData: false,
  openGraph: false,
};
const MVP_CHECKS: Required<IStandardsChecks> = { ...ORIGINAL_CHECKS, viewport: true, metaDescription: true, singleH1: true, openGraph: true };

function critique(name: string) {
  return {
    visualHierarchyRating: 42,
    mobileFriendlinessRating: 35,
    primaryCtaFound: false,
    datedDesignFactors: ['Fixed-width layout', 'Low-contrast body text'],
    criticalFlaws: [
      { title: 'No clear call to action', impact: `Visitors of ${name} cannot see how to book.`, recommendation: 'Add one booking button above the fold.' },
      { title: 'Hard to read on phones', impact: 'Text is tiny and needs zooming on a phone.', recommendation: 'Use a responsive layout with 16px body text.' },
      { title: 'Contacts buried in the footer', impact: 'The phone number is hard to find.', recommendation: 'Show the phone number in the header.' },
    ],
    quickWins: ['Add a viewport meta tag', 'Write a meta description', 'Keep one h1 per page'],
  };
}

const TEMPLATE_CRITIQUE = {
  visualHierarchyRating: 0,
  mobileFriendlinessRating: 0,
  primaryCtaFound: false,
  datedDesignFactors: [],
  criticalFlaws: [
    { title: 'Design review unavailable', impact: 'The vision model did not answer.', recommendation: 'Retry the audit later.' },
  ],
  quickWins: [],
};

function page(spec: LeadSpec, theme: IMvpTheme, contacts: { phone: string; email: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${spec.name} — ${spec.city}</title>
<meta name="description" content="${spec.name} in ${spec.city}. Demo page from the Revamp seed dataset.">
<style>
:root {
  --rv-color-primary: ${theme.primary};
  --rv-color-accent: ${theme.accent};
  --rv-color-bg: ${theme.bg};
  --rv-color-surface: ${theme.surface};
  --rv-color-text: ${theme.text};
  --rv-font-heading: ${theme.fontHeading};
  --rv-font-body: ${theme.fontBody};
}
body { margin: 0; background: var(--rv-color-bg); color: var(--rv-color-text); font-family: var(--rv-font-body); line-height: 1.6; }
header, section, footer { padding: 48px 24px; max-width: 960px; margin: 0 auto; }
h1, h2 { font-family: var(--rv-font-heading); color: var(--rv-color-primary); }
.cta { display: inline-block; padding: 12px 24px; background: var(--rv-color-accent); color: var(--rv-color-text); border-radius: 8px; text-decoration: none; }
.card { background: var(--rv-color-surface); padding: 24px; border-radius: 12px; }
</style>
</head>
<body>
<header><h1>${spec.name}</h1><p>Demo business in ${spec.city}. This page is seed data for the Revamp demo.</p><a class="cta" href="#contact">Get in touch</a></header>
<section class="card"><h2>Services</h2><p>Consultations, appointments and friendly advice.</p></section>
<footer id="contact"><h2>Contact</h2><p>Phone: ${contacts.phone}</p><p>Email: ${contacts.email}</p></footer>
</body>
</html>
`;
}

/** The demo dataset, with dates relative to `now`; the same `now` always gives the same dataset */
export function buildDemoDataset(
  now: Date,
  storage: DemoStorage = { s3Endpoint: 'http://localhost:9000', demosBucket: 'revamp-demos' },
): DemoDataset {
  const ds: DemoDataset = { leads: [], audits: [], mvpProjects: [], emailCampaigns: [], analyticsEvents: [], pages: [] };
  const at = (ms: number) => new Date(now.getTime() - ms);
  const endpoint = storage.s3Endpoint.replace(/\/+$/, '');
  let eventN = 0;
  let outreachN = 0;

  LEADS.forEach((spec, i) => {
    const n = i + 1;
    const leadId = demoId('lead', n);
    const auditId = demoId('audit', n);
    const domain = `${spec.name.toLowerCase().replace(/^demo /, '').replace(/\s+/g, '-')}.test`;
    const added = at(spec.age * DAY + HOUR);
    const audited = new Date(added.getTime() + 10 * 60_000);
    const isOutreach = OUTREACH.includes(spec.status);
    const auditDone = spec.status !== 'QUEUED' && spec.status !== 'AUDIT_FAILED';

    // The law office's audit lost its performance reading and fell back to the template critique (REV-100, REV-101)
    const degraded = spec.key === 'law';
    const scores = degraded
      ? { total: 48, accessibility: 55, standards: 40 }
      : { total: 38 + n, design: 42, accessibility: 60, performance: 35 + n, standards: 40 };

    const lead: DemoLead = {
      _id: leadId,
      businessName: spec.name,
      originalUrl: `https://www.${domain}/`,
      domain,
      niche: spec.niche,
      city: spec.city,
      ...(spec.email ? { contactEmail: spec.email } : {}),
      contactPhone: spec.phone,
      source: 'manual',
      operatorLocale: 'en',
      status: spec.status,
      tags: [DEMO_SEED_TAG],
      ...(auditDone ? { totalScore: scores.total, siteComplexity: 'ONE_PAGE_BROCHURE', onePageBrochure: true } : {}),
      ...(spec.status === 'AUDIT_FAILED' ? { auditError: 'The site did not load within 30 seconds (demo data).' } : {}),
      createdAt: added,
      updatedAt: audited,
    };

    const audit: DemoAudit = {
      _id: auditId,
      leadId,
      status: spec.status === 'QUEUED' ? 'QUEUED' : spec.status === 'AUDIT_FAILED' ? 'FAILED' : 'COMPLETED',
      createdAt: added,
      updatedAt: audited,
    };
    if (spec.status === 'AUDIT_FAILED') {
      audit.errorMessage = 'The site did not load within 30 seconds (demo data).';
    }
    if (auditDone) {
      Object.assign(audit, {
        scores,
        ...(degraded ? {} : { webVitals: { lcp: 3200 + n * 100, cls: 0.18 } }),
        standardsChecks: ORIGINAL_CHECKS,
        a11ySummary: { violationsCount: 6, contrastIssuesCount: 3, missingAltCount: 2, criticalViolations: [] },
        designCritique: degraded ? TEMPLATE_CRITIQUE : critique(spec.name),
        aiFallbackUsed: degraded,
        ...(degraded
          ? {
              measurementErrors: [
                { measurement: 'performance', message: 'LCP was not reported before the timeout (demo data).' },
                { measurement: 'design', message: 'The vision model did not answer; the template critique is shown (demo data).' },
              ],
            }
          : {}),
        extractedBrandTokens: { primaryColor: '#1f4e79', secondaryColor: '#ffffff', accentColor: '#f2a900', fontFamilies: ['Georgia'] },
        extractedContacts: { phone: spec.phone, ...(spec.email ? { email: spec.email } : {}), socialLinks: [] },
        extractedContent: {
          language: 'en',
          languageSource: 'html',
          title: spec.name,
          h1: spec.name,
          headings: ['Services', 'Contact'],
          paragraphs: [`${spec.name} serves customers in ${spec.city}. This text is demo seed data.`],
          serviceItems: [{ title: 'Consultations' }, { title: 'Appointments' }],
        },
        extractedServices: ['Consultations', 'Appointments'],
        completedAt: audited,
      });
    }
    ds.leads.push(lead);
    ds.audits.push(audit);
    if (!isOutreach) return;

    // Outreach leads: a model-designed MVP (REV-140) and a campaign
    const mvpId = demoId('mvp', n);
    const campaignId = demoId('campaign', n);
    const slug = `demo-${spec.key}`;
    const [primary, accent, bg, surface, text] = PALETTES[outreachN++ % PALETTES.length];
    const theme: IMvpTheme = { primary, accent, bg, surface, text, fontHeading: "'Poppins', sans-serif", fontBody: "'Inter', sans-serif" };
    const generated = new Date(audited.getTime() + 20 * 60_000);
    const storageHtmlPath = `v/${slug}/index.html`;
    const fullPreviewUrl = `${endpoint}/${storage.demosBucket}/${storageHtmlPath}`;
    const versionHtml = page(spec, theme, { phone: '{{phone}}', email: '{{email}}' });
    ds.pages.push({ slug, versionHtml, indexHtml: page(spec, theme, { phone: spec.phone, email: spec.email ?? '' }) });

    ds.mvpProjects.push({
      _id: mvpId,
      leadId,
      auditId,
      previewSlug: slug,
      fullPreviewUrl,
      storageHtmlPath,
      isPublished: true,
      generatedAt: generated,
      generationCount: 1,
      provider: 'anthropic',
      modelUsed: 'demo-seed',
      standards: standardsOf(MVP_CHECKS),
      page: versionHtml,
      theme,
      versions: [{ n: 1, kind: 'generate', provider: 'anthropic', model: 'demo-seed', storagePath: `v/${slug}/versions/1.html`, createdAt: generated }],
      createdAt: generated,
      updatedAt: generated,
    });
    Object.assign(lead, { previewUrl: fullPreviewUrl, mvpGeneratedAt: generated });

    const status = CAMPAIGN_STATUS[spec.status] as EmailCampaignStatus;
    const sent = spec.status === 'NEEDS_APPROVAL' ? undefined : new Date(generated.getTime() + DAY / 2);
    const events = EVENTS[spec.status] ?? [];
    const count = (t: AnalyticsEventType) => events.filter((e) => e === t).length;
    const trackingToken = `demo-token-${spec.key}`;
    ds.emailCampaigns.push({
      _id: campaignId,
      leadId,
      auditId,
      mvpProjectId: mvpId,
      status,
      senderEmail: SENDER,
      recipientEmail: spec.email ?? `owner@${domain}`,
      subject: `A refreshed website for ${spec.name}`,
      previewText: 'We rebuilt your home page — have a look.',
      bodyHtml: `<p>Hello ${spec.name} team,</p><p>We prepared a refreshed version of your home page.</p><p><a href="${fullPreviewUrl}">See the preview</a></p>`,
      bodyPlainText: `Hello ${spec.name} team, we prepared a refreshed version of your home page: ${fullPreviewUrl}`,
      trackingToken,
      requiresManualReview: true,
      ...(sent ? { approvedBy: 'demo-operator', approvedAt: sent, sentAt: sent } : {}),
      ...(spec.status === 'UNSUBSCRIBED' && sent ? { unsubscribedAt: new Date(sent.getTime() + 2 * HOUR) } : {}),
      metrics: {
        openCount: count('open'),
        clickCount: count('click'),
        demoVisitCount: count('pageview'),
        totalDwellTimeSeconds: count('dwell_time') * 95,
        ...(sent && count('open') ? { openedAt: new Date(sent.getTime() + HOUR) } : {}),
        ...(sent && count('click') ? { clickedAt: new Date(sent.getTime() + HOUR + 60_000) } : {}),
      },
      createdAt: generated,
      updatedAt: sent ?? generated,
    });

    events.forEach((eventType, k) => {
      const timestamp = new Date((sent as Date).getTime() + HOUR + k * 60_000);
      ds.analyticsEvents.push({
        _id: demoId('event', ++eventN),
        leadId,
        campaignId,
        ...(eventType === 'open' || eventType === 'unsubscribe' ? {} : { mvpProjectId: mvpId }),
        trackingToken,
        eventType,
        ...(eventType === 'dwell_time' ? { dwellTimeSeconds: 95 } : {}),
        ...(eventType === 'scroll_depth' ? { scrollDepthPercent: 75 } : {}),
        metadata: { source: DEMO_SEED_TAG },
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });

  return ds;
}

/** Every seed document's id, per collection: the only documents the seeder writes or deletes */
export function demoDocumentIds(ds: DemoDataset): Record<DemoCollection, Types.ObjectId[]> {
  return {
    leads: ds.leads.map((d) => d._id),
    audits: ds.audits.map((d) => d._id),
    mvpProjects: ds.mvpProjects.map((d) => d._id),
    emailCampaigns: ds.emailCampaigns.map((d) => d._id),
    analyticsEvents: ds.analyticsEvents.map((d) => d._id),
  };
}
