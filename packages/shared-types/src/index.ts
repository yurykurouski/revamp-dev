// ==============================================================================
// Revamp SaaS Shared Types & Interfaces
// ==============================================================================

// 0. JSON transport
/**
 * A domain type as it arrives over the API's JSON (REV-67): every `Date` becomes its ISO string,
 * recursively. Ids are already strings in the domain types. Clients type responses with it instead
 * of redeclaring the server shapes.
 */
export type Serialized<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer U>
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

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
  | 'real_estate'
  | 'other';

/**
 * Every status a lead can be in (REV-62). Only statuses something in the API or the workers writes
 * are listed; the allowed moves between them are `LEAD_TRANSITIONS` in `@revamp/validation`.
 * After dispatch the lead is `SENT` (spec.md once called it `DISPATCHED`).
 */
export const LEAD_STATUSES = [
  'QUEUED',
  'AUDITING',
  'AUDIT_FAILED',
  'AUDITED',
  'GENERATING',
  'NEEDS_APPROVAL',
  'SCHEDULED',
  'SENT',
  'OPENED',
  'CLICKED',
  'ENGAGED',
  'REJECTED',
  'UNSUBSCRIBED',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The plain-text draft as HTML: escaped, with its line breaks and a hidden preheader kept. The test
 * send and the approved outreach both use it, so both emails look the same (REV-60, REV-72)
 */
export function draftToHtml(body: string, preheader?: string): string {
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>\n`
    : '';
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `${hiddenPreheader}${paragraphs}`;
}

/** Pipeline-wide lead counts from GET /api/v1/leads/stats; ignores list filters (REV-43) */
export interface ILeadStats {
  total: number;
  byStatus: Partial<Record<LeadStatus, number>>;
}

export type AuditStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type EmailCampaignStatus =
  | 'DRAFT'
  | 'NEEDS_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'SENDING'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'REJECTED'
  | 'UNSUBSCRIBED';

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
  /** Absent until the operator enters one or the audit finds one on the site (REV-45) */
  contactEmail?: string;
  contactPhone?: string;
  /** contactPhone in E.164 form, when it is written internationally; used to match discovered businesses (REV-35) */
  phoneE164?: string;
  /** Where the lead came from; absent on leads created before REV-35 */
  source?: LeadSource;
  /** Maps listing the lead was imported from, e.g. `google:<place_id>` or `osm:node/123` (REV-35) */
  externalId?: string;
  ownerName?: string;
  status: LeadStatus;
  totalScore?: number;
  tags: string[];
  previewUrl?: string;
  comparisonBannerUrl?: string;
  /** When the current MVP was last deployed; used to cache-bust the preview (REV-31) */
  mvpGeneratedAt?: string | Date;
  /** Why the last MVP generation failed; cleared when a new run starts (REV-31) */
  generationError?: string;
  /** The code and reason of a generation that failed because a rebuild model gave no answer (REV-132) */
  generationFailure?: IMvpRenderFailure;
  /** Why the last audit failed for good, as one readable line; cleared when a new audit is queued (REV-44) */
  auditError?: string;
  /** Complexity class from the latest audit, copied here for list sorting and filtering (REV-38) */
  siteComplexity?: SiteComplexityClass;
  /** Set when the latest audit found a one-page brochure site; these leads sort first (REV-38) */
  onePageBrochure?: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// 3. Audit Domain Entity
/**
 * Pillar scores, 0 - 100. A pillar whose measurement failed is absent, never filled with a stand-in
 * value, and `total` is weighted over the pillars that were measured (REV-100)
 */
export interface IAuditScores {
  total: number;
  /** Absent when the design critique is the templated fallback, not the Vision model's (REV-101) */
  design?: number;
  accessibility?: number;
  performance?: number;
  standards?: number;
}

/**
 * Audit measurements that can fail on their own without failing the audit (REV-100). `design` is the
 * Vision model's critique: when it fails, the critique is a template and its ratings are not scored (REV-101).
 * `sections` is the vision model's grouping of the page (REV-113): when it fails, the rules reading is
 * stored instead; it is not scored.
 */
export const AUDIT_MEASUREMENTS = ['performance', 'accessibility', 'standards', 'design'] as const;
export type AuditMeasurement = (typeof AUDIT_MEASUREMENTS)[number];

/** A measurement the audit could not take, and why; its values are left out of the audit */
export interface IMeasurementError {
  measurement: AuditMeasurement;
  message: string;
}

/**
 * Web vitals read in the page by a buffered PerformanceObserver; no Lighthouse runs (REV-102, stored as
 * `lighthouseMetrics` before). Values the audit did not measure are absent (REV-100); Speed Index and
 * INP are not stored because a headless page load cannot measure them (REV-105)
 */
export interface IWebVitals {
  lcp?: number; // ms
  cls?: number;
}

/** The web standards and SEO checks behind `scores.standards` (spec 3.1.3.2, REV-102, REV-118) */
export interface IStandardsChecks {
  https: boolean;
  viewport: boolean;
  title: boolean;
  /** A non-empty `<meta name="description">` (REV-118); absent on audits made before it */
  metaDescription?: boolean;
  /** Exactly one `<h1>` with text (REV-118); absent on audits made before it */
  singleH1?: boolean;
  /** An icon link in the page, or a working `/favicon.ico` */
  favicon: boolean;
  /** Schema.org markup (JSON-LD or microdata) */
  structuredData: boolean;
  /** At least one OpenGraph `og:` meta tag */
  openGraph: boolean;
}

/** Every standards check, in the order the dashboard lists them */
export const STANDARDS_CHECKS = ['https', 'viewport', 'title', 'metaDescription', 'singleH1', 'favicon', 'structuredData', 'openGraph'] as const satisfies readonly (keyof IStandardsChecks)[];
export type StandardsCheck = (typeof STANDARDS_CHECKS)[number];

/** Points per standards check (spec 3.1.3.2, REV-118); they add up to 100 */
export const STANDARDS_POINTS: Record<StandardsCheck, number> = {
  https: 20,
  viewport: 20,
  title: 10,
  metaDescription: 10,
  singleH1: 10,
  favicon: 10,
  structuredData: 10,
  openGraph: 10,
};

/**
 * The published MVP's standards checks (REV-118), read by code from the page the deploy uploaded with the same
 * checks as the audit. Serving over HTTPS depends on where the MVP is deployed, so its `https` is HTTPS-readiness:
 * the page loads nothing over plain http
 */
export interface IMvpStandards {
  checks: Required<IStandardsChecks>;
  score: number;
}

/**
 * The published MVP's web vitals (REV-119): the uploaded page loaded in the audit's mobile profile and read with the
 * audit's in-page reader. It is served from the demo host, not the business's own hosting. A value the page did not
 * report is absent and `error` says why; no other timing stands in for it.
 */
export interface IMvpPerformance {
  webVitals: IWebVitals;
  /** The performance score from LCP and CLS, as the audit scores the original; absent without an LCP */
  score?: number;
  /** The host the page was loaded from */
  host: string;
  measuredAt: string | Date;
  error?: string;
}

/**
 * The MVP's search and sharing tags (REV-118), built by code from the audit's verified data only: a tag whose
 * source is missing is left out
 */
export interface IMvpSeo {
  /** The original's meta description, else its first paragraph of at least 50 characters, at most 160 characters */
  description?: string;
  /** `og:image`: the original's own og:image, else the page's first photo of at least 200 px a side, else the logo */
  image?: string;
  /** `og:locale` ("pl_PL"), only when the language tag names or implies one region */
  locale?: string;
  /** Schema.org `LocalBusiness` from the verified contacts */
  localBusiness?: {
    name: string;
    url?: string;
    telephone?: string;
    email?: string;
    address?: string;
    image?: string;
    sameAs: string[];
  };
}

/**
 * One axe-core violation as the scan reported it (REV-102). Node HTML and failure summaries are
 * truncated and nodes capped per rule, so a large page cannot overflow the audit document
 */
export interface IAxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  /** Every node the rule failed on, including the ones left out of `nodes` */
  nodeCount: number;
  nodes: Array<{ target: string; html: string; failureSummary?: string }>;
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

/**
 * Where the original site's language was read from (REV-116), most specific first: `<html lang>`,
 * `<meta http-equiv="content-language">`, or a deterministic guess from the page text (en/ru/be/pl/lt).
 */
export const SITE_LANGUAGE_SOURCES = ['html', 'meta', 'text'] as const;
export type SiteLanguageSource = (typeof SITE_LANGUAGE_SOURCES)[number];

export interface ISiteContent {
  /** The original site's language tag ("pl-PL"); unset when it could not be determined (REV-25, REV-116) */
  language?: string;
  languageSource?: SiteLanguageSource;
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

// Site complexity estimated deterministically during the audit (REV-38)
export const SITE_COMPLEXITY_CLASSES = [
  'ONE_PAGE_BROCHURE',
  'SMALL_MULTI_PAGE',
  'COMPLEX',
  'UNKNOWN',
] as const;

export type SiteComplexityClass = (typeof SITE_COMPLEXITY_CLASSES)[number];

/** The DOM facts the complexity class was derived from */
export interface ISiteComplexitySignals {
  /** Distinct same-origin pages linked from the home page (anchors, legal pages, language switches and assets excluded) */
  internalPageCount: number;
  /** A sample of those internal paths, for the operator */
  internalPages: string[];
  hasEcommerce: boolean;
  hasBooking: boolean;
  hasLogin: boolean;
  hasSearch: boolean;
  /** Client-side routed web app (hash routes or an app framework shell) */
  hasAppShell: boolean;
  sectionCount: number;
  pageHeight: number;
}

export interface ISiteComplexity {
  class: SiteComplexityClass;
  signals?: ISiteComplexitySignals;
  /** Why the class was chosen, as short machine-readable codes (e.g. `internal_pages:4`, `ecommerce`) */
  reasons: string[];
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
  webVitals: IWebVitals;
  /** Absent when the page's standards could not be read (see `measurementErrors`) */
  standardsChecks?: IStandardsChecks;
  /** Absent when the accessibility scan failed (see `measurementErrors`) */
  a11ySummary?: IA11ySummary;
  /** How dated the original home page looks (REV-114); absent when it could not be read (see `siteEraError`) */
  siteEra?: ISiteEra;
  siteEraError?: string;
  /** The scan's violations (REV-102); absent when the scan failed or on audits before REV-102 */
  axeViolations?: IAxeViolation[];
  /** Measurements this audit could not take; their values are absent and the total is partial (REV-100) */
  measurementErrors?: IMeasurementError[];
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
  /** How hard the site is to replace with a one-page MVP; absent on audits before REV-38 */
  siteComplexity?: ISiteComplexity;
  createdAt: string | Date;
  completedAt?: string | Date;
}

// MVP completeness check: the generated page compared with the original site's data (REV-36)
export type CompletenessTier = 'critical' | 'important' | 'informational';

/**
 * `present` / `missing` / `altered` (found but different) apply to data the original site has;
 * `not_in_source` means the original site has no such data; `unsourced` flags contact data the
 * MVP shows that the original site doesn't (possibly made up).
 */
export type CompletenessStatus = 'present' | 'missing' | 'altered' | 'not_in_source' | 'unsourced';

export type CompletenessField =
  | 'businessName'
  | 'phone'
  | 'email'
  | 'address'
  | 'workingHours'
  | 'services'
  | 'socialLinks'
  | 'logo'
  | 'images'
  | 'testimonials'
  | 'rating'
  | 'foundingYear';

export interface ICompletenessCheck {
  field: CompletenessField;
  tier: CompletenessTier;
  status: CompletenessStatus;
  /** The value on the original site */
  originalValue?: string;
  /** What the MVP shows for it */
  mvpValue?: string;
  /** Extra detail, e.g. which services are missing */
  note?: string;
  /** Who decided the status: the LLM (its quote verified in code) or code alone (REV-37) */
  judgedBy?: 'llm' | 'code';
}

export interface IMvpCompletenessReport {
  /** `unverified` when the comparison itself failed; the checks are then empty */
  status: 'verified' | 'unverified';
  /** 0-100, weighted by tier; absent when unverified */
  score?: number;
  /** A critical field is missing, altered or unsourced */
  hasCriticalIssues: boolean;
  checks: ICompletenessCheck[];
  checkedAt: string | Date;
  error?: string;
  /** `llm` when an LLM judged the fields, `deterministic` for the code-only comparison (REV-37) */
  method?: 'llm' | 'deterministic';
  /** The model that judged the fields, when method is `llm` */
  model?: string;
  /** Why the LLM comparison fell back to code, when it did */
  llmError?: string;
}

/** The part of the report the leads list carries for the Kanban card */
export interface IMvpCompletenessSummary {
  status: IMvpCompletenessReport['status'];
  score?: number;
  hasCriticalIssues: boolean;
  /** Critical fields that are missing, altered or unsourced */
  criticalIssues: CompletenessField[];
}

export interface IMvpProject {
  _id: string;
  auditId: string;
  leadId: string;
  previewSlug: string;
  fullPreviewUrl: string;
  storageHtmlPath: string;
  comparisonBannerUrl?: string;
  isPublished: boolean;
  /** When this version was generated and deployed (REV-31) */
  generatedAt?: string | Date;
  /** Number of generation runs for the lead, the first one included (REV-31) */
  generationCount?: number;
  /** How much of the original site's key data the MVP kept; recomputed on every deploy (REV-36) */
  completenessReport?: IMvpCompletenessReport;
  /** Provider that actually wrote the copy, or 'deterministic' when the fallback did (REV-32) */
  provider?: MvpCopyProvider;
  /** Model that actually wrote the copy, or 'deterministic-fallback' (REV-32) */
  modelUsed?: string;
  /** Provider and model the operator picked for this run, when they picked one (REV-32) */
  requestedProvider?: LlmProviderId;
  requestedModel?: string;
  /** When an operator's free-text change was last applied and re-published (REV-85) */
  editedAt?: string | Date;
  /** The published page's standards checks (REV-118), re-checked on every publish; absent on MVPs published before it */
  standards?: IMvpStandards;
  /** The published page's web vitals (REV-119), measured on every publish; absent on MVPs published before it */
  performance?: IMvpPerformance;
  /** The model's page as it wrote it, placeholders unfilled (REV-138); absent on a rebuilt or Bento MVP */
  page?: string;
  /** The theme the page declared in `:root` (REV-138) */
  theme?: IMvpTheme;
  /** The operator's palette and fonts over the theme (REV-139); cleared by a regeneration */
  controls?: Partial<IMvpTheme>;
  /** Facts on the page the original site does not support, for the operator to check (REV-138) */
  grounding?: IMvpGroundingFlag[];
  /** The published versions of the page, oldest first, at most `MVP_MAX_VERSIONS` (REV-138) */
  versions?: IMvpPageVersion[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

// LLM providers for MVP copy generation (REV-32)
export type LlmProviderId = 'anthropic' | 'openai' | 'gemini' | 'claude-cli';

/** Who produced a run's copy: an LLM provider or the deterministic fallback */
export type MvpCopyProvider = LlmProviderId | 'deterministic';

export interface ILlmModelOption {
  /** Sent to the provider as-is (`claude --model <id>` for the local CLI) */
  id: string;
  label: string;
}

export interface ILlmProviderOption {
  id: LlmProviderId;
  label: string;
  /** Runs on the worker host (Claude Code CLI) instead of a paid HTTP API */
  local: boolean;
  /** Offered only outside production */
  devOnly: boolean;
  models: ILlmModelOption[];
  defaultModel: string;
}

/** Every provider and model the operator can pick; the first model is the provider's default */
export const LLM_PROVIDER_CATALOG: readonly ILlmProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic API',
    local: false,
    devOnly: false,
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    defaultModel: 'claude-opus-5',
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    local: false,
    devOnly: false,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
    defaultModel: 'gpt-4o',
  },
  {
    id: 'gemini',
    label: 'Google Gemini API',
    local: false,
    devOnly: false,
    models: [
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
    defaultModel: 'gemini-1.5-pro',
  },
  {
    id: 'claude-cli',
    label: 'Local LLM: Claude Code CLI',
    local: true,
    devOnly: false,
    models: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
      { id: 'haiku', label: 'Haiku' },
    ],
    defaultModel: 'sonnet',
  },
];

export const LLM_PROVIDER_IDS = ['anthropic', 'openai', 'gemini', 'claude-cli'] as const satisfies readonly LlmProviderId[];

export function findLlmProvider(id: string | undefined): ILlmProviderOption | undefined {
  return LLM_PROVIDER_CATALOG.find((p) => p.id === id);
}

/** Why a provider can't be picked right now */
export type LlmUnavailableReason = 'missing_api_key' | 'cli_not_found' | 'dev_only' | 'workers_offline';

export interface ILlmProviderStatus extends ILlmProviderOption {
  available: boolean;
  reason?: LlmUnavailableReason;
}

/** What the AI worker reports about its host, read by `GET /mvp/providers` */
export interface ILlmCapabilities {
  checkedAt: string;
  /** The env-based default the worker uses when a job names no provider; absent when none is configured */
  defaultProvider?: LlmProviderId;
  defaultModel?: string;
  providers: Array<{ id: LlmProviderId; available: boolean; reason?: LlmUnavailableReason }>;
}

export interface ILlmProvidersResponse {
  defaultProvider?: LlmProviderId;
  defaultModel?: string;
  /** False when no worker has reported in recently; every option is then unavailable */
  workersOnline: boolean;
  providers: ILlmProviderStatus[];
}

/** Redis key the AI worker publishes its LLM capabilities under */
export const LLM_CAPABILITIES_REDIS_KEY = 'revamp:llm-capabilities';

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
  unsubscribedAt?: string | Date;
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
  | 'token_usage'
  | 'unsubscribe';

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

// 7. BullMQ Queue Names and Data Payloads
/** Redis queue names; the API produces and the workers consume, so both read them from here (REV-48) */
export const QUEUE_NAMES = {
  AUDIT: 'audit-queue',
  AI_GENERATION: 'ai-gen-queue',
  DEPLOY: 'deploy-queue',
  EMAIL_DISPATCH: 'email-queue',
  /** Test sends of a draft to the operator's own address (REV-60) */
  EMAIL_TEST: 'email-test-queue',
  DISCOVERY: 'discovery-queue',
  /** An operator's free-text change to a generated MVP, interpreted by the LLM (REV-85) */
  /** The previous generator's free-text change; replaced by MVP_PAGE (REV-139), removed with its worker */
  MVP_PAGE: 'mvp-page-queue',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface IAuditJobData {
  leadId: string;
  url: string;
  niche: NicheType;
}

// Local business discovery from maps providers (REV-26)
export type DiscoveryProvider = 'osm' | 'google';

/** How a lead entered the system: added by hand or imported from a maps provider */
export type LeadSource = 'manual' | DiscoveryProvider;

export interface IDiscoveryJobData {
  provider: DiscoveryProvider;
  niche: NicheType;
  location: string;
  keyword?: string;
  /** Maximum number of new leads to create */
  limit: number;
  /**
   * Domains of businesses earlier searches already offered and checked (REV-107); the search leaves
   * them out and looks further for `limit` new ones
   */
  excludeDomains?: string[];
}

/** Most checked domains a search can carry forward (REV-107); the oldest drop out first */
export const DISCOVERY_MAX_EXCLUDED_DOMAINS = 1000;

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

// Pre-assessment of a discovered site before import (REV-98): one plain HTTP fetch of the home
// page, parsed without running scripts. Every signal is computed by code; no LLM is involved.

/** How worth pursuing a site looks: a simple site with redesign signs is a good candidate */
export const SITE_ASSESSMENT_VERDICTS = ['good', 'maybe', 'poor'] as const;
export type SiteAssessmentVerdict = (typeof SITE_ASSESSMENT_VERDICTS)[number];

/** Deterministic "bad" signs that suggest the site needs a redesign */
export const SITE_BAD_SIGNS = [
  'no_https',
  'invalid_certificate',
  'no_viewport',
  'table_layout',
  'frames',
  'flash',
  'old_jquery',
  'legacy_tags',
  'no_title',
  'no_meta_description',
  'stale_copyright',
  'slow_response',
  'heavy_html',
] as const;
export type SiteBadSign = (typeof SITE_BAD_SIGNS)[number];

/**
 * Why a site got its verdict, from its structure and the score of its redesign signs (strong
 * signs count 2, the rest 1). A simple site needs a score of 2 to be a good candidate; a complex
 * one needs 3 to be a maybe and is never a good candidate.
 */
export const SITE_VERDICT_REASONS = [
  'simple_with_signs',
  'simple_few_signs',
  'simple_no_signs',
  'complex_with_signs',
  'complex_few_signs',
] as const;
export type SiteVerdictReason = (typeof SITE_VERDICT_REASONS)[number];

/** What makes a site too big or too involved for a one-page MVP */
export const SITE_COMPLEXITY_SIGNS = ['many_pages', 'ecommerce', 'login', 'app_framework'] as const;
export type SiteComplexitySign = (typeof SITE_COMPLEXITY_SIGNS)[number];

/** What makes a site look dated (REV-114); read from its home page by code */
export const SITE_DATED_SIGNS = [
  // weight 2
  'table_layout',
  'no_viewport',
  'frames',
  'flash',
  'narrow_fixed',
  // weight 1
  'legacy_tags',
  'default_font',
  'old_jquery',
  'stale_copyright',
] as const;
export type SiteDatedSign = (typeof SITE_DATED_SIGNS)[number];

/** How dated the original home page looks (REV-114): a score from the signs, and the content width measured */
export interface ISiteEra {
  dated: boolean;
  score: number;
  signs: SiteDatedSign[];
  /** Width in px of the page's content column, when it was measured */
  contentWidth?: number;
}

/** Why a site could not be assessed */
export const SITE_ASSESSMENT_FAILURES = [
  'timeout',
  'unreachable',
  'invalid_certificate',
  'http_error',
  'not_html',
  'blocked_host',
] as const;
export type SiteAssessmentFailure = (typeof SITE_ASSESSMENT_FAILURES)[number];

export interface ISiteAssessmentAssessed {
  outcome: 'assessed';
  verdict: SiteAssessmentVerdict;
  /** Why the site got this verdict, shown to the operator as the argument for it */
  verdictReason: SiteVerdictReason;
  /** Score of the redesign signs: 2 per strong sign, 1 per other sign */
  signScore: number;
  /** Score the verdict rule needed for the next better verdict; absent for a good candidate */
  signScoreNeeded?: number;
  /** Small and simple enough for a one-page MVP: no complexity signs */
  simple: boolean;
  badSigns: SiteBadSign[];
  complexitySigns: SiteComplexitySign[];
  /** Distinct internal pages linked from the home page */
  internalPages: number;
  /** URL of the home page after redirects */
  finalUrl: string;
  httpStatus: number;
  responseMs: number;
  htmlBytes: number;
  /** Latest year found in the copyright notice, when there is one */
  copyrightYear?: number;
  assessedAt: string;
}

export interface ISiteAssessmentFailed {
  /** The check did not produce a verdict; the operator sees "could not assess", never a guess */
  outcome: 'failed';
  failure: SiteAssessmentFailure;
  /** Status code of the failing response (http_error only) */
  httpStatus?: number;
  assessedAt: string;
}

export type ISiteAssessment = ISiteAssessmentAssessed | ISiteAssessmentFailed;

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
  /** The lead that already covers this business (existing_lead only) */
  leadId?: string;
  /** Pre-assessment of the site, for `new` candidates found since REV-98 */
  assessment?: ISiteAssessment;
}

export interface IDiscoveryJobResult {
  /** Distinct listings returned by the provider */
  found: number;
  candidates: IDiscoveryCandidate[];
  /** Candidates per status at search time, including skipped listings (REV-35); absent on older jobs */
  counts?: Record<DiscoveryCandidateStatus, number>;
  /** Provider requests the search made while trying to fill the limit (REV-35) */
  requests?: number;
  /** The provider had no more listings for this search, so fewer than `limit` new businesses may be offered (REV-35) */
  exhausted?: boolean;
  /** Listings left out because an earlier search already checked their domain (REV-107) */
  skippedChecked?: number;
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
  /** Lead status before the run started; restored if generation fails for good (REV-31) */
  previousStatus?: LeadStatus;
  /** Operator's provider/model for this run only; the worker's env default applies otherwise (REV-32) */
  provider?: LlmProviderId;
  model?: string;
}

/** Which provider and model produced a run's copy, carried to the MvpProject (REV-32) */
export interface IMvpGenerationSource {
  provider: MvpCopyProvider;
  modelUsed: string;
  requestedProvider?: LlmProviderId;
  requestedModel?: string;
}

export interface IDeployJobData {
  leadId: string;
  auditId: string;
  mvpProjectId?: string;
  forceRegenerate?: boolean;
  previousStatus?: LeadStatus;
  generationSource?: IMvpGenerationSource;
  /** The model's page to publish (REV-138); the only kind of deploy since REV-141 */
  page: IMvpPageJob;
}

/** What the operator does to a model-designed page (REV-139): a change in their words, palette and fonts, or a restore */
export const MVP_PAGE_ACTIONS = ['change', 'controls', 'restore'] as const;
export type MvpPageAction = (typeof MVP_PAGE_ACTIONS)[number];

/** The operator's palette and fonts: a group given replaces the saved one, `null` clears it, a missing one is kept */
export interface IMvpControlsUpdate {
  colors?: { primary: string; accent: string; bg: string; surface: string; text: string } | null;
  fonts?: { heading: string; body: string } | null;
}

/** A job of the mvp-page queue (REV-139); the API waits for its result */
export interface IMvpPageJobData {
  mvpProjectId: string;
  action: MvpPageAction;
  /** The operator's words (`change`) */
  instruction?: string;
  /** `controls` */
  controls?: IMvpControlsUpdate;
  /** The version to restore (`restore`) */
  version?: number;
  /**
   * Epoch ms after which the job is no longer applied: the API has stopped waiting and told the operator it
   * timed out, so a late answer must not change the page behind their back.
   */
  deadline: number;
}

/** Why an action published nothing: the model failed, or the version no longer fits the audit (REV-139) */
export type MvpPageRefusal = MvpPageFailure | 'unusable_version';

export type IMvpPageJobResult =
  | { applied: true; /** The version it published; absent for palette and fonts */ version?: number }
  | { applied: false; reason: 'unchanged' }
  | { applied: false; reason: MvpPageRefusal; message: string; problems?: IMvpPageProblem[] };

export interface IEmailDispatchJobData {
  campaignId: string;
  leadId: string;
}

/**
 * A test send of the current draft to the operator (REV-60). It goes to the operator, not to the
 * lead, so it skips the HITL gate, carries no open tracking and never changes the lead or campaign.
 */
export interface IEmailTestJobData {
  leadId: string;
  to: string;
  subject: string;
  preheader?: string;
  /** Plain-text draft with its template variables already substituted */
  body: string;
}

export interface IEmailTestJobResult {
  messageId?: string;
  provider: string;
  sentAt: string;
}

/** Why an email could not be sent at all; shared so the API can recognise it in a failed job (REV-60) */
export const EMAIL_PROVIDER_NOT_CONFIGURED =
  'No email provider is configured: set EMAIL_PROVIDER to resend, sendgrid or smtp';

/**
 * The kinds of change the rebuild records as tuning codes (REV-119); `parseRebuildChange` (`@revamp/validation`) reads
 * a code into its kind. A new code needs a kind here, the parser, and an explanation in the dashboard in all five locales.
 */
export const REBUILD_CHANGE_KINDS = [
  'contrast',
  'overlay',
  'alt',
  'font-body',
  'line-height',
  'collapse',
  'h1-hidden',
  'booking-replaced',
  'booking-appended',
  'footer-added',
  'seo-description',
  'seo-og',
  'seo-jsonld',
  'style',
  'cards',
  'side',
  'fill',
  'hero-photo',
  'hero-cta',
  'type',
  'theme',
  'order',
  'css-dropped',
  'text-wall',
] as const;
export type RebuildChangeKind = (typeof REBUILD_CHANGE_KINDS)[number];

/** Who asked for a design change: the modernize layer (REV-114) or the operator's edit (REV-111) */
export const REBUILD_CHANGE_SOURCES = ['modernize', 'edit'] as const;
export type RebuildChangeSource = (typeof REBUILD_CHANGE_SOURCES)[number];

/** The code a generation the model could not make is stored with (REV-132, REV-138) */
export const MVP_RENDER_FAILURE_CODES = ['MVP_PAGE_UNAVAILABLE'] as const;
export type MvpRenderFailureCode = (typeof MVP_RENDER_FAILURE_CODES)[number];

/**
 * Why the model gave no page (REV-132, REV-138), stored on the lead. Leads failed by the previous generator
 * (REV-141) may still hold its codes in the database; the dashboard explains those in general words.
 */
export interface IMvpRenderFailure {
  code: MvpRenderFailureCode;
  reason: MvpPageFailure;
  message?: string;
  at: string | Date;
}


// 9. API Errors (REV-63)
/**
 * Every `error.code` the API can return. Each error response has the same shape,
 * `{ success: false, error: { code, message, details? } }`; clients branch on the code and show the message.
 */
export const API_ERROR_CODES = [
  // Written by the error handler for errors no route raised on purpose
  'VALIDATION_ERROR',
  'INVALID_ID',
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'DUPLICATE',
  'NOT_FOUND',
  'INTERNAL',
  // Leads and audits
  'INVALID_URL',
  'LEAD_NOT_FOUND',
  'LEAD_NOT_AUDITABLE',
  'AUDIT_NOT_FOUND',
  // MVP generation and previews
  'LLM_PROVIDER_NOT_ALLOWED',
  'NO_COMPLETED_AUDIT',
  'MVP_GENERATION_NOT_ALLOWED',
  'MVP_ALREADY_GENERATED',
  'MVP_NOT_FOUND',
  'MVP_EDIT_NOT_ALLOWED',
  'MVP_EDIT_FAILED',
  'MVP_EDIT_TIMEOUT',
  // REV-139: a page from before the model designed it takes only a regeneration; a version to restore
  'MVP_PREVIOUS_GENERATOR',
  'MVP_VERSION_NOT_FOUND',
  'MVP_VERSION_UNUSABLE',
  'PREVIEW_NOT_FOUND',
  // Outreach
  'LEAD_NOT_AWAITING_APPROVAL',
  'LEAD_NOT_REJECTABLE',
  'NO_CONTACT_EMAIL',
  'EMAIL_PROVIDER_NOT_CONFIGURED',
  'EMAIL_TEST_TIMEOUT',
  'EMAIL_SEND_FAILED',
  // Discovery
  'DISCOVERY_JOB_NOT_FOUND',
  'DISCOVERY_JOB_NOT_COMPLETED',
  'GEOCODING_UNAVAILABLE',
  'PLACE_NOT_FOUND',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface IApiError {
  code: ApiErrorCode;
  /** Readable text for the operator */
  message: string;
  /** Extra machine-readable context, e.g. the lead's status or the failed validation issues */
  details?: unknown;
}

export interface IApiErrorResponse {
  success: false;
  error: IApiError;
}

// Model-designed MVP page (REV-136): the model writes the page's HTML and CSS from a brief built by code; code checks
// it, flags facts the original does not support and fills every contact itself.

/** Contacts and the booking anchor, written by the model as `{{name}}` and filled by code */
export const MVP_PLACEHOLDERS = ['phone', 'email', 'address', 'hours', 'booking'] as const;
export type MvpPlaceholder = (typeof MVP_PLACEHOLDERS)[number];

/** The CSS custom properties every page declares in `:root`; the operator's palette and font controls override them */
export const MVP_THEME_VARS = {
  primary: '--rv-color-primary',
  accent: '--rv-color-accent',
  bg: '--rv-color-bg',
  surface: '--rv-color-surface',
  text: '--rv-color-text',
  fontHeading: '--rv-font-heading',
  fontBody: '--rv-font-body',
} as const;
export type MvpThemeKey = keyof typeof MVP_THEME_VARS;
export type IMvpTheme = Record<MvpThemeKey, string>;

/** Why a model-written page was rejected (`checkMvpPage`) */
export const MVP_PAGE_CHECKS = [
  'page:parse',
  'page:script',
  'page:external',
  'page:image',
  'page:css',
  'page:theme',
  'page:placeholder',
  'page:contact',
  'page:h1',
  'page:lang',
] as const;
export type MvpPageCheck = (typeof MVP_PAGE_CHECKS)[number];

export interface IMvpPageProblem {
  code: MvpPageCheck;
  message: string;
}

/** The largest page the model may return, in UTF-8 bytes */
export const MVP_PAGE_MAX_BYTES = 300_000;

/** Caps on what the brief carries, so the prompt stays within budget */
export const MVP_BRIEF_LIMITS = {
  services: 30,
  headings: 40,
  paragraphs: 60,
  /** Summed length of headings, paragraphs, service items and testimonials; whole texts only */
  copyChars: 12_000,
  serviceItems: 30,
  testimonials: 10,
  images: 24,
} as const;

/** Everything the model may read about the business; built by code from verified audit data, no contact values */
export interface IMvpSourceBrief {
  business: { name: string; niche: string; city?: string; originalUrl: string };
  language?: string;
  services: string[];
  copy: {
    title?: string;
    metaDescription?: string;
    h1?: string;
    headings: string[];
    paragraphs: string[];
    serviceItems: Array<{ title: string; description?: string }>;
    testimonials: Array<{ text: string; author?: string }>;
    rating?: { value: number; count?: number };
    foundingYear?: number;
  };
  brand: { primary: string; secondary: string; accent: string; fonts: string[]; logoUrl?: string };
  /** The original's image URLs, the only images the page may show besides the logo */
  images: string[];
  /** The placeholders the page may use: one per verified contact, `booking` always */
  placeholders: MvpPlaceholder[];
}

export const MVP_GROUNDING_KINDS = ['number', 'name'] as const;
export type MvpGroundingKind = (typeof MVP_GROUNDING_KINDS)[number];

/** A fact on the page that the original site's copy does not contain; shown to the operator, never a rejection */
export interface IMvpGroundingFlag {
  kind: MvpGroundingKind;
  text: string;
  /** The text around it on the page, at most 80 characters */
  context: string;
}

/** Why the model gave no page (REV-137): no provider, every call failed, or every answer was rejected by the checks */
export const MVP_PAGE_FAILURES = ['not_configured', 'call_failed', 'invalid_page'] as const;
export type MvpPageFailure = (typeof MVP_PAGE_FAILURES)[number];

/** The lowest WCAG contrast the operator's text color may have on the background and the surface (AA, REV-139) */
export const MVP_MIN_CONTRAST = 4.5;

/** The fonts the operator may pick (REV-139): fixed Google Fonts pairings, names safe in CSS */
export const MVP_FONT_CHOICES = [
  { id: 'classic', heading: 'Playfair Display', body: 'Source Sans 3', headingGeneric: 'serif', bodyGeneric: 'sans-serif' },
  { id: 'modern', heading: 'Poppins', body: 'Inter', headingGeneric: 'sans-serif', bodyGeneric: 'sans-serif' },
  { id: 'friendly', heading: 'Nunito', body: 'Open Sans', headingGeneric: 'sans-serif', bodyGeneric: 'sans-serif' },
  { id: 'editorial', heading: 'Lora', body: 'Lato', headingGeneric: 'serif', bodyGeneric: 'sans-serif' },
  { id: 'bold', heading: 'Montserrat', body: 'Roboto', headingGeneric: 'sans-serif', bodyGeneric: 'sans-serif' },
  { id: 'elegant', heading: 'DM Serif Display', body: 'DM Sans', headingGeneric: 'serif', bodyGeneric: 'sans-serif' },
] as const satisfies readonly {
  id: string;
  heading: string;
  body: string;
  headingGeneric: 'serif' | 'sans-serif';
  bodyGeneric: 'serif' | 'sans-serif';
}[];
export type MvpFontChoice = (typeof MVP_FONT_CHOICES)[number];

/** At most this many published versions are kept per MVP; the oldest is removed from storage (REV-138) */
export const MVP_MAX_VERSIONS = 20;

/**
 * What made a version: a generation, the operator's free-text change, or a restore (REV-139). Palette and font
 * controls are not part of the raw page, so they make no version
 */
export const MVP_PAGE_VERSION_KINDS = ['generate', 'change', 'restore'] as const;
export type MvpPageVersionKind = (typeof MVP_PAGE_VERSION_KINDS)[number];

export interface IMvpPageVersion {
  /** 1, 2, …; never reused for an MVP */
  n: number;
  kind: MvpPageVersionKind;
  /** The operator's words for a change */
  instruction?: string;
  /** The version a restore re-published (REV-139) */
  from?: number;
  /** The page job (`IMvpPageJob.id`) that published it, so a retried job reuses its version */
  jobId?: string;
  provider?: string;
  model?: string;
  /** The raw page in the demos bucket: `v/<slug>/versions/<n>.html` */
  storagePath: string;
  createdAt: string | Date;
}

/** A page carried from the generation job to the deploy job (REV-138) */
export interface IMvpPageJob {
  /** A key unique to this page, so a retried deploy job finds the version it stored (BullMQ ids restart with Redis) */
  id: string;
  html: string;
  theme: IMvpTheme;
  grounding: IMvpGroundingFlag[];
  kind: MvpPageVersionKind;
  instruction?: string;
}
