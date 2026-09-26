// ==============================================================================
// Revamp SaaS Shared Types & Interfaces
// ==============================================================================

// 1. Common Enums and Statuses
export type NicheType =
  | 'dental'
  | 'auto'
  | 'legal'
  | 'beauty'
  | 'construction'
  | 'medical'
  | 'restaurant'
  | 'fitness'
  | 'other';

export type LeadStatus =
  | 'QUEUED'
  | 'PENDING'
  | 'AUDITING'
  | 'AUDITED'
  | 'GENERATING'
  | 'MVP_READY'
  | 'NEEDS_APPROVAL'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'SENT'
  | 'DISPATCHED'
  | 'OPENED'
  | 'CLICKED'
  | 'ENGAGED'
  | 'REPLIED'
  | 'REJECTED'
  | 'UNSUBSCRIBED';

export type AuditStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type EmailCampaignStatus =
  | 'DRAFT'
  | 'NEEDS_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'SENDING'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'REJECTED';

// 2. Lead Domain Entity
export interface ILeadContacts {
  phone?: string;
  email: string;
  address?: string;
  workingHours?: string;
}

export interface ILead {
  _id: string;
  businessName: string;
  originalUrl: string;
  domain: string;
  niche: NicheType;
  city?: string;
  contactEmail: string;
  contactPhone?: string;
  ownerName?: string;
  status: LeadStatus;
  totalScore?: number;
  tags: string[];
  previewUrl?: string;
  comparisonBannerUrl?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// 3. Audit Domain Entity
export interface IAuditScores {
  total: number;         // 0 - 100
  design: number;        // 0 - 100
  accessibility: number; // 0 - 100
  performance: number;   // 0 - 100
  standards: number;     // 0 - 100
}

export interface ILighthouseMetrics {
  lcp: number;       // ms
  fidOrInp?: number; // ms
  cls: number;
  speedIndex?: number;
}

export interface IA11yViolation {
  id: string;
  description: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  selector: string;
}

export interface IA11ySummary {
  violationsCount: number;
  contrastIssuesCount: number;
  missingAltCount: number;
  criticalViolations: IA11yViolation[];
}

export interface ICriticalFlaw {
  title: string;
  impact: string;
  recommendation: string;
}

export interface IDesignCritique {
  visualHierarchyRating: number;
  mobileFriendlinessRating: number;
  primaryCtaFound: boolean;
  datedDesignFactors: string[];
  criticalFlaws: ICriticalFlaw[];
  quickWins: string[];
}

export interface IExtractedBrandTokens {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamilies: string[];
  logoUrl?: string;
  faviconUrl?: string;
}

// Contacts and content extracted deterministically from the original site (REV-23)
export interface ISocialLink {
  platform: string;
  url: string;
}

export interface IExtractedContacts {
  phone?: string;
  email?: string;
  address?: string;
  workingHours?: string;
  socialLinks: ISocialLink[];
}

export interface ISiteContent {
  language?: string;
  title?: string;
  metaDescription?: string;
  ogImage?: string;
  h1?: string;
  headings: string[];
  paragraphs: string[];
  serviceItems: Array<{ title: string; description?: string }>;
  navItems: string[];
  testimonials: Array<{ text: string; author?: string }>;
  images: string[];
  rating?: { value: number; count?: number };
  foundingYear?: number;
}

export interface IScreenshotUrls {
  desktopOriginal: string;
  mobileOriginal: string;
  /** Full-page captures of the original site (whole scrollable page) */
  desktopFull?: string;
  mobileFull?: string;
  comparisonBanner?: string;
}

export interface IAudit {
  _id: string;
  leadId: string;
  status: AuditStatus;
  scores: IAuditScores;
  lighthouseMetrics: ILighthouseMetrics;
  a11ySummary: IA11ySummary;
  designCritique: IDesignCritique;
  extractedBrandTokens: IExtractedBrandTokens;
  screenshotUrls: IScreenshotUrls;
  aiFallbackUsed?: boolean;
  errorMessage?: string;
  extractedServices?: string[];
  extractedContacts?: IExtractedContacts;
  extractedContent?: ISiteContent;
  /** How the audit crawler handled the site's cookie banner per capture context (REV-33) */
  cookieBannerHandled?: { desktop?: string; mobile?: string };
  generatedContent?: IMvpGeneratedContent;
  createdAt: string | Date;
  completedAt?: string | Date;
}

// 4. MVP Project Domain Entity
export interface IMvpServiceItem {
  title: string;
  description: string;
  lucideIconName: string;
}

export interface IMvpTrustSignal {
  metric: string;
  label: string;
}

export interface IMvpGeneratedContent {
  hero: {
    badge: string;
    headline: string;
    subheadline: string;
    primaryCtaText: string;
    secondaryCtaText: string;
  };
  /** Rewritten "about" copy grounded in the original site's own text */
  about?: {
    heading: string;
    body: string;
  };
  servicesHeading?: string;
  services: IMvpServiceItem[];
  trustSignals: IMvpTrustSignal[];
  offerNotice: string;
}

export interface IMvpProject {
  _id: string;
  auditId: string;
  leadId: string;
  previewSlug: string;
  fullPreviewUrl: string;
  storageHtmlPath: string;
  comparisonBannerUrl?: string;
  generatedContent: IMvpGeneratedContent;
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
  };
  isPublished: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// 5. Email Campaign Domain Entity
export interface IEmailMetrics {
  openedAt?: string | Date;
  openCount: number;
  clickedAt?: string | Date;
  clickCount: number;
  demoVisitCount: number;
  totalDwellTimeSeconds: number;
}

export interface IEmailCampaign {
  _id: string;
  leadId: string;
  auditId: string;
  mvpProjectId: string;
  status: EmailCampaignStatus;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  previewText?: string;
  bodyHtml: string;
  bodyPlainText?: string;
  trackingToken: string;
  requiresManualReview: boolean;
  approvedBy?: string;
  approvedAt?: string | Date;
  scheduledAt?: string | Date;
  sentAt?: string | Date;
  metrics: IEmailMetrics;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// 6. Analytics Event
export type AnalyticsEventType =
  | 'open'
  | 'click'
  | 'pageview'
  | 'dwell_time'
  | 'cta_click'
  | 'booking_intent'
  | 'scroll_depth'
  | 'token_usage';

export interface IAnalyticsEvent {
  _id: string;
  leadId?: string;
  campaignId?: string;
  mvpProjectId?: string;
  trackingToken?: string;
  eventType: AnalyticsEventType;
  dwellTimeSeconds?: number;
  scrollDepthPercent?: number;
  ipHash?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  timestamp: string | Date;
}

// 7. BullMQ Queue Data Payloads
export interface IAuditJobData {
  leadId: string;
  url: string;
  niche: NicheType;
}

// Local business discovery from maps providers (REV-26)
export type DiscoveryProvider = 'osm' | 'google';

export interface IDiscoveryJobData {
  provider: DiscoveryProvider;
  niche: NicheType;
  location: string;
  keyword?: string;
  /** Maximum number of new leads to create */
  limit: number;
}

export interface IDiscoveredBusiness {
  provider: DiscoveryProvider;
  externalId: string;
  name: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

/**
 * What discovery decided about a listing. Only `new` ones can be imported; the rest are shown
 * to the operator with the reason they were skipped.
 */
export type DiscoveryCandidateStatus = 'new' | 'existing_lead' | 'duplicate' | 'no_website' | 'invalid';

export interface IDiscoveryCandidate {
  provider: DiscoveryProvider;
  externalId: string;
  name: string;
  status: DiscoveryCandidateStatus;
  /** Normalised website; absent for no_website */
  website?: string;
  domain?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  /** The lead that already covers this domain (existing_lead only) */
  leadId?: string;
}

export interface IDiscoveryJobResult {
  /** Listings returned by the provider */
  found: number;
  candidates: IDiscoveryCandidate[];
}

export type DiscoveryImportOutcome = 'imported' | 'existing_lead' | 'not_importable' | 'not_found' | 'failed';

export interface IDiscoveryImportResult {
  imported: number;
  results: Array<{ externalId: string; outcome: DiscoveryImportOutcome; leadId?: string }>;
}

/** A browser position resolved to a searchable place name (REV-28) */
export interface IReverseGeocodeResult {
  /** "City, Country" ready for the discovery location field */
  location: string;
  city?: string;
  country?: string;
}

/** BullMQ job states as reported by GET /api/v1/discovery/:jobId */
export type DiscoveryJobState =
  | 'waiting'
  | 'waiting-children'
  | 'delayed'
  | 'prioritized'
  | 'active'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface IDiscoveryJobStatus {
  jobId: string;
  state: DiscoveryJobState;
  params: IDiscoveryJobData;
  result: IDiscoveryJobResult | null;
  error: string | null;
  attemptsMade: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface IAiGenerationJobData {
  leadId: string;
  auditId: string;
  forceRegenerate?: boolean;
}

export interface IDeployJobData {
  leadId: string;
  auditId: string;
  mvpProjectId?: string;
}

export interface IEmailDispatchJobData {
  campaignId: string;
  leadId: string;
}

// 8. Bento Template Data Interfaces
export interface IBentoReviewItem {
  author: string;
  rating?: number; // 1-5, only when the source states it
  comment: string;
  date?: string;
  source?: 'Google Maps' | 'Yandex Maps' | '2GIS' | 'Website' | 'Direct';
}

export interface IBentoServiceCard {
  title: string;
  description: string;
  lucideIconName?: string;
  badge?: string;
  highlight?: boolean;
}

export interface IBentoTemplateData {
  businessName: string;
  /** The original site's BCP 47 language tag ("pl-PL"); drives `<html lang>` and the template UI text (REV-25) */
  language?: string;
  niche?: NicheType;
  logoUrl?: string;
  monogramSvg?: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
  };
  fontFamilies?: string[];
  contacts: {
    phone?: string;
    email?: string;
    address?: string;
    workingHours?: string;
    city?: string;
  };
  hero: {
    badge?: string;
    headline: string;
    subheadline: string;
    primaryCtaText?: string;
    secondaryCtaText?: string;
  };
  services: IBentoServiceCard[];
  trustSignals?: Array<{
    metric: string;
    label: string;
  }>;
  reviews?: IBentoReviewItem[];
  about?: {
    heading: string;
    body: string;
  };
  servicesHeading?: string;
  heroImageUrl?: string;
  gallery?: string[];
  socialLinks?: ISocialLink[];
  footerTagline?: string;
  originalUrl?: string;
  trackingToken?: string;
  customHeadSnippet?: string;
}

