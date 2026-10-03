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
export const AUDIT_MEASUREMENTS = ['performance', 'accessibility', 'standards', 'design', 'sections'] as const;
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

/** The web standards checks behind `scores.standards` (spec 3.1.3.2, REV-102) */
export interface IStandardsChecks {
  https: boolean;
  viewport: boolean;
  title: boolean;
  /** An icon link in the page, or a working `/favicon.ico` */
  favicon: boolean;
  /** Schema.org markup (JSON-LD or microdata) */
  structuredData: boolean;
  /** At least one OpenGraph `og:` meta tag */
  openGraph: boolean;
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

// The original home page's layout, read deterministically from the DOM during the audit (REV-104)

/** Kinds of content section a home page is split into; `other` is a section no rule recognised */
export const SITE_SECTION_KINDS = [
  'services',
  'pricing',
  'gallery',
  'about',
  'team',
  'reviews',
  'faq',
  'contact',
  'map',
  // "Why us" / "Co nas wyróżnia": short headed points (REV-109)
  'features',
  'other',
] as const;
export type SiteSectionKind = (typeof SITE_SECTION_KINDS)[number];

/** How the first screen shows its photo: none, beside the headline, behind it, or as a slider */
export const SITE_HERO_MEDIA = ['none', 'side', 'background', 'slider'] as const;
export type SiteHeroMedia = (typeof SITE_HERO_MEDIA)[number];

/** Background tone of a first screen, in the same names as the MVP's hero styles */
export const SITE_HERO_TONES = ['light', 'tinted', 'dark', 'brand'] as const;
export type SiteHeroTone = (typeof SITE_HERO_TONES)[number];

export interface ISiteLayoutSection {
  kind: SiteSectionKind;
  /** The section's own heading, as a sample for the operator */
  heading?: string;
}

export interface ISiteLayout {
  /** Content sections below the first screen, in page order (header and footer excluded) */
  sections: ISiteLayoutSection[];
  hero: {
    media: SiteHeroMedia;
    /** Side of a `side` photo */
    mediaSide?: 'left' | 'right';
    align: 'left' | 'center';
    tone: SiteHeroTone;
  };
  nav: {
    /** Visible menu links in the header */
    itemCount: number;
    /** The logo sits in the middle of the header */
    centeredLogo: boolean;
    /** The header stays on screen while scrolling */
    sticky: boolean;
    /** The header has a filled call-to-action button */
    hasCta: boolean;
  };
  /** How much white space the sections carry, from their median vertical padding */
  density: 'compact' | 'comfortable' | 'airy';
}

// The original home page read section by section, deterministically from the DOM (REV-109)

/** Where a section sits on the page; `hero` is the first content block on the first screen */
export const SITE_SECTION_ROLES = ['header', 'hero', 'content', 'footer'] as const;
export type SiteSectionRole = (typeof SITE_SECTION_ROLES)[number];

/** How a section lays out its content; the rebuild follows this rather than the kind */
export const SITE_SECTION_ARRANGEMENTS = [
  'banner',
  'media-beside-text',
  'text',
  'card-grid',
  'list',
  'accordion',
  'tabs',
  'slider',
  'gallery',
  'embed',
] as const;
export type SiteSectionArrangement = (typeof SITE_SECTION_ARRANGEMENTS)[number];

export const SITE_LINK_KINDS = ['cta', 'link', 'phone', 'email', 'map'] as const;
export type SiteLinkKind = (typeof SITE_LINK_KINDS)[number];

export const SITE_EMBED_KINDS = ['map', 'video', 'form', 'widget'] as const;
export type SiteEmbedKind = (typeof SITE_EMBED_KINDS)[number];

/** Why a block was left out of the sections; nothing is dropped without one. `unassigned`: the model placed the piece nowhere (REV-113) */
export const SITE_SKIP_REASONS = ['noise', 'empty', 'duplicate', 'cap', 'unassigned'] as const;
export type SiteSkipReason = (typeof SITE_SKIP_REASONS)[number];

/** Which reader produced `Audit.siteSections`: the DOM rules (REV-109) or the vision model's grouping by id (REV-113) */
export const SITE_SECTIONS_SOURCES = ['rules', 'llm'] as const;
export type SiteSectionsSource = (typeof SITE_SECTIONS_SOURCES)[number];

export const SITE_IMAGE_SHAPES = ['square', 'round', 'wide', 'tall'] as const;
export type SiteImageShape = (typeof SITE_IMAGE_SHAPES)[number];

export interface ISiteImage {
  /** Absolute URL */
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface ISiteLink {
  label: string;
  href: string;
  kind: SiteLinkKind;
}

/** One repeated thing in a section: a service card, a person, an FAQ entry, a review, a price row */
export interface ISiteSectionItem {
  /** Service name, person's name, question, reviewer */
  title?: string;
  /** Role, date, eyebrow */
  subtitle?: string;
  /** Paragraphs and bullets, verbatim (an FAQ answer, a review's quote) */
  text: string[];
  image?: ISiteImage;
  /** A photo painted behind the item, e.g. a hero slide's background */
  backgroundImage?: string;
  /** As written, e.g. "od 150 zł" */
  price?: string;
  /** 0..5 */
  rating?: number;
  links: ISiteLink[];
}

export interface ISiteStyle {
  /** Hex */
  background?: string;
  /** Absolute URL */
  backgroundImage?: string;
  textColor?: string;
  align?: 'left' | 'center';
  /** Vertical padding per side, px */
  paddingY?: number;
  /** The content runs edge to edge rather than in a centred container */
  fullBleed?: boolean;
  /** media-beside-text: the media's share of the width, 0..1 */
  split?: number;
}

export interface ISiteItemStyle {
  background?: string;
  radius?: number;
  border?: boolean;
  shadow?: boolean;
  imageShape?: SiteImageShape;
  align?: 'left' | 'center';
}

export type ISiteSectionExtra =
  | { type: 'text'; text: string[] }
  | { type: 'items'; arrangement: SiteSectionArrangement; items: ISiteSectionItem[] };

export interface ISiteSection {
  /** Position in page order (header, blocks, footer), shared with `skipped` */
  index: number;
  role: SiteSectionRole;
  /** A label for tuning and completeness; the rebuild follows `arrangement` */
  kind: SiteSectionKind;
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  intro: { eyebrow?: string; heading?: string; headingLevel?: number; text: string[]; links: ISiteLink[] };
  items: ISiteSectionItem[];
  itemStyle?: ISiteItemStyle;
  /** Everything else in the section, in page order */
  extra: ISiteSectionExtra[];
  /** Images outside the items */
  images: ISiteImage[];
  embeds: { kind: SiteEmbedKind; src?: string }[];
  style: ISiteStyle;
  /** A cap cut something from this section */
  truncated?: boolean;
}

export interface ISiteTypography {
  heading: { family: string; size: number; weight: number; uppercase: boolean; color?: string };
  body: { family: string; size: number; weight: number; lineHeight?: number; color?: string };
  button?: { radius: number; filled: boolean; uppercase: boolean; background?: string; color?: string };
}

export interface ISiteSections {
  sections: ISiteSection[];
  typography?: ISiteTypography;
  skipped: { index: number; reason: SiteSkipReason; heading?: string; sample: string }[];
  coverage: { pageChars: number; capturedChars: number; ratio: number; uncaptured: string[] };
  /** Absent on readings stored before REV-113 */
  source?: SiteSectionsSource;
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
  /** The original home page's layout the MVP layout is derived from; absent when it could not be read (REV-104) */
  siteLayout?: ISiteLayout;
  /** Why the original layout could not be read; the MVP layout then falls back to the rule-based choice */
  siteLayoutError?: string;
  /** The original home page read section by section (REV-109); absent when it could not be read */
  siteSections?: ISiteSections;
  /** Why the sections could not be read */
  siteSectionsError?: string;
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
  /** When an operator's free-text change was last applied and re-published (REV-85) */
  editedAt?: string | Date;
  /** The operator's custom design, applied by the template on every render (REV-92) */
  design?: IMvpDesign;
  /** What the rebuild left out and fixed (REV-110); absent when the page was rendered by the Bento template */
  rebuild?: IMvpRebuildSummary;
  /** The operator's change to the rebuilt page (REV-111), applied by the rebuild on every render */
  rebuildEdit?: IRebuildEdit;
  /** The modernize level's design for the rebuilt page (REV-114), applied under the operator's edit */
  modernize?: IRebuildModernize;
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
  MVP_EDIT: 'mvp-edit-queue',
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
  /**
   * `relayout`: re-render the published bundle in the MVP's saved layout from its stored copy, with no
   * LLM call and no status change (REV-84). A full deploy when absent.
   */
  mode?: 'deploy' | 'relayout';
}

/** What a free-text change altered on the MVP (REV-85) */
export type MvpEditChange = 'content' | 'palette' | 'layout' | 'design';

/** An operator's free-text change to a generated MVP (REV-85) */
export interface IMvpEditJobData {
  mvpProjectId: string;
  /** `reset-design` drops the custom design (REV-92) without asking the model; `edit` when absent */
  action?: 'edit' | 'reset-design';
  /** The operator's own words, e.g. "make the headline punchier"; empty for a reset */
  instruction: string;
  /**
   * Epoch ms after which the change is no longer applied: the API has stopped waiting and told the
   * operator it timed out, so a late answer must not change the page behind their back.
   */
  deadline: number;
}

export interface IMvpEditJobResult {
  /** false when the model found nothing it could change within the grounding rules */
  applied: boolean;
  /** The model's one-line account of what it changed, or why it changed nothing */
  summary: string;
  changes: MvpEditChange[];
}

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
/** The Bento template's layouts (REV-54) */
export const BENTO_LAYOUT_VARIANTS = ['bento', 'split', 'editorial', 'compact'] as const;
export type BentoLayoutVariant = (typeof BENTO_LAYOUT_VARIANTS)[number];
/** `original`: the section-by-section rebuild of the original home page (REV-110); the rest are Bento's */
export const MVP_LAYOUT_VARIANTS = ['original', ...BENTO_LAYOUT_VARIANTS] as const;

export type MvpLayoutVariant = (typeof MVP_LAYOUT_VARIANTS)[number];

/**
 * Primary colors the operator can pick for an MVP besides the audit's brand colors (REV-16); a
 * free-text change may only pick among these and the brand colors (REV-85).
 */
export const MVP_COLOR_PRESETS = [
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Cyan', hex: '#0891B2' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Amber', hex: '#D97706' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Slate', hex: '#334155' },
] as const;

// An MVP's custom design (REV-92): a spec the edit agent writes and the template applies
// deterministically. Only these names and tokens exist, so the model never writes markup or CSS.

/** Content sections between the hero and the booking form; the hero, booking and contacts always stay */
export const MVP_DESIGN_SECTIONS = ['about', 'services', 'gallery', 'reviews'] as const;
export type MvpDesignSection = (typeof MVP_DESIGN_SECTIONS)[number];

/** Custom blocks the spec may add, each placed in the section order by its id */
export const MVP_DESIGN_BLOCK_IDS = ['block-1', 'block-2', 'block-3'] as const;
export type MvpDesignBlockId = (typeof MVP_DESIGN_BLOCK_IDS)[number];

/** What can be hidden: content sections and the hero's trust bar */
export const MVP_DESIGN_HIDEABLE = [...MVP_DESIGN_SECTIONS, 'trust'] as const;
export type MvpDesignHideable = (typeof MVP_DESIGN_HIDEABLE)[number];

/** Parts of the hero copy that can be reordered */
export const MVP_DESIGN_HERO_PARTS = ['badge', 'headline', 'subheadline', 'actions', 'trust', 'image'] as const;
export type MvpDesignHeroPart = (typeof MVP_DESIGN_HERO_PARTS)[number];

/** Named elements the spec can style */
export const MVP_DESIGN_ELEMENTS = [
  'header',
  'hero.badge',
  'hero.headline',
  'hero.subheadline',
  'cta.primary',
  'cta.secondary',
  'section.title',
  'service.card',
  'review.card',
  'about.body',
  'trust.badge',
] as const;
export type MvpDesignElement = (typeof MVP_DESIGN_ELEMENTS)[number];

/** Style tokens an element can take; colors are palette roles, never raw values */
export const MVP_DESIGN_TOKENS = {
  size: ['sm', 'md', 'lg', 'xl', '2xl'],
  weight: ['regular', 'medium', 'semibold', 'bold', 'black'],
  align: ['left', 'center', 'right'],
  transform: ['none', 'uppercase', 'capitalize'],
  tracking: ['tight', 'normal', 'wide'],
  color: ['text', 'muted', 'primary', 'accent', 'white'],
  background: ['none', 'surface', 'tint', 'primary', 'accent', 'dark'],
  radius: ['none', 'sm', 'md', 'lg', 'pill'],
  shadow: ['none', 'sm', 'md', 'lg', 'brand'],
  border: ['none', 'subtle', 'primary'],
} as const;
export type MvpDesignElementStyle = { -readonly [K in keyof typeof MVP_DESIGN_TOKENS]?: (typeof MVP_DESIGN_TOKENS)[K][number] };

/** Font pairings from system font stacks only: the page loads no external fonts */
export const MVP_DESIGN_FONTS = ['system', 'humanist', 'geometric', 'rounded', 'serif', 'serif-display', 'mono-display'] as const;
export const MVP_DESIGN_DENSITIES = ['compact', 'comfortable', 'airy'] as const;
export const MVP_DESIGN_CORNERS = ['sharp', 'soft', 'rounded', 'extra-round'] as const;
export const MVP_DESIGN_HERO_STYLES = ['light', 'tinted', 'dark', 'brand'] as const;
export const MVP_DESIGN_BLOCK_TYPES = ['highlight', 'features', 'cta'] as const;
export const MVP_DESIGN_BLOCK_STYLES = ['plain', 'tinted', 'brand', 'dark'] as const;
/** Where the split layout's photo sits: beside the copy, or behind it as a backdrop (REV-104) */
export const MVP_DESIGN_HERO_IMAGE_SIDES = ['left', 'right', 'behind'] as const;
/** Header arrangements: logo left and actions right, or the logo centred above them (REV-104) */
export const MVP_DESIGN_HEADER_LAYOUTS = ['standard', 'centered'] as const;

/** A block the spec adds; its text follows Strict Grounding like the rest of the copy */
export interface IMvpDesignBlock {
  id: MvpDesignBlockId;
  type: (typeof MVP_DESIGN_BLOCK_TYPES)[number];
  style?: (typeof MVP_DESIGN_BLOCK_STYLES)[number];
  title: string;
  body?: string;
  /** features: up to 4 items */
  items?: Array<{ title: string; text?: string; icon?: string }>;
  /** cta: the button text; the button always leads to the booking form */
  buttonText?: string;
}

export interface IMvpDesign {
  /** Sections and blocks in page order; any not listed follow in the layout's own order */
  sectionOrder?: Array<MvpDesignSection | MvpDesignBlockId>;
  hidden?: MvpDesignHideable[];
  hero?: {
    align?: 'left' | 'center';
    /** Order of the hero copy's parts */
    order?: MvpDesignHeroPart[];
    /** Side of the photo in the split layout, or `behind` the copy as a backdrop */
    imageSide?: (typeof MVP_DESIGN_HERO_IMAGE_SIDES)[number];
  };
  /** The header's arrangement and whether it links to the page's sections (REV-104) */
  header?: {
    layout?: (typeof MVP_DESIGN_HEADER_LAYOUTS)[number];
    links?: boolean;
  };
  theme?: {
    font?: (typeof MVP_DESIGN_FONTS)[number];
    density?: (typeof MVP_DESIGN_DENSITIES)[number];
    corners?: (typeof MVP_DESIGN_CORNERS)[number];
    heroStyle?: (typeof MVP_DESIGN_HERO_STYLES)[number];
  };
  elements?: Partial<Record<MvpDesignElement, MvpDesignElementStyle>>;
  blocks?: IMvpDesignBlock[];
  /**
   * CSS for looks the tokens can't express (REV-93), scoped to the page's own hooks and checked by the
   * workers' sanitizer before it is saved and again when it is rendered
   */
  customCss?: string;
}

/** The reason code of a layout the operator picked in the dashboard instead of the automatic one (REV-84) */
export const MVP_LAYOUT_MANUAL_REASON = 'rule:manual';

/** The layout an MVP was rendered with, and why it was chosen */
export interface IMvpLayoutSelection {
  variant: MvpLayoutVariant;
  /** Short machine-readable codes behind the choice (e.g. `complexity:ONE_PAGE_BROCHURE`, `images:5`) */
  reasons: string[];
  /**
   * The look derived from the original site's layout (REV-104): section order, hero, header and density.
   * The operator's own design is applied over it field by field; absent when the layout was not derived.
   */
  design?: IMvpDesign;
  /** How the rebuild was rendered (REV-114); absent on a layout other than `original` */
  rebuildLevel?: RebuildLevel;
}

/** The reason code of a layout derived from the original site's layout (REV-104) */
export const MVP_LAYOUT_DERIVED_REASON = 'rule:derived';
/** The reason code added when the original layout could not be read and the rules chose instead */
export const MVP_LAYOUT_UNREAD_REASON = 'site_layout:unread';

/** The reason code of an MVP rebuilt from the original site's sections (REV-110) */
export const MVP_LAYOUT_REBUILD_REASON = 'rule:rebuild';
/** Kept on a manual `original` pick that had to fall back, so a regeneration tries the rebuild again */
export const MVP_LAYOUT_MANUAL_ORIGINAL = 'manual:original';
/** Why the rebuild is at the modernize level (REV-114): the site is dated, the operator chose it, or the model's design was replaced by the default */
export const MVP_LAYOUT_MODERNIZE_REASONS = {
  dated: 'modernize:dated',
  manual: 'modernize:manual',
  fallback: 'modernize:default',
} as const;
/** Why the rebuild fell back to the Bento template (REV-110); stored first in `layout.reasons` */
export const REBUILD_FALLBACK_REASONS = [
  'rebuild:unread',
  'rebuild:no_content',
  'rebuild:low_coverage',
  'rebuild:flat',
  'rebuild:invalid',
  'rebuild:too_large',
] as const;
export type RebuildFallbackReason = (typeof REBUILD_FALLBACK_REASONS)[number];

export const REBUILD_OMISSIONS = ['section', 'nav_link', 'link', 'embed', 'image', 'text', 'item'] as const;
export type RebuildOmission = (typeof REBUILD_OMISSIONS)[number];

/** What the rebuild kept out and which fixes it applied (REV-110) */
export interface IMvpRebuildSummary {
  /** The reader's coverage ratio of the original page */
  coverage: number;
  /** Sections rendered (header and footer excluded) */
  sections: number;
  omitted: { what: RebuildOmission; reason: string; sample?: string }[];
  /** Fix codes, e.g. `contrast:3`, `overlay:1`, `alt:12`, `font:body-16`, `collapse:11`, `h1:hidden` */
  tuning: string[];
  /** `faithful` keeps the original look; `modern` applies the modernize design (REV-114) */
  level?: RebuildLevel;
}

/** How far the rebuild departs from the original look (REV-114) */
export const REBUILD_LEVELS = ['faithful', 'modern'] as const;
export type RebuildLevel = (typeof REBUILD_LEVELS)[number];

// The rebuild edit (REV-111): the operator's change to a rebuilt MVP, by the reader's ids and fixed values only

/** A section's background: the one read from the original, the page's, a tint of the primary, the primary, or dark */
export const REBUILD_EDIT_BACKGROUNDS = ['original', 'page', 'tinted', 'brand', 'dark'] as const;
export type RebuildEditBackground = (typeof REBUILD_EDIT_BACKGROUNDS)[number];
export const REBUILD_EDIT_ALIGNS = ['left', 'center'] as const;
export const REBUILD_EDIT_HEADING_CASES = ['none', 'uppercase'] as const;

/** The only arrangements a section can be switched to (REV-114) */
export const REBUILD_EDIT_ARRANGEMENTS = ['card-grid', 'list'] as const;
export const REBUILD_MEDIA_FITS = ['natural', 'fill'] as const;
export type RebuildMediaFit = (typeof REBUILD_MEDIA_FITS)[number];
export const REBUILD_HERO_STYLES = ['split', 'banner'] as const;
export type RebuildHeroStyle = (typeof REBUILD_HERO_STYLES)[number];
export const REBUILD_TYPE_SCALES = ['original', 'modern'] as const;

export interface IRebuildSectionEdit {
  background?: RebuildEditBackground;
  align?: (typeof REBUILD_EDIT_ALIGNS)[number];
  /** The section's vertical padding */
  density?: (typeof MVP_DESIGN_DENSITIES)[number];
  /** Intro paragraphs or list items shown as cards, or paragraphs as a list (REV-114) */
  arrangement?: (typeof REBUILD_EDIT_ARRANGEMENTS)[number];
  /** The side the photo sits on, in a media-beside-text section (REV-114) */
  mediaSide?: 'left' | 'right';
  /** `fill` stretches the photo to its column (REV-114) */
  media?: RebuildMediaFit;
}

/** What the model may answer: no free text but CSS that passes the sanitizer */
export interface IRebuildEditAnswer {
  /** Section ids (`s-<index>`) in page order; unlisted sections follow in the original order */
  order?: string[];
  /** Section ids left out */
  hidden?: string[];
  /** Piece ids left out of their section: `s-<i>.t<n>` intro paragraph, `s-<i>.i<n>` item, `s-<i>.x<n>` extra block */
  dropped?: string[];
  /** A photo from a later section (`s-<i>.m<n>`, the n-th image of the read section) shown in the opening section (REV-114) */
  hero?: { photo: string; style: RebuildHeroStyle };
  sections?: Record<string, IRebuildSectionEdit>;
  theme?: {
    font?: (typeof MVP_DESIGN_FONTS)[number];
    density?: (typeof MVP_DESIGN_DENSITIES)[number];
    corners?: (typeof MVP_DESIGN_CORNERS)[number];
    headingCase?: (typeof REBUILD_EDIT_HEADING_CASES)[number];
    typeScale?: (typeof REBUILD_TYPE_SCALES)[number];
  };
  /** Passes the workers' sanitizer (REV-93) */
  customCss?: string;
}

/** The saved edit, with the audit its ids were read from; an edit for another audit is not applied */
export interface IRebuildEdit extends IRebuildEditAnswer {
  auditId: string;
}

/** What the modernize level may decide: the edit's look fields, never order, hiding, dropping or CSS (REV-114) */
export type IRebuildModernizeAnswer = Omit<IRebuildEditAnswer, 'order' | 'hidden' | 'dropped' | 'customCss'>;

/** The modernize design of a rebuilt page, with the audit its ids were read from (REV-114) */
export interface IRebuildModernize {
  auditId: string;
  /** `llm` when the model chose the design, `default` when the code's default stands in */
  source: 'llm' | 'default';
  design: IRebuildModernizeAnswer;
  /** Why the model's design was not used */
  error?: string;
}

// The rebuild plan (REV-110): every decision of the rebuild, validated before it is rendered; never stored

export interface IRebuildImage {
  src: string;
  /** Empty for a decorative image; never invented */
  alt: string;
  width?: number;
  height?: number;
  /** Loaded eagerly (the first section); the rest are lazy */
  eager?: boolean;
}

/** `booking` → #booking; `anchor` → a section on the page */
export interface IRebuildLink {
  label: string;
  href: string;
  kind: 'booking' | 'anchor' | 'phone' | 'email' | 'map';
}

export interface IRebuildItem {
  title?: string;
  subtitle?: string;
  text: string[];
  image?: IRebuildImage;
  /** A photo slide's photo, painted behind its caption (only in a section with `photoSlides`) */
  backgroundImage?: string;
  /** The original alt of a picture moved behind the caption, kept as the slide's text alternative */
  backgroundAlt?: string;
  price?: string;
  rating?: number;
  links: IRebuildLink[];
}

export type IRebuildBlock =
  | { type: 'text'; text: string[] }
  | { type: 'items'; arrangement: SiteSectionArrangement; items: IRebuildItem[] };

export interface IRebuildSection {
  /** Anchor id, `s-<index>` */
  id: string;
  index: number;
  kind: SiteSectionKind;
  arrangement: SiteSectionArrangement;
  columns?: number;
  mediaSide?: 'left' | 'right';
  /** `fill` stretches the photo to its column, up to `mediaMax` px (REV-114) */
  mediaFit?: RebuildMediaFit;
  mediaMax?: number;
  split?: number;
  /** 1 only for the hero's heading */
  headingLevel: 1 | 2;
  /** A hero slider of photos: one full-width slide at a time, each over its own photo */
  photoSlides?: boolean;
  intro: { eyebrow?: string; heading?: string; text: string[]; links: IRebuildLink[] };
  items: IRebuildItem[];
  /** The original item style; `text` is set with a background, readable on it */
  itemStyle?: ISiteItemStyle & { text?: string };
  extra: IRebuildBlock[];
  images: IRebuildImage[];
  embeds: { kind: 'map' | 'video'; src: string; title: string }[];
  /** The booking form renders here, in place of the original form or widget */
  booking: boolean;
  /** A long text section: its body sits in a collapsed <details> */
  collapsed: boolean;
  style: {
    background?: string;
    backgroundImage?: string;
    /** Text color after the contrast fix */
    text: string;
    /** Dark overlay opacity over a background photo, 0..1 */
    overlay?: number;
    align: 'left' | 'center';
    paddingY: number;
    fullBleed: boolean;
  };
}

export interface IRebuildPlan {
  language: string;
  businessName: string;
  /** Set when no hero heading exists: the business name as a visually hidden h1 */
  hiddenH1?: string;
  year: number;
  theme: {
    primary: string;
    /** CTA text color, by contrast with `primary` */
    onPrimary: string;
    pageBackground: string;
    pageText: string;
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    headingUppercase: boolean;
    h1Size: number;
    h2Size: number;
    bodySize: number;
    lineHeight: number;
    buttonRadius: number;
    buttonUppercase: boolean;
  };
  header: {
    logo?: IRebuildImage;
    nav: { label: string; href: string }[];
    cta: { label: string };
    phone?: string;
  };
  sections: IRebuildSection[];
  /** No form or widget was replaced: the booking form goes just before the footer */
  bookingAppended: boolean;
  /** Options of the booking form's service select: titles of the original's services sections */
  bookingServices: string[];
  footer: {
    /** The original footer, when read */
    section?: IRebuildSection;
    contacts: { phone?: string; email?: string; address?: string; workingHours?: string };
    social: { label: string; href: string }[];
  };
  summary: IMvpRebuildSummary;
  /** The operator's CSS (REV-111), already through the sanitizer */
  customCss?: string;
}

export interface IBentoTemplateData {
  businessName: string;
  /** Page layout; the original Bento layout when absent (REV-54) */
  layout?: BentoLayoutVariant;
  /** The operator's custom design (REV-92); the template's own look when absent */
  design?: IMvpDesign;
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
  'MVP_LAYOUT_CHANGE_NOT_ALLOWED',
  'MVP_PALETTE_CHANGE_NOT_ALLOWED',
  'MVP_EDIT_NOT_ALLOWED',
  'MVP_EDIT_FAILED',
  'MVP_EDIT_TIMEOUT',
  'MVP_REBUILD_UNAVAILABLE',
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
