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
  | 'AUDIT_FAILED'
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
  /** How hard the site is to replace with a one-page MVP; absent on audits before REV-38 */
  siteComplexity?: ISiteComplexity;
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
  generatedContent: IMvpGeneratedContent;
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
  };
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
  /** Layout this version was rendered with; absent on MVPs generated before REV-54 (Bento) */
  layout?: IMvpLayoutSelection;
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

// 7. BullMQ Queue Names and Data Payloads
/** Redis queue names; the API produces and the workers consume, so both read them from here (REV-48) */
export const QUEUE_NAMES = {
  AUDIT: 'audit-queue',
  AI_GENERATION: 'ai-gen-queue',
  DEPLOY: 'deploy-queue',
  EMAIL_DISPATCH: 'email-queue',
  DISCOVERY: 'discovery-queue',
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
  /** The lead that already covers this business (existing_lead only) */
  leadId?: string;
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

// Layout variants of the generated MVP, picked per lead from its audit data (REV-54)
export const MVP_LAYOUT_VARIANTS = ['bento', 'split', 'editorial', 'compact'] as const;

export type MvpLayoutVariant = (typeof MVP_LAYOUT_VARIANTS)[number];

/** The layout an MVP was rendered with, and why it was chosen */
export interface IMvpLayoutSelection {
  variant: MvpLayoutVariant;
  /** Short machine-readable codes behind the choice (e.g. `complexity:ONE_PAGE_BROCHURE`, `images:5`) */
  reasons: string[];
}

export interface IBentoTemplateData {
  businessName: string;
  /** Page layout; the original Bento layout when absent (REV-54) */
  layout?: MvpLayoutVariant;
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
  /** Absolute public API URL ("https://api.example.com/api/v1"); the MVP loads the tracker and posts events here (REV-52) */
  publicApiUrl?: string;
  customHeadSnippet?: string;
}

