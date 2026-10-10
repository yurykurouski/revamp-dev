import { z } from 'zod';
import {
  DISCOVERY_MAX_EXCLUDED_DOMAINS,
  DiscoveryCandidateStatus,
  LLM_PROVIDER_IDS,
  MVP_DESIGN_BLOCK_IDS,
  MVP_DESIGN_BLOCK_STYLES,
  MVP_DESIGN_BLOCK_TYPES,
  MVP_DESIGN_CORNERS,
  MVP_DESIGN_DENSITIES,
  MVP_DESIGN_ELEMENTS,
  MVP_DESIGN_FONTS,
  MVP_DESIGN_HEADER_LAYOUTS,
  MVP_DESIGN_HERO_IMAGE_SIDES,
  MVP_DESIGN_HERO_PARTS,
  MVP_DESIGN_HERO_STYLES,
  MVP_DESIGN_HIDEABLE,
  MVP_DESIGN_SECTIONS,
  MVP_DESIGN_TOKENS,
  MVP_LAYOUT_MANUAL_REASON,
  MVP_LAYOUT_MODERNIZE_REASONS,
  BENTO_LAYOUT_VARIANTS,
  MVP_LAYOUT_VARIANTS,
  REBUILD_OMISSIONS,
  RebuildChangeKind,
  RebuildChangeSource,
  REBUILD_EDIT_ALIGNS,
  REBUILD_EDIT_ARRANGEMENTS,
  REBUILD_EDIT_BACKGROUNDS,
  REBUILD_EDIT_HEADING_CASES,
  REBUILD_HERO_STYLES,
  REBUILD_LEVELS,
  STANDARDS_CHECKS,
  STANDARDS_POINTS,
  REBUILD_MEDIA_FITS,
  REBUILD_TYPE_SCALES,
  RebuildLevel,
  SITE_DATED_SIGNS,
  IRebuildEditAnswer,
  RebuildUnavailableReason,
  SiteGroupingFailure,
  MODERNIZE_FAILURES,
  REBUILD_UNAVAILABLE_REASONS,
  ISiteLink,
  ISiteSection,
  ISiteSectionItem,
  ISiteSections,
  MvpDesignElement,
  MvpLayoutVariant,
  SITE_ASSESSMENT_FAILURES,
  SITE_ASSESSMENT_VERDICTS,
  SITE_BAD_SIGNS,
  SITE_COMPLEXITY_CLASSES,
  SITE_COMPLEXITY_SIGNS,
  SITE_HERO_MEDIA,
  SITE_HERO_TONES,
  SITE_EMBED_KINDS,
  SITE_IMAGE_SHAPES,
  SITE_LINK_KINDS,
  SITE_SECTION_ARRANGEMENTS,
  SITE_SECTION_KINDS,
  SITE_SECTION_ROLES,
  SITE_SKIP_REASONS,
  SITE_SECTIONS_SOURCES,
  SITE_VERDICT_REASONS,
  findLlmProvider,
  MVP_BRIEF_LIMITS,
  MVP_GROUNDING_KINDS,
  MVP_PAGE_FAILURES,
  MVP_PAGE_VERSION_KINDS,
  MVP_FONT_CHOICES,
  MVP_MIN_CONTRAST,
  MVP_PLACEHOLDERS,
} from '@revamp/shared-types';

export * from './lead-status.js';

// ==============================================================================
// In-App Autonomous AI Agents Schemas (from AGENTS.md)
// ==============================================================================

/**
 * 1. Design & UX Critique Agent Output Schema
 */
export const DesignCritiqueOutputSchema = z.object({
  visualHierarchyRating: z.number().min(0).max(100),
  mobileFriendlinessRating: z.number().min(0).max(100),
  primaryCtaFound: z.boolean(),
  datedDesignFactors: z.array(z.string()).max(5),
  criticalFlaws: z
    .array(
      z.object({
        title: z.string().max(80),
        impact: z.string().max(200),
        recommendation: z.string().max(200),
      }),
    )
    .length(3),
  quickWins: z.array(z.string().max(150)).length(3),
});

export type DesignCritiqueOutput = z.infer<typeof DesignCritiqueOutputSchema>;

/**
 * 2. MVP Content & Copywriting Agent Output Schema
 */
export const MvpContentOutputSchema = z.object({
  hero: z.object({
    badge: z.string().max(40),
    headline: z.string().max(90),
    subheadline: z.string().max(180),
    primaryCtaText: z.string().max(35),
    secondaryCtaText: z.string().max(35),
  }),
  about: z
    .object({
      heading: z.string().max(80),
      body: z.string().max(700),
    })
    .optional(),
  servicesHeading: z.string().max(80).optional(),
  services: z
    .array(
      z.object({
        title: z.string().max(50),
        description: z.string().max(120),
        lucideIconName: z.string(),
      }),
    )
    .min(1)
    .max(6),
  // Only metrics stated on the original site; may be empty (Strict Grounding)
  trustSignals: z
    .array(
      z.object({
        metric: z.string().max(20), // e.g. "12 years", "4.9"
        label: z.string().max(50),  // e.g. "in business", "map rating"
      }),
    )
    .max(3),
  offerNotice: z.string().max(100),
});

export type MvpContentOutput = z.infer<typeof MvpContentOutputSchema>;

/**
 * 3. Cold Outreach Personalizer Agent Output Schema
 */
export const EmailDraftOutputSchema = z.object({
  subject: z.string().max(80),
  previewText: z.string().max(100),
  bodyHtml: z.string(),
  bodyPlainText: z.string(),
});

export type EmailDraftOutput = z.infer<typeof EmailDraftOutputSchema>;

// ==============================================================================
// API Request DTO Schemas
// ==============================================================================

export const NicheEnumSchema = z.enum([
  'dental',
  'auto',
  'legal',
  'beauty',
  'construction',
  'medical',
  'restaurant',
  'fitness',
  'real_estate',
  'other',
]);

/**
 * Schema for POST /api/v1/leads
 */
export const CreateLeadSchema = z.object({
  businessName: z.string().min(2).max(100),
  originalUrl: z.preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!/^https?:\/\//i.test(trimmed) && trimmed.includes('.')) {
        return `https://${trimmed}`;
      }
      return trimmed;
    }
    return val;
  }, z.string().url()),
  // Optional: without one the audit takes the email published on the site; none is invented (REV-45)
  contactEmail: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().email().optional()),
  niche: NicheEnumSchema.default('other'),
  city: z.string().max(100).optional(),
  contactPhone: z.string().max(30).optional(),
  ownerName: z.string().max(100).optional(),
});

// ==============================================================================
// Site complexity (REV-38)
// ==============================================================================

export const SiteComplexityClassSchema = z.enum(SITE_COMPLEXITY_CLASSES);

export const SiteComplexitySignalsSchema = z.object({
  internalPageCount: z.number().int().min(0),
  internalPages: z.array(z.string().max(300)).max(20),
  hasEcommerce: z.boolean(),
  hasBooking: z.boolean(),
  hasLogin: z.boolean(),
  hasSearch: z.boolean(),
  hasAppShell: z.boolean(),
  sectionCount: z.number().int().min(0),
  pageHeight: z.number().min(0),
});

export const SiteComplexitySchema = z.object({
  class: SiteComplexityClassSchema,
  signals: SiteComplexitySignalsSchema.optional(),
  reasons: z.array(z.string().max(100)).max(20),
});

export type SiteComplexityDto = z.infer<typeof SiteComplexitySchema>;

// ==============================================================================
// Original site layout (REV-104)
// ==============================================================================

/** Most sections a home page layout keeps; longer pages are cut, the order of the rest is enough */
export const SITE_LAYOUT_MAX_SECTIONS = 20;

/** Score at which a site counts as dated (REV-114) */
export const SITE_DATED_THRESHOLD = 3;
/** A hero banner needs a photo at least this wide, in px (REV-114) */
export const REBUILD_BANNER_MIN_WIDTH = 1000;

export const SiteEraSchema = z
  .object({
    dated: z.boolean(),
    score: z.number().min(0),
    signs: z.array(z.enum(SITE_DATED_SIGNS)).max(SITE_DATED_SIGNS.length),
    contentWidth: z.number().min(0).optional(),
  })
  .strict();

/**
 * The original home page's layout as the audit read it from the DOM: its sections in page order, the
 * first screen's arrangement, the header and the white space. Every value comes from code, never a model.
 */
export const SiteLayoutSchema = z.object({
  sections: z
    .array(
      z.object({
        kind: z.enum(SITE_SECTION_KINDS),
        heading: z.string().max(100).optional(),
      }),
    )
    .max(SITE_LAYOUT_MAX_SECTIONS),
  hero: z.object({
    media: z.enum(SITE_HERO_MEDIA),
    mediaSide: z.enum(['left', 'right']).optional(),
    align: z.enum(['left', 'center']),
    tone: z.enum(SITE_HERO_TONES),
  }),
  nav: z.object({
    itemCount: z.number().int().min(0).max(100),
    centeredLogo: z.boolean(),
    sticky: z.boolean(),
    hasCta: z.boolean(),
  }),
  density: z.enum(MVP_DESIGN_DENSITIES),
});

export type SiteLayoutDto = z.infer<typeof SiteLayoutSchema>;

// ==============================================================================
// Original site sections (REV-109)
// ==============================================================================

/** Caps on what the section reader keeps; a cut sets `truncated` on the section */
export const SITE_SECTIONS_LIMITS = {
  sections: 45,
  items: 60,
  textChars: 2000,
  uncaptured: 12,
  sampleChars: 120,
  labelChars: 300,
  urlChars: 2000,
  textsPerArray: 40,
  links: 40,
  images: 24,
  embeds: 8,
  extra: 20,
  skipped: 80,
  /** All text in the result; keeps the audit document far below MongoDB's 16 MB */
  totalChars: 150_000,
} as const;

/** The page outline the vision model groups (REV-113) */
export const OUTLINE_LIMITS = { pieces: 600, sections: 40, items: 60, previewChars: 160 } as const;

const pieceId = z.number().int().min(1).max(OUTLINE_LIMITS.pieces);
const pieceIds = z.array(pieceId).max(OUTLINE_LIMITS.pieces);

/**
 * The vision model's grouping of the page (REV-113): references to outline pieces only. There is no
 * string field, and unknown keys are stripped, so no model-written text can reach the stored reading.
 */
export const SiteGroupingAnswerSchema = z.object({
  header: z.object({ logo: pieceId.optional(), pieces: pieceIds }).optional(),
  sections: z
    .array(
      z.object({
        heading: pieceId,
        eyebrow: pieceId.optional(),
        pieces: pieceIds,
        items: z.array(z.object({ title: pieceId.optional(), pieces: pieceIds })).max(OUTLINE_LIMITS.items).optional(),
        kind: z.enum(SITE_SECTION_KINDS),
        arrangement: z.enum(SITE_SECTION_ARRANGEMENTS),
      }),
    )
    .min(1)
    .max(OUTLINE_LIMITS.sections),
  footer: z.object({ pieces: pieceIds }).optional(),
});
export type SiteGroupingAnswer = z.infer<typeof SiteGroupingAnswerSchema>;

const SL = SITE_SECTIONS_LIMITS;
const siteHex = z.string().regex(/^#[0-9a-f]{6}$/i);
const siteUrl = z.string().max(SL.urlChars).regex(/^https?:\/\//i);
const siteHref = z.string().max(SL.urlChars).regex(/^(https?:|tel:|mailto:|sms:)/i);
const siteLabel = z.string().min(1).max(SL.labelChars);
const siteTexts = z.array(z.string().min(1).max(SL.textChars)).max(SL.textsPerArray);
const siteAlign = z.enum(['left', 'center']);

const SiteImageSchema = z.object({
  src: siteUrl,
  alt: z.string().max(SL.labelChars).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
});

const SiteLinksSchema = z.array(z.object({ label: siteLabel, href: siteHref, kind: z.enum(SITE_LINK_KINDS) })).max(SL.links);

const SiteSectionItemSchema = z.object({
  title: siteLabel.optional(),
  subtitle: siteLabel.optional(),
  text: siteTexts,
  image: SiteImageSchema.optional(),
  backgroundImage: siteUrl.optional(),
  price: siteLabel.optional(),
  rating: z.number().min(0).max(5).optional(),
  links: SiteLinksSchema,
});

const SiteItemsSchema = z.array(SiteSectionItemSchema).max(SL.items);

export const SiteSectionSchema = z.object({
  index: z.number().int().min(0),
  role: z.enum(SITE_SECTION_ROLES),
  kind: z.enum(SITE_SECTION_KINDS),
  arrangement: z.enum(SITE_SECTION_ARRANGEMENTS),
  columns: z.number().int().min(1).max(12).optional(),
  mediaSide: z.enum(['left', 'right']).optional(),
  intro: z.object({
    eyebrow: siteLabel.optional(),
    heading: siteLabel.optional(),
    headingLevel: z.number().int().min(1).max(6).optional(),
    text: siteTexts,
    links: SiteLinksSchema,
  }),
  items: SiteItemsSchema,
  itemStyle: z
    .object({
      background: siteHex.optional(),
      radius: z.number().int().min(0).max(1000).optional(),
      border: z.boolean().optional(),
      shadow: z.boolean().optional(),
      imageShape: z.enum(SITE_IMAGE_SHAPES).optional(),
      align: siteAlign.optional(),
    })
    .optional(),
  extra: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: siteTexts }),
        z.object({ type: z.literal('items'), arrangement: z.enum(SITE_SECTION_ARRANGEMENTS), items: SiteItemsSchema }),
      ]),
    )
    .max(SL.extra),
  images: z.array(SiteImageSchema).max(SL.images),
  embeds: z.array(z.object({ kind: z.enum(SITE_EMBED_KINDS), src: siteUrl.optional() })).max(SL.embeds),
  style: z.object({
    background: siteHex.optional(),
    backgroundImage: siteUrl.optional(),
    textColor: siteHex.optional(),
    align: siteAlign.optional(),
    paddingY: z.number().int().min(0).max(2000).optional(),
    fullBleed: z.boolean().optional(),
    split: z.number().min(0).max(1).optional(),
  }),
  truncated: z.boolean().optional(),
});

const siteFont = {
  family: z.string().min(1).max(100),
  size: z.number().int().min(1).max(200),
  weight: z.number().int().min(100).max(1000),
};

/**
 * The original home page as ordered sections, read from the DOM by code, or grouped by a vision model
 * by id (REV-113); the text is always the page's own. Each
 * section's content, arrangement and measured style, what was left out and why, and how much of the
 * page's text the sections hold.
 */
export const SiteSectionsSchema = z.object({
  sections: z.array(SiteSectionSchema).max(SL.sections),
  typography: z
    .object({
      heading: z.object({ ...siteFont, uppercase: z.boolean(), color: siteHex.optional() }),
      body: z.object({ ...siteFont, lineHeight: z.number().min(0.5).max(5).optional(), color: siteHex.optional() }),
      button: z
        .object({
          radius: z.number().int().min(0).max(1000),
          filled: z.boolean(),
          uppercase: z.boolean(),
          background: siteHex.optional(),
          color: siteHex.optional(),
        })
        .optional(),
    })
    .optional(),
  skipped: z
    .array(
      z.object({
        index: z.number().int().min(0),
        reason: z.enum(SITE_SKIP_REASONS),
        heading: siteLabel.optional(),
        sample: z.string().max(SL.sampleChars),
      }),
    )
    .max(SL.skipped),
  coverage: z.object({
    pageChars: z.number().int().min(0),
    capturedChars: z.number().int().min(0),
    ratio: z.number().min(0).max(1),
    uncaptured: z.array(z.string().min(1).max(SL.sampleChars)).max(SL.uncaptured),
  }),
  source: z.enum(SITE_SECTIONS_SOURCES).optional(),
});

export type SiteSectionsDto = z.infer<typeof SiteSectionsSchema>;

/** Query-string value: an empty parameter counts as missing */
const optionalQueryParam = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === '' ? undefined : val), schema.optional());

/**
 * Schema for GET /api/v1/leads
 */
export const GetLeadsQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(100)),
  status: optionalQueryParam(z.string().max(40)),
  niche: optionalQueryParam(z.string().max(40)),
  search: optionalQueryParam(z.string().max(100)),
  complexity: optionalQueryParam(SiteComplexityClassSchema),
});

export type GetLeadsQueryDto = z.infer<typeof GetLeadsQuerySchema>;

export const QuickAddLeadSchema = z.object({
  url: z.preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!/^https?:\/\//i.test(trimmed) && trimmed.includes('.')) {
        return `https://${trimmed}`;
      }
      return trimmed;
    }
    return val;
  }, z.string().url('Enter a valid website URL (e.g. https://example.com)')),
  niche: NicheEnumSchema.default('other'),
  businessName: z.string().min(2).max(100).optional(),
  contactEmail: z.string().email('Invalid email address').optional().or(z.literal('')),
});

export type QuickAddLeadInput = z.infer<typeof QuickAddLeadSchema>;

export type CreateLeadDto = z.infer<typeof CreateLeadSchema>;

/**
 * Schema for POST /api/v1/discovery (REV-26)
 */
export const DiscoveryProviderSchema = z.enum(['osm', 'google']);

export const StartDiscoverySchema = z
  .object({
    provider: DiscoveryProviderSchema.default('osm'),
    niche: NicheEnumSchema.default('other'),
    location: z.string().trim().min(2).max(100),
    keyword: z.string().trim().min(2).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    // Businesses earlier searches already checked (REV-107), as the domains discovery normalised
    excludeDomains: z
      .array(z.string().trim().toLowerCase().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z0-9-]+$/, 'Invalid domain'))
      .max(DISCOVERY_MAX_EXCLUDED_DOMAINS)
      .transform((domains) => [...new Set(domains)])
      .optional(),
  })
  .refine((data) => data.niche !== 'other' || Boolean(data.keyword), {
    message: 'A keyword is required when niche is "other"',
    path: ['keyword'],
  });

export type StartDiscoveryDto = z.infer<typeof StartDiscoverySchema>;
export type StartDiscoveryInput = z.input<typeof StartDiscoverySchema>;

/**
 * Schema for POST /api/v1/discovery/:jobId/import (REV-29)
 */
export const ImportDiscoverySchema = z.object({
  externalIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'externalIds must be unique' }),
});

export type ImportDiscoveryDto = z.infer<typeof ImportDiscoverySchema>;

/** Query-string coordinate: empty values count as missing rather than coercing to 0 */
const coordinate = (min: number, max: number) =>
  z.preprocess((val) => (val === '' ? undefined : val), z.coerce.number().min(min).max(max));

/**
 * Schema for GET /api/v1/discovery/reverse-geocode (REV-28)
 */
export const ReverseGeocodeQuerySchema = z.object({
  lat: coordinate(-90, 90),
  lng: coordinate(-180, 180),
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i)
    .optional(),
});

export type ReverseGeocodeQuery = z.infer<typeof ReverseGeocodeQuerySchema>;

/**
 * A business listing normalised from a maps provider; validated before it becomes a lead
 */
export const DiscoveredBusinessSchema = z.object({
  provider: DiscoveryProviderSchema,
  externalId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  website: z.string().url().regex(/^https?:\/\//i).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export type DiscoveredBusinessDto = z.infer<typeof DiscoveredBusinessSchema>;

/**
 * Pre-assessment of a discovered site (REV-98): either a verdict with the signs that produced it,
 * or the reason no verdict could be given. Signs are unique and the verdict is never invented for
 * a site that was not reached.
 */
const uniqueList = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((list) => new Set(list).size === list.length, { message: 'Signs must be unique' });

export const SiteAssessmentSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('assessed'),
    verdict: z.enum(SITE_ASSESSMENT_VERDICTS),
    verdictReason: z.enum(SITE_VERDICT_REASONS),
    signScore: z.number().int().min(0),
    signScoreNeeded: z.number().int().min(1).optional(),
    simple: z.boolean(),
    badSigns: uniqueList(z.enum(SITE_BAD_SIGNS), SITE_BAD_SIGNS.length),
    complexitySigns: uniqueList(z.enum(SITE_COMPLEXITY_SIGNS), SITE_COMPLEXITY_SIGNS.length),
    internalPages: z.number().int().min(0),
    finalUrl: z.string().url().regex(/^https?:\/\//i),
    httpStatus: z.number().int().min(100).max(599),
    responseMs: z.number().int().min(0),
    htmlBytes: z.number().int().min(0),
    copyrightYear: z.number().int().min(1990).max(2100).optional(),
    assessedAt: z.string().datetime(),
  }),
  z.object({
    outcome: z.literal('failed'),
    failure: z.enum(SITE_ASSESSMENT_FAILURES),
    httpStatus: z.number().int().min(100).max(599).optional(),
    assessedAt: z.string().datetime(),
  }),
]);

export type SiteAssessmentDto = z.infer<typeof SiteAssessmentSchema>;

/**
 * Schema for POST /api/v1/audits/trigger
 */
export const TriggerAuditSchema = z.object({
  leadId: z.string().min(1),
  force: z.boolean().optional().default(false),
});

export type TriggerAuditDto = z.infer<typeof TriggerAuditSchema>;

/**
 * Schema for POST /api/v1/mvp/generate
 */
export const LlmProviderSchema = z.enum(LLM_PROVIDER_IDS);

/**
 * Provider/model picked by the operator for one MVP run (REV-32). Both are optional; a model
 * needs its provider and must be one of that provider's models.
 */
export const GenerateMvpSchema = z
  .object({
    auditId: z.string().min(1),
    forceRegenerate: z.boolean().optional().default(false),
    provider: LlmProviderSchema.optional(),
    model: z.string().trim().min(1).max(100).optional(),
    /** A Bento layout the operator picked for this run, e.g. when the rebuild cannot be made (REV-132) */
    layout: z.enum(BENTO_LAYOUT_VARIANTS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.model === undefined) return;
    if (!value.provider) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'A model needs a provider' });
      return;
    }
    const provider = findLlmProvider(value.provider);
    if (!provider?.models.some((m) => m.id === value.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: `Model "${value.model}" is not available for provider "${value.provider}"`,
      });
    }
  });

export type GenerateMvpDto = z.infer<typeof GenerateMvpSchema>;

/**
 * MVP completeness report (REV-36): the generated page compared with the original site's data.
 * The workers validate the report before saving it on the MvpProject.
 */
export const CompletenessTierSchema = z.enum(['critical', 'important', 'informational']);
export const CompletenessStatusSchema = z.enum(['present', 'missing', 'altered', 'not_in_source', 'unsourced']);
export const CompletenessFieldSchema = z.enum([
  'businessName',
  'phone',
  'email',
  'address',
  'workingHours',
  'services',
  'socialLinks',
  'logo',
  'images',
  'testimonials',
  'rating',
  'foundingYear',
]);

export const CompletenessCheckSchema = z.object({
  field: CompletenessFieldSchema,
  tier: CompletenessTierSchema,
  status: CompletenessStatusSchema,
  originalValue: z.string().max(500).optional(),
  mvpValue: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
  judgedBy: z.enum(['llm', 'code']).optional(),
});

export const MvpCompletenessReportSchema = z.object({
  status: z.enum(['verified', 'unverified']),
  score: z.number().min(0).max(100).optional(),
  hasCriticalIssues: z.boolean(),
  checks: z.array(CompletenessCheckSchema).max(50),
  checkedAt: z.union([z.string(), z.date()]),
  error: z.string().max(500).optional(),
  method: z.enum(['llm', 'deterministic']).optional(),
  model: z.string().max(100).optional(),
  llmError: z.string().max(500).optional(),
});

/**
 * What the LLM completeness judge returns (REV-37). Every verdict that claims the MVP shows
 * something carries a verbatim quote from the MVP, which code verifies before accepting it.
 * The LLM never scores: the score is computed in code.
 */
/** Models often send "" or null for "no quote": that means absent, not an invalid answer */
const optionalJudgeText = (max: number) =>
  z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    z.string().trim().max(max).optional(),
  );

export const CompletenessJudgeOutputSchema = z.object({
  fields: z
    .array(
      z.object({
        field: CompletenessFieldSchema,
        status: z.enum(['present', 'missing', 'altered']),
        mvpQuote: optionalJudgeText(300),
        reason: optionalJudgeText(300),
        /** Services and social links are judged one by one */
        items: z
          .array(
            z.object({
              value: z.string().min(1).max(300),
              found: z.boolean(),
              mvpQuote: optionalJudgeText(300),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .max(20),
  // Entries without a quote can't be verified, so they're dropped rather than failing the answer
  unsourced: z
    .array(
      z.object({
        field: z.enum(['phone', 'email', 'address']),
        mvpQuote: optionalJudgeText(300),
      }),
    )
    .max(20)
    .default([])
    .transform((items) =>
      items.filter((i): i is { field: 'phone' | 'email' | 'address'; mvpQuote: string } => Boolean(i.mvpQuote)),
    ),
});

export type CompletenessJudgeOutput = z.infer<typeof CompletenessJudgeOutputSchema>;

export type CompletenessCheckDto = z.infer<typeof CompletenessCheckSchema>;
export type MvpCompletenessReportDto = z.infer<typeof MvpCompletenessReportSchema>;

/** Statuses that count as a problem for a critical field */
const COMPLETENESS_PROBLEM_STATUSES = ['missing', 'altered', 'unsourced'];

/** Critical fields the MVP lost, changed or made up, without duplicates */
export function criticalCompletenessIssues(
  checks: ReadonlyArray<{ field: string; tier: string; status: string }> | undefined | null,
): string[] {
  const fields = (checks || [])
    .filter((c) => c.tier === 'critical' && COMPLETENESS_PROBLEM_STATUSES.includes(c.status))
    .map((c) => c.field);
  return [...new Set(fields)];
}

/** The report reduced to what the Kanban card needs; undefined when there is no report */
export function summarizeCompletenessReport(
  report: Pick<MvpCompletenessReportDto, 'status' | 'score' | 'checks'> | undefined | null,
) {
  if (!report) return undefined;
  const criticalIssues = criticalCompletenessIssues(report.checks);
  return {
    status: report.status,
    score: report.score,
    hasCriticalIssues: criticalIssues.length > 0,
    criticalIssues,
  };
}


/**
 * Schema for POST /api/v1/outreach/:id/approve (HITL Gate)
 */
export const ApproveOutreachSchema = z.object({
  scheduleTime: z.string().datetime().optional(),
  approvedBy: z.string().default('operator'),
  // The exact draft the operator reviewed; nothing is sent without it (REV-61)
  subject: z.string().trim().min(1).max(300),
  preheader: z.string().max(300).optional(),
  body: z.string().trim().min(1).max(20000),
});

export type ApproveOutreachDto = z.infer<typeof ApproveOutreachSchema>;

/**
 * Schema for POST /api/v1/outreach/:id/reject
 */
export const RejectOutreachSchema = z.object({
  reason: z.string().min(3).max(200),
});

export type RejectOutreachDto = z.infer<typeof RejectOutreachSchema>;

/**
 * Schema for POST /api/v1/outreach/:id/test
 */
export const TestEmailOutreachSchema = z.object({
  testEmail: z.string().email(),
  // The draft as the operator currently sees it, with its variables substituted (REV-60)
  subject: z.string().trim().min(1).max(300),
  preheader: z.string().max(300).optional(),
  body: z.string().trim().min(1).max(20000),
});

export type TestEmailOutreachDto = z.infer<typeof TestEmailOutreachSchema>;

/**
 * 4. Bento Template Schemas (REV-11)
 */
export const BentoReviewItemSchema = z.object({
  author: z.string().min(1).max(60),
  rating: z.number().min(1).max(5).optional(),
  comment: z.string().min(5).max(300),
  date: z.string().max(50).optional(),
  source: z.enum(['Google Maps', 'Yandex Maps', '2GIS', 'Website', 'Direct']).optional(),
});

export type BentoReviewItem = z.infer<typeof BentoReviewItemSchema>;

export const BentoServiceCardSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  lucideIconName: z.string().optional(),
  badge: z.string().max(30).optional(),
  highlight: z.boolean().optional(),
});

export type BentoServiceCard = z.infer<typeof BentoServiceCardSchema>;

/** Only http(s) links may be rendered into a published MVP (z.string().url() also accepts javascript:) */
const HttpUrlSchema = z
  .string()
  .url()
  .regex(/^https?:\/\//i, 'Only http(s) URLs are allowed');

// Layout variants of the generated MVP (REV-54)
export const MvpLayoutVariantSchema = z.enum(MVP_LAYOUT_VARIANTS);

export const BentoLayoutVariantSchema = z.enum(BENTO_LAYOUT_VARIANTS);

/** Codes that describe one render (REV-110), not the audit; a new pick starts without them */
const isRenderOutcome = (reason: string) =>
  reason.startsWith('rule:') ||
  reason.startsWith('rebuild:') ||
  reason.startsWith('coverage:') ||
  reason.startsWith('flat:') ||
  reason.startsWith('manual:') ||
  reason.startsWith('dated:') ||
  reason.startsWith('modernize:');

export const MvpLayoutSelectionSchema = z.object({
  variant: MvpLayoutVariantSchema,
  reasons: z.array(z.string().min(1).max(60)).max(12),
  /** The look derived from the original site's layout (REV-104); defined below, hence lazy */
  design: z.lazy(() => MvpDesignSchema).optional(),
  /** How the rebuild was rendered (REV-114) */
  rebuildLevel: z.enum(REBUILD_LEVELS).optional(),
});

export type MvpLayoutSelection = z.infer<typeof MvpLayoutSelectionSchema>;

/**
 * The layout the operator picked instead of the automatic one (REV-84). The audit facts behind the
 * previous choice and the look derived from the original site (REV-104) are kept; the rule becomes the
 * operator's.
 */
export function manualMvpLayout(
  previous: { reasons?: string[] | null; design?: unknown; rebuildLevel?: RebuildLevel | null } | null | undefined,
  variant: MvpLayoutVariant,
  level?: RebuildLevel,
): MvpLayoutSelection {
  const facts = (previous?.reasons ?? []).filter((reason) => !isRenderOutcome(reason));
  // The level belongs to the rebuild: only the original layout has one
  const rebuildLevel = variant === 'original' ? (level ?? previous?.rebuildLevel ?? undefined) : undefined;
  const levelPicked = level !== undefined || (previous?.reasons ?? []).includes(MVP_LAYOUT_MODERNIZE_REASONS.manual);
  return MvpLayoutSelectionSchema.parse({
    variant,
    reasons: [MVP_LAYOUT_MANUAL_REASON, ...(levelPicked && rebuildLevel ? [MVP_LAYOUT_MODERNIZE_REASONS.manual] : []), ...facts].slice(0, 12),
    ...(previous?.design ? { design: previous.design } : {}),
    ...(rebuildLevel ? { rebuildLevel } : {}),
  });
}

/**
 * Schema for PATCH /api/v1/mvp/:id/layout: the layout the operator picked for the MVP (REV-84)
 */
export const UpdateMvpLayoutSchema = z
  .object({
    variant: MvpLayoutVariantSchema,
    /** The rebuild's level (REV-114); only for the `original` layout */
    level: z.enum(REBUILD_LEVELS).optional(),
  })
  .refine((dto) => dto.level === undefined || dto.variant === 'original', {
    message: 'A rebuild level only applies to the original layout',
    path: ['level'],
  });

export type UpdateMvpLayoutDto = z.infer<typeof UpdateMvpLayoutSchema>;

/** Longest free-text change the operator can ask for (REV-85) */
export const MVP_EDIT_INSTRUCTION_MAX = 500;

/**
 * Schema for POST /api/v1/mvp/:id/edit: the operator's own description of a change to the MVP (REV-85)
 */
export const EditMvpSchema = z.object({
  instruction: z.string().trim().min(3).max(MVP_EDIT_INSTRUCTION_MAX),
});

export type EditMvpDto = z.infer<typeof EditMvpSchema>;

/** Longest custom CSS an MVP design may carry (REV-93) */
export const MVP_CUSTOM_CSS_MAX = 4096;

/** Whether a list names each value at most once */
const uniqueItems = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((values) => new Set(values).size === values.length, { message: 'Each value may appear only once' });

const tokenEnum = <K extends keyof typeof MVP_DESIGN_TOKENS>(key: K) =>
  z.enum(MVP_DESIGN_TOKENS[key] as unknown as [string, ...string[]]) as z.ZodEnum<
    [(typeof MVP_DESIGN_TOKENS)[K][number], ...(typeof MVP_DESIGN_TOKENS)[K][number][]]
  >;

export const MvpDesignElementStyleSchema = z.object({
  size: tokenEnum('size').optional(),
  weight: tokenEnum('weight').optional(),
  align: tokenEnum('align').optional(),
  transform: tokenEnum('transform').optional(),
  tracking: tokenEnum('tracking').optional(),
  color: tokenEnum('color').optional(),
  background: tokenEnum('background').optional(),
  radius: tokenEnum('radius').optional(),
  shadow: tokenEnum('shadow').optional(),
  border: tokenEnum('border').optional(),
});

export const MvpDesignBlockSchema = z
  .object({
    id: z.enum(MVP_DESIGN_BLOCK_IDS),
    type: z.enum(MVP_DESIGN_BLOCK_TYPES),
    style: z.enum(MVP_DESIGN_BLOCK_STYLES).optional(),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().max(280).optional(),
    items: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(50),
          text: z.string().trim().max(140).optional(),
          icon: z.string().max(40).optional(),
        }),
      )
      .max(4)
      .optional(),
    buttonText: z.string().trim().min(1).max(35).optional(),
  })
  .superRefine((block, ctx) => {
    if (block.type === 'features' && !block.items?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'A features block needs 1-4 items' });
    }
    if (block.type === 'cta' && !block.buttonText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buttonText'], message: 'A CTA block needs its button text' });
    }
  });

/**
 * An MVP's custom design (REV-92): section order and hiding, the hero's arrangement, element styles from
 * fixed tokens, the overall look and up to three custom blocks. The template applies it deterministically;
 * the hero, the booking form and the verified contacts cannot be hidden, since none of them has a name here.
 */
export const MvpDesignSchema = z
  .object({
    sectionOrder: uniqueItems(z.enum([...MVP_DESIGN_SECTIONS, ...MVP_DESIGN_BLOCK_IDS]), 7).optional(),
    hidden: uniqueItems(z.enum(MVP_DESIGN_HIDEABLE), MVP_DESIGN_HIDEABLE.length).optional(),
    hero: z
      .object({
        align: z.enum(['left', 'center']).optional(),
        order: uniqueItems(z.enum(MVP_DESIGN_HERO_PARTS), MVP_DESIGN_HERO_PARTS.length).optional(),
        imageSide: z.enum(MVP_DESIGN_HERO_IMAGE_SIDES).optional(),
      })
      .optional(),
    header: z
      .object({
        layout: z.enum(MVP_DESIGN_HEADER_LAYOUTS).optional(),
        links: z.boolean().optional(),
      })
      .optional(),
    theme: z
      .object({
        font: z.enum(MVP_DESIGN_FONTS).optional(),
        density: z.enum(MVP_DESIGN_DENSITIES).optional(),
        corners: z.enum(MVP_DESIGN_CORNERS).optional(),
        heroStyle: z.enum(MVP_DESIGN_HERO_STYLES).optional(),
      })
      .optional(),
    elements: z
      .object(
        Object.fromEntries(MVP_DESIGN_ELEMENTS.map((element) => [element, MvpDesignElementStyleSchema.optional()])) as Record<
          MvpDesignElement,
          z.ZodOptional<typeof MvpDesignElementStyleSchema>
        >,
      )
      .optional(),
    blocks: z.array(MvpDesignBlockSchema).max(3).optional(),
    /** Fallback CSS (REV-93); its content is checked by the workers' sanitizer, not by this schema */
    customCss: z.string().max(MVP_CUSTOM_CSS_MAX).optional(),
  })
  .superRefine((design, ctx) => {
    const ids = (design.blocks ?? []).map((block) => block.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'Each block id may be used once' });
    }
  });

export type MvpDesign = z.infer<typeof MvpDesignSchema>;

/**
 * 5. MVP Edit Agent Output Schema (REV-85): how the model applies an operator's free-text change. Every
 * field but the summary is optional; null or absent leaves that part of the MVP as it is. The copy is the
 * whole revised copy, so it is validated like freshly generated copy.
 */
export const MvpEditOutputSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  content: MvpContentOutputSchema.nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[A-Fa-f0-9]{6}$/)
    .nullable()
    .optional(),
  layout: MvpLayoutVariantSchema.nullable().optional(),
  /** The whole new custom design (REV-92); an empty object drops it */
  design: MvpDesignSchema.nullable().optional(),
});

export type MvpEditOutput = z.infer<typeof MvpEditOutputSchema>;

const seoHttp = z.string().max(2000).regex(/^https?:\/\//i, 'Only http(s) URLs are allowed');
/** An MVP's search and sharing tags (REV-118); every value is copied from the audit's verified data */
export const MvpSeoSchema = z.object({
  description: z.string().min(1).max(160).optional(),
  image: seoHttp.optional(),
  locale: z.string().regex(/^[a-z]{2,3}_[A-Z]{2}$/).optional(),
  localBusiness: z
    .object({
      name: z.string().min(1).max(300),
      url: seoHttp.optional(),
      telephone: z.string().min(1).max(30).optional(),
      email: z.string().email().max(254).optional(),
      address: z.string().min(1).max(300).optional(),
      image: seoHttp.optional(),
      sameAs: z.array(seoHttp).max(12),
    })
    .optional(),
});

export const BentoTemplateDataSchema = z.object({
  businessName: z.string().min(1).max(100),
  design: MvpDesignSchema.optional(),
  layout: BentoLayoutVariantSchema.optional(),
  language: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i).optional(),
  niche: NicheEnumSchema.optional(),
  logoUrl: HttpUrlSchema.optional(),
  monogramSvg: z.string().optional(),
  palette: z.object({
    primary: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
    secondary: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
    accent: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
  }),
  fontFamilies: z.array(z.string()).optional(),
  contacts: z.object({
    phone: z.string().max(30).optional(),
    email: z.string().email().optional(),
    address: z.string().max(150).optional(),
    workingHours: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
  }),
  hero: z.object({
    badge: z.string().max(50).optional(),
    headline: z.string().min(1).max(120),
    subheadline: z.string().min(1).max(250),
    primaryCtaText: z.string().max(40).optional(),
    secondaryCtaText: z.string().max(40).optional(),
  }),
  services: z.array(BentoServiceCardSchema).min(1).max(10),
  trustSignals: z
    .array(
      z.object({
        metric: z.string().max(25),
        label: z.string().max(60),
      }),
    )
    .optional(),
  reviews: z.array(BentoReviewItemSchema).optional(),
  about: z.object({ heading: z.string().min(1).max(80), body: z.string().min(1).max(900) }).optional(),
  servicesHeading: z.string().max(80).optional(),
  heroImageUrl: HttpUrlSchema.optional(),
  gallery: z.array(HttpUrlSchema).max(8).optional(),
  socialLinks: z.array(z.object({ platform: z.string().max(30), url: HttpUrlSchema })).max(8).optional(),
  footerTagline: z.string().max(300).optional(),
  originalUrl: HttpUrlSchema.optional(),
  trackingToken: z.string().optional(),
  publicApiUrl: HttpUrlSchema.optional(),
  customHeadSnippet: z.string().optional(),
  seo: MvpSeoSchema.optional(),
});

export type BentoTemplateData = z.infer<typeof BentoTemplateDataSchema>;

/**
 * 5. Telemetry & Tracking Schemas (REV-18)
 */
export const MvpTrackEventSchema = z
  .object({
    token: z.string().min(1).optional(),
    trackingToken: z.string().min(1).optional(),
    mvpProjectId: z.string().optional(),
    leadId: z.string().optional(),
    eventType: z.enum([
      'open',
      'click',
      'pageview',
      'dwell_time',
      'cta_click',
      'booking_intent',
      'scroll_depth',
      'token_usage',
    ]),
    dwellTimeSeconds: z.number().nonnegative().optional(),
    scrollDepthPercent: z.number().min(0).max(100).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => Boolean(data.token || data.trackingToken || data.mvpProjectId || data.leadId),
    {
      message: 'One of token, trackingToken, mvpProjectId, or leadId must be provided',
    },
  );

export type MvpTrackEventDto = z.infer<typeof MvpTrackEventSchema>;


// ==============================================================================
// Lead identity: matching discovered businesses to existing leads (REV-35)
// ==============================================================================

/**
 * Canonical domain for a URL or bare host: lowercased, without port, trailing dots or a leading
 * `www.`. Import, discovery and manual lead creation all store and match on this form.
 */
export function normalizeDomain(input?: string | null): string | undefined {
  let value = input?.trim().toLowerCase();
  if (!value) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;

  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return undefined;
  }
  host = host.replace(/\.+$/, '').replace(/^www\./, '');
  return host || undefined;
}

/**
 * E.164 form (`+<country><number>`) of a phone written internationally, e.g. `+375 (29) 123-45-67`
 * or `00375 29 1234567`. National numbers have no country code to go on, so they are not matched.
 */
export function normalizePhone(input?: string | null): string | undefined {
  // Keep the first number of a list and drop any extension
  let value = input?.split(/[;,/]|\b(?:ext|x)\.?\s*\d/i)[0]?.trim().replace(/^tel:/i, '');
  if (!value) return undefined;
  // "+44 (0) 20 ..." carries the national trunk prefix, which E.164 omits
  value = value.replace(/\(0\)/g, '');
  if (!value.startsWith('+') && !value.startsWith('00')) return undefined;
  let digits = value.replace(/\D/g, '');
  if (value.startsWith('00')) digits = digits.slice(2);
  if (!/^[1-9]\d{6,14}$/.test(digits)) return undefined;
  return `+${digits}`;
}

/** Provider-qualified listing id stored on `Lead.externalId`, e.g. `google:ChIJ...` or `osm:node/123` */
export function leadExternalId(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

/** What a discovered business can be matched on, strongest first */
export interface LeadMatchKeys {
  externalId: string;
  domain?: string;
  phoneE164?: string;
}

export function leadMatchKeys(candidate: {
  provider: string;
  externalId: string;
  domain?: string;
  phone?: string;
}): LeadMatchKeys {
  return {
    externalId: leadExternalId(candidate.provider, candidate.externalId),
    domain: normalizeDomain(candidate.domain),
    phoneE164: normalizePhone(candidate.phone),
  };
}

/** The lead fields matching reads; project exactly these in the query */
export interface LeadIdentity {
  _id: unknown;
  externalId?: string | null;
  domain?: string | null;
  phoneE164?: string | null;
}

export const LEAD_IDENTITY_PROJECTION = { externalId: 1, domain: 1, phoneE164: 1 } as const;

/** MongoDB filter for leads that could match any of the keys, or null when there is nothing to look up */
export function leadMatchFilter(keys: LeadMatchKeys[]): Record<string, unknown> | null {
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];
  const clauses = [
    { field: 'externalId', values: unique(keys.map((k) => k.externalId)) },
    { field: 'domain', values: unique(keys.map((k) => k.domain)) },
    { field: 'phoneE164', values: unique(keys.map((k) => k.phoneE164)) },
  ]
    .filter((c) => c.values.length > 0)
    .map((c) => ({ [c.field]: { $in: c.values } }));
  return clauses.length > 0 ? { $or: clauses } : null;
}

/**
 * Returns a lookup from match keys to the id of the lead they belong to: the provider id first,
 * then the domain, then the phone number.
 */
export function createLeadMatcher(leads: LeadIdentity[]): (keys: LeadMatchKeys) => string | undefined {
  const byField = (field: 'externalId' | 'domain' | 'phoneE164') => {
    const map = new Map<string, string>();
    for (const lead of leads) {
      const value = lead[field];
      if (value && !map.has(value)) map.set(value, String(lead._id));
    }
    return map;
  };
  const byExternalId = byField('externalId');
  const byDomain = byField('domain');
  const byPhone = byField('phoneE164');

  return (keys) =>
    byExternalId.get(keys.externalId) ??
    (keys.domain ? byDomain.get(keys.domain) : undefined) ??
    (keys.phoneE164 ? byPhone.get(keys.phoneE164) : undefined);
}

/** Discovery candidates per status, including skipped listings (REV-35) */
export function countCandidatesByStatus(
  candidates: Array<{ status: DiscoveryCandidateStatus }>,
): Record<DiscoveryCandidateStatus, number> {
  const counts: Record<DiscoveryCandidateStatus, number> = {
    new: 0,
    existing_lead: 0,
    duplicate: 0,
    no_website: 0,
    invalid: 0,
  };
  for (const candidate of candidates) counts[candidate.status]++;
  return counts;
}

/**
 * Audit failures (REV-44), shared by the audit worker and the API backfill.
 * Playwright errors carry ANSI colour codes and, after the first line, a call log or the whole
 * browser launch log; the stored reason keeps only the first readable line.
 */
export const MAX_AUDIT_ERROR_LENGTH = 300;

const ANSI_ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

/**
 * Navigation errors that another attempt cannot fix: the domain does not resolve or the site's
 * TLS certificate is invalid. The audit fails at once instead of using up its retries.
 */
const PERMANENT_AUDIT_ERROR = /net::ERR_(NAME_NOT_RESOLVED|CERT_[A-Z_]+|INVALID_URL)\b/;

export function sanitizeAuditError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const firstLine =
    raw
      .replace(ANSI_ESCAPE, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const message = firstLine.replace(/\s+/g, ' ') || 'Failed to complete audit inspection';
  return message.slice(0, MAX_AUDIT_ERROR_LENGTH);
}

export function isPermanentAuditError(message: string): boolean {
  return PERMANENT_AUDIT_ERROR.test(message);
}

// ---------------------------------------------------------------------------------------------
// Section rebuild (REV-110)
// ---------------------------------------------------------------------------------------------

/** Below this share of the original page's text the MVP falls back to the Bento template */
export const REBUILD_MIN_COVERAGE = 0.85;
/**
 * A reading of a page with at least this much text (`coverage.pageChars`) is checked for flatness
 * (REV-112); a short one-screen page may well be a single block
 */
export const REBUILD_FLAT_MIN_PAGE_CHARS = 1500;
/** Above this share of the sections' text in one hero or content section, the reading is flat (REV-112) */
export const REBUILD_MAX_SECTION_SHARE = 0.5;
/** Below this share of hero and content sections with a heading, the reading is flat (REV-112) */
export const REBUILD_MIN_HEADING_SHARE = 0.25;

/**
 * Characters of text a section holds, as the reader's coverage counts them (REV-109). A price inside its
 * item's text, and a link whose label the text already holds (a link inside a paragraph, a card wrapped
 * in a link), are not counted twice. The reader passes `isAttributeLabel` for links labeled by
 * aria-label or title, which are not page text; a stored reading no longer knows them.
 */
export function siteSectionChars(section: ISiteSection, isAttributeLabel: (link: ISiteLink) => boolean = () => false): number {
  const sum = (list: string[]) => list.reduce((total, s) => total + s.length, 0);
  const labels = (links: ISiteLink[], text: string) =>
    sum(links.filter((link) => !isAttributeLabel(link) && !text.includes(link.label)).map((link) => link.label));
  const itemChars = (i: ISiteSectionItem) => {
    const text = [i.title, i.subtitle, ...i.text].filter(Boolean).join(' ');
    return (
      (i.title?.length ?? 0) +
      (i.subtitle?.length ?? 0) +
      sum(i.text) +
      (i.price && !i.text.some((line) => line.includes(i.price!)) ? i.price.length : 0) +
      labels(i.links, text)
    );
  };
  const itemsChars = (items: ISiteSectionItem[]) => items.reduce((total, i) => total + itemChars(i), 0);
  const introText = [
    section.intro.eyebrow,
    section.intro.heading,
    ...section.intro.text,
    ...section.extra.flatMap((e) => (e.type === 'text' ? e.text : [])),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    (section.intro.eyebrow?.length ?? 0) +
    (section.intro.heading?.length ?? 0) +
    sum(section.intro.text) +
    labels(section.intro.links, introText) +
    itemsChars(section.items) +
    section.extra.reduce((total, e) => total + (e.type === 'text' ? sum(e.text) : itemsChars(e.items)), 0)
  );
}

/**
 * Why a reading is too flat to rebuild faithfully (REV-112): on a page with enough text, one hero or
 * content section holds most of the sections' text, or few of them have a heading. Old table layouts
 * read as a few giant blocks, which coverage alone accepts. Undefined when the reading has structure.
 */
function flatReading(read: ISiteSections): string[] | undefined {
  if (read.coverage.pageChars < REBUILD_FLAT_MIN_PAGE_CHARS) return undefined;
  const body = read.sections.filter((section) => section.role === 'hero' || section.role === 'content');
  const total = read.sections.reduce((sum, section) => sum + siteSectionChars(section), 0);
  if (body.length === 0 || total === 0) return undefined;
  const share = Math.round((Math.max(...body.map((section) => siteSectionChars(section))) / total) * 1000) / 1000;
  const headed = body.filter((section) => section.intro.heading).length;
  if (share <= REBUILD_MAX_SECTION_SHARE && headed / body.length >= REBUILD_MIN_HEADING_SHARE) return undefined;
  return [`flat:share=${share}`, `flat:headings=${headed}/${body.length}`];
}

export type RebuildEligibility = { ok: true } | { ok: false; reason: RebuildUnavailableReason; facts: string[] };

/**
 * Whether the audit's sections can be rebuilt (REV-110). The plan and size checks happen at render
 * time; these are the checks the API can make before it accepts a switch to `original`. Only the vision
 * model's grouping is rebuilt (REV-132): its failure is the reason, and a reading the rules made is refused.
 */
export function rebuildEligibility(
  audit:
    | { siteSections?: ISiteSections | null; siteSectionsError?: string | null; siteSectionsErrorReason?: SiteGroupingFailure | null }
    | null
    | undefined,
): RebuildEligibility {
  if (audit?.siteSectionsErrorReason) return { ok: false, reason: `grouping:${audit.siteSectionsErrorReason}`, facts: [] };
  const read = audit?.siteSections;
  if (!read || audit?.siteSectionsError) return { ok: false, reason: 'rebuild:unread', facts: [] };
  // A reading stored before REV-113 has no source; it was made by the rules too
  if (read.source !== 'llm') return { ok: false, reason: 'grouping:rules_reading', facts: [] };
  if (!read.sections.some((section) => section.role === 'hero' || section.role === 'content')) {
    return { ok: false, reason: 'rebuild:no_content', facts: [] };
  }
  if (read.coverage.ratio < REBUILD_MIN_COVERAGE) {
    return { ok: false, reason: 'rebuild:low_coverage', facts: [`coverage:${read.coverage.ratio}`] };
  }
  const flat = flatReading(read);
  if (flat) return { ok: false, reason: 'rebuild:flat', facts: flat };
  return { ok: true };
}

export const REBUILD_SUMMARY_LIMITS = { omitted: 80, tuning: 120 } as const;

export const MvpRebuildSummarySchema = z.object({
  coverage: z.number().min(0).max(1),
  sections: z.number().int().min(0),
  omitted: z
    .array(z.object({ what: z.enum(REBUILD_OMISSIONS), reason: z.string().min(1).max(60), sample: z.string().max(120).optional() }))
    .max(REBUILD_SUMMARY_LIMITS.omitted),
  tuning: z.array(z.string().min(1).max(60)).max(REBUILD_SUMMARY_LIMITS.tuning),
  level: z.enum(REBUILD_LEVELS).optional(),
  // The measured values behind the codes (REV-119)
  facts: z
    .array(
      z.object({
        code: z.string().min(1).max(60),
        section: z.string().min(1).max(120).optional(),
        from: z.union([z.string().max(20), z.number()]).optional(),
        to: z.union([z.string().max(20), z.number()]).optional(),
        background: z.string().max(20).optional(),
        ratioBefore: z.number().min(1).max(21).optional(),
        ratioAfter: z.number().min(1).max(21).optional(),
        value: z.number().min(0).optional(),
        median: z.number().min(0).optional(),
      }),
    )
    .max(REBUILD_SUMMARY_LIMITS.tuning)
    .optional(),
});

/** One tuning code read into its kind (REV-119): the section index, a count or a photo id it names, and its source */
export interface RebuildChange {
  kind: RebuildChangeKind;
  /** Set on the design changes (`style`, `cards`, …): the modernize layer or the operator */
  source?: RebuildChangeSource;
  /** The reader's section index (`s-<index>`) the change is in */
  section?: number;
  /** How many (`alt:<n>`) */
  count?: number;
}

const EXACT_CODES: Record<string, RebuildChangeKind> = {
  'font:body-16': 'font-body',
  'line-height:1.5': 'line-height',
  'h1:hidden': 'h1-hidden',
  'booking:replaced': 'booking-replaced',
  'booking:appended': 'booking-appended',
  'footer:added': 'footer-added',
  'seo:description': 'seo-description',
  'seo:og': 'seo-og',
  'seo:jsonld': 'seo-jsonld',
};
const SECTION_CODE = /^(contrast|overlay|collapse):(\d{1,3})$/;
const SOURCED_SECTION_CODE = /^(modernize|edit):(style|cards|side|fill):(\d{1,3})$/;
const SOURCED_CODE = /^(modernize|edit):(hero-cta|type|theme)$/;
const HERO_PHOTO_CODE = /^(modernize|edit):hero-photo:s-(\d{1,3})\.m\d{1,3}$/;
const EDIT_ONLY_CODE = /^edit:(order|css-dropped)$/;
const WALL_CODE = /^wall:(\d{1,3})$/;

/**
 * The kind of a rebuild tuning code (REV-119), or undefined for a code no kind covers. Every code `planRebuild` records
 * parses; the dashboard explains each kind.
 */
export function parseRebuildChange(code: string): RebuildChange | undefined {
  const exact = EXACT_CODES[code];
  if (exact) return { kind: exact };
  const alt = /^alt:(\d{1,4})$/.exec(code);
  if (alt) return { kind: 'alt', count: Number(alt[1]) };
  const section = SECTION_CODE.exec(code);
  if (section) return { kind: section[1] as RebuildChangeKind, section: Number(section[2]) };
  const sourced = SOURCED_SECTION_CODE.exec(code);
  if (sourced) return { kind: sourced[2] as RebuildChangeKind, source: sourced[1] as RebuildChangeSource, section: Number(sourced[3]) };
  const plain = SOURCED_CODE.exec(code);
  if (plain) return { kind: plain[2] as RebuildChangeKind, source: plain[1] as RebuildChangeSource };
  const photo = HERO_PHOTO_CODE.exec(code);
  if (photo) return { kind: 'hero-photo', source: photo[1] as RebuildChangeSource, section: Number(photo[2]) };
  const edit = EDIT_ONLY_CODE.exec(code);
  if (edit) return { kind: edit[1] as RebuildChangeKind, source: 'edit' };
  const wall = WALL_CODE.exec(code);
  if (wall) return { kind: 'text-wall', section: Number(wall[1]) };
  return undefined;
}

/** Iframe hosts the rebuild may embed (REV-110) */
export const REBUILD_IFRAME_HOSTS = [
  /^https:\/\/(www\.)?google\.(?:com|[a-z]{2,3}|com?\.[a-z]{2})\/maps(?:\/|\?|$)/i,
  /^https:\/\/maps\.google\.(?:com|[a-z]{2,3}|com?\.[a-z]{2})\//i,
  /^https:\/\/(www\.)?openstreetmap\.org\//i,
  /^https:\/\/(www\.)?youtube\.com\/embed\//i,
  /^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//i,
  /^https:\/\/player\.vimeo\.com\/video\//i,
];

const rebuildText = z.string().min(1).max(SITE_SECTIONS_LIMITS.textChars);
const rebuildShort = z.string().min(1).max(300);
const rebuildHttp = z.string().max(2000).regex(/^https?:\/\//i, 'Only http(s) URLs are allowed');
const RebuildImageSchema = z.object({
  src: rebuildHttp,
  alt: z.string().max(300),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  eager: z.boolean().optional(),
});
const RebuildLinkSchema = z
  .object({ label: rebuildShort, href: z.string().max(2000), kind: z.enum(['booking', 'anchor', 'phone', 'email', 'map']) })
  .refine(
    (link) =>
      ({
        booking: link.href === '#booking',
        anchor: /^#s-\d+$/.test(link.href),
        phone: /^tel:\+?[\d]{3,20}$/.test(link.href),
        email: /^mailto:[^\s@<>"]+@[^\s@<>"]+$/.test(link.href),
        map: /^https?:\/\//i.test(link.href),
      })[link.kind],
    'Link href does not match its kind',
  );
const RebuildItemSchema = z.object({
  title: rebuildShort.optional(),
  subtitle: rebuildShort.optional(),
  text: z.array(rebuildText).max(SITE_SECTIONS_LIMITS.textsPerArray),
  image: RebuildImageSchema.optional(),
  backgroundImage: rebuildHttp.optional(),
  backgroundAlt: rebuildShort.optional(),
  price: rebuildShort.optional(),
  rating: z.number().min(0).max(5).optional(),
  links: z.array(RebuildLinkSchema).max(SITE_SECTIONS_LIMITS.links),
});
const RebuildSectionSchema = z.object({
  id: z.string().regex(/^s-\d+$/),
  index: z.number().int().min(0),
  kind: z.enum(SITE_SECTION_KINDS),
  arrangement: z.enum(SITE_SECTION_ARRANGEMENTS),
  columns: z.number().int().min(1).max(8).optional(),
  mediaSide: z.enum(['left', 'right']).optional(),
  mediaFit: z.enum(REBUILD_MEDIA_FITS).optional(),
  mediaMax: z.number().int().min(1).max(1200).optional(),
  split: z.number().min(0.1).max(0.9).optional(),
  headingLevel: z.union([z.literal(1), z.literal(2)]),
  photoSlides: z.boolean().optional(),
  intro: z.object({
    eyebrow: rebuildShort.optional(),
    heading: rebuildShort.optional(),
    text: z.array(rebuildText).max(SITE_SECTIONS_LIMITS.textsPerArray),
    links: z.array(RebuildLinkSchema).max(SITE_SECTIONS_LIMITS.links),
  }),
  items: z.array(RebuildItemSchema).max(SITE_SECTIONS_LIMITS.items),
  itemStyle: z
    .object({
      background: siteHex.optional(),
      text: siteHex.optional(),
      radius: z.number().min(0).max(999).optional(),
      border: z.boolean().optional(),
      shadow: z.boolean().optional(),
      imageShape: z.enum(SITE_IMAGE_SHAPES).optional(),
      align: z.enum(['left', 'center']).optional(),
    })
    .optional(),
  extra: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.array(rebuildText).max(SITE_SECTIONS_LIMITS.textsPerArray) }),
        z.object({ type: z.literal('items'), arrangement: z.enum(SITE_SECTION_ARRANGEMENTS), items: z.array(RebuildItemSchema).max(SITE_SECTIONS_LIMITS.items) }),
      ]),
    )
    .max(SITE_SECTIONS_LIMITS.extra),
  images: z.array(RebuildImageSchema).max(SITE_SECTIONS_LIMITS.images),
  embeds: z
    .array(
      z.object({
        kind: z.enum(['map', 'video']),
        src: rebuildHttp.refine((src) => REBUILD_IFRAME_HOSTS.some((host) => host.test(src)), 'Iframe host not allowed'),
        title: rebuildShort,
      }),
    )
    .max(SITE_SECTIONS_LIMITS.embeds),
  booking: z.boolean(),
  collapsed: z.boolean(),
  style: z.object({
    background: siteHex.optional(),
    backgroundImage: rebuildHttp.optional(),
    text: siteHex,
    overlay: z.number().min(0).max(1).optional(),
    align: z.enum(['left', 'center']),
    paddingY: z.number().int().min(0).max(200),
    fullBleed: z.boolean(),
  }),
});

export const RebuildPlanSchema = z.object({
  language: z.string().min(2).max(35),
  businessName: rebuildShort,
  hiddenH1: rebuildShort.optional(),
  year: z.number().int().min(2000).max(2200),
  theme: z.object({
    primary: siteHex,
    onPrimary: siteHex,
    pageBackground: siteHex,
    pageText: siteHex,
    headingFont: z.string().min(1).max(300),
    bodyFont: z.string().min(1).max(300),
    headingWeight: z.number().int().min(100).max(1000),
    headingUppercase: z.boolean(),
    h1Size: z.number().min(16).max(96),
    h2Size: z.number().min(16).max(72),
    bodySize: z.number().min(16).max(22),
    lineHeight: z.number().min(1.5).max(2.2),
    buttonRadius: z.number().min(0).max(999),
    buttonUppercase: z.boolean(),
  }),
  header: z.object({
    logo: RebuildImageSchema.optional(),
    nav: z.array(z.object({ label: rebuildShort, href: z.string().regex(/^#s-\d+$/) })).max(SITE_SECTIONS_LIMITS.links),
    cta: z.object({ label: rebuildShort }),
    phone: z.string().max(30).optional(),
  }),
  sections: z.array(RebuildSectionSchema).min(1).max(SITE_SECTIONS_LIMITS.sections),
  bookingAppended: z.boolean(),
  bookingServices: z.array(z.string().min(1).max(60)).max(SITE_SECTIONS_LIMITS.items),
  footer: z.object({
    section: RebuildSectionSchema.optional(),
    contacts: z.object({
      phone: z.string().max(30).optional(),
      email: z.string().email().max(254).optional(),
      address: z.string().max(300).optional(),
      workingHours: z.string().max(300).optional(),
    }),
    social: z.array(z.object({ label: rebuildShort, href: rebuildHttp })).max(12),
  }),
  summary: MvpRebuildSummarySchema,
  customCss: z.string().max(MVP_CUSTOM_CSS_MAX).optional(),
  seo: MvpSeoSchema,
});

/** The published MVP's standards checks (REV-118): every check read, and the score their points add up to */
export const MvpStandardsSchema = z
  .object({
    checks: z.object(Object.fromEntries(STANDARDS_CHECKS.map((check) => [check, z.boolean()])) as Record<(typeof STANDARDS_CHECKS)[number], z.ZodBoolean>),
    score: z.number().int().min(0).max(100),
  })
  .refine(
    ({ checks, score }) => STANDARDS_CHECKS.reduce((sum, check) => sum + (checks[check] ? STANDARDS_POINTS[check] : 0), 0) === score,
    'The score is the points of the passed checks',
  );

/** The published MVP's web vitals (REV-119); LCP in ms, CLS unitless, the score only with an LCP */
export const MvpPerformanceSchema = z
  .object({
    webVitals: z.object({ lcp: z.number().int().min(0).optional(), cls: z.number().min(0).optional() }),
    score: z.number().int().min(0).max(100).optional(),
    host: z.string().min(1).max(253),
    measuredAt: z.coerce.date(),
    error: z.string().min(1).max(300).optional(),
  })
  .refine(({ webVitals, score }) => score === undefined || webVitals.lcp !== undefined, 'A score needs an LCP');

// The rebuild edit (REV-111): ids from the reader and fixed values; the only free text is CSS for the sanitizer

export const REBUILD_EDIT_LIMITS = { dropped: 200 } as const;
const rebuildSectionId = z.string().regex(/^s-\d{1,3}$/, 'A section id is s-<index>');
const rebuildPieceId = z.string().regex(/^s-\d{1,3}\.[tix]\d{1,3}$/, 'A piece id is s-<index>.t|i|x<n>');
/** An image of a read section; only the hero photo names one (REV-114) */
const rebuildPhotoId = z.string().regex(/^s-\d{1,3}\.m\d{1,3}$/, 'A photo id is s-<index>.m<n>');

export const RebuildEditAnswerSchema = z
  .object({
    order: z.array(rebuildSectionId).max(SITE_SECTIONS_LIMITS.sections).optional(),
    hidden: z.array(rebuildSectionId).max(SITE_SECTIONS_LIMITS.sections).optional(),
    dropped: z.array(rebuildPieceId).max(REBUILD_EDIT_LIMITS.dropped).optional(),
    sections: z
      .record(
        rebuildSectionId,
        z
          .object({
            background: z.enum(REBUILD_EDIT_BACKGROUNDS).optional(),
            align: z.enum(REBUILD_EDIT_ALIGNS).optional(),
            density: z.enum(MVP_DESIGN_DENSITIES).optional(),
            arrangement: z.enum(REBUILD_EDIT_ARRANGEMENTS).optional(),
            mediaSide: z.enum(['left', 'right']).optional(),
            media: z.enum(REBUILD_MEDIA_FITS).optional(),
          })
          .strict(),
      )
      .optional(),
    hero: z.object({ photo: rebuildPhotoId, style: z.enum(REBUILD_HERO_STYLES) }).strict().optional(),
    theme: z
      .object({
        font: z.enum(MVP_DESIGN_FONTS).optional(),
        density: z.enum(MVP_DESIGN_DENSITIES).optional(),
        corners: z.enum(MVP_DESIGN_CORNERS).optional(),
        headingCase: z.enum(REBUILD_EDIT_HEADING_CASES).optional(),
        typeScale: z.enum(REBUILD_TYPE_SCALES).optional(),
      })
      .strict()
      .optional(),
    customCss: z.string().max(MVP_CUSTOM_CSS_MAX).optional(),
  })
  .strict();

/** What the modernize level may decide (REV-114): the look fields of the edit, never order, hiding, dropping or CSS */
export const RebuildModernizeAnswerSchema = RebuildEditAnswerSchema.omit({ order: true, hidden: true, dropped: true, customCss: true }).strict();

/** The saved modernize design, with the audit its ids were read from; a failure has its reason and no design (REV-132) */
export const RebuildModernizeSchema = z.discriminatedUnion('source', [
  z.object({ auditId: z.string().regex(/^[a-f0-9]{24}$/i), source: z.literal('llm'), design: RebuildModernizeAnswerSchema }).strict(),
  z
    .object({
      auditId: z.string().regex(/^[a-f0-9]{24}$/i),
      source: z.literal('failed'),
      error: z.enum(MODERNIZE_FAILURES),
      message: z.string().max(300).optional(),
    })
    .strict(),
]);

/** Why a render that needs a model was not made (REV-132): each code with its own reasons */
export const MvpRenderFailureSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('MVP_REBUILD_UNAVAILABLE'),
    reason: z.enum(REBUILD_UNAVAILABLE_REASONS),
    level: z.enum(REBUILD_LEVELS).optional(),
    message: z.string().max(300).optional(),
    at: z.coerce.date(),
  }),
  z.object({
    code: z.literal('MVP_MODERNIZE_UNAVAILABLE'),
    reason: z.enum(MODERNIZE_FAILURES),
    level: z.enum(REBUILD_LEVELS).optional(),
    message: z.string().max(300).optional(),
    at: z.coerce.date(),
  }),
  // A page the model could not make (REV-138)
  z.object({
    code: z.literal('MVP_PAGE_UNAVAILABLE'),
    reason: z.enum(MVP_PAGE_FAILURES),
    message: z.string().max(300).optional(),
    at: z.coerce.date(),
  }),
]);

/** The saved edit: the answer plus the audit its ids belong to (set by the worker, never by the model) */
export const RebuildEditSchema = RebuildEditAnswerSchema.extend({ auditId: z.string().regex(/^[a-f0-9]{24}$/i) }).strict();

/** How the model applies an operator's free-text change to a rebuilt MVP; null or absent keeps that part */
export const RebuildEditOutputSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  /** The whole new edit; an empty object drops it */
  edit: RebuildEditAnswerSchema.nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[A-Fa-f0-9]{6}$/)
    .nullable()
    .optional(),
  layout: MvpLayoutVariantSchema.nullable().optional(),
});
export type RebuildEditOutput = z.infer<typeof RebuildEditOutputSchema>;

/** Whether an edit changes anything */
export function hasRebuildEdit(edit: IRebuildEditAnswer | null | undefined): boolean {
  if (!edit) return false;
  const some = (value: object | undefined) => Boolean(value && Object.values(value).some((v) => v !== undefined));
  return Boolean(
    edit.order?.length ||
      edit.hidden?.length ||
      edit.dropped?.length ||
      Object.values(edit.sections ?? {}).some((section) => some(section)) ||
      some(edit.theme) ||
      edit.hero ||
      edit.customCss?.trim(),
  );
}

/** The section the rebuild gives the page's h1: the first hero with a heading, as the planner decides */
export const rebuildH1Section = (sections: ISiteSection[]): ISiteSection | undefined =>
  sections.find((s) => s.role === 'hero' && Boolean(s.intro.heading?.trim()));

/** Longest intro paragraph that still fits a card (REV-114) */
export const REBUILD_CARD_MAX_CHARS = 300;

/**
 * A section rendered as a wall of text (REV-122): at least this many paragraphs, and more than
 * `REBUILD_WALL_MEDIAN_FACTOR` times the median of the page's other sections. The planner records it as `wall:<i>`.
 */
export const REBUILD_WALL_MIN_PARAGRAPHS = 10;
export const REBUILD_WALL_MEDIAN_FACTOR = 3;

/** The section indexes whose paragraph count stands out as a wall, with the median of the others */
export function textWalls(counts: { index: number; paragraphs: number }[]): { index: number; paragraphs: number; median: number }[] {
  const median = (list: number[]) => {
    if (!list.length) return 0;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return counts.flatMap((c) => {
    if (c.paragraphs < REBUILD_WALL_MIN_PARAGRAPHS) return [];
    const others = median(counts.filter((o) => o !== c).map((o) => o.paragraphs));
    return c.paragraphs > REBUILD_WALL_MEDIAN_FACTOR * others ? [{ ...c, median: others }] : [];
  });
}

/**
 * The run of paragraphs that become cards (REV-114): at least 3 in a row, each at most 300 characters,
 * with only longer paragraphs before and after it (those stay as the section's intro and outro). A longer
 * paragraph inside the run, or fewer than 3, means the section does not fit. `end` is exclusive.
 */
export function cardRun(paragraphs: string[]): { start: number; end: number } | null {
  const long = (text: string) => text.length > REBUILD_CARD_MAX_CHARS;
  let i = 0;
  while (i < paragraphs.length && long(paragraphs[i]!)) i++;
  const start = i;
  while (i < paragraphs.length && !long(paragraphs[i]!)) i++;
  const end = i;
  while (i < paragraphs.length && long(paragraphs[i]!)) i++;
  if (i !== paragraphs.length || end - start < 3) return null;
  return { start, end };
}

/**
 * Whether a section's items can be shown as cards (REV-114): a list of 3 or more, or 3 or more items read beside a
 * photo (REV-122: a bullet list next to its picture); the photo then follows the cards
 */
export function rebuildItemsFitCards(section: Pick<ISiteSection, 'arrangement' | 'items'>): boolean {
  return (section.arrangement === 'list' || section.arrangement === 'media-beside-text') && section.items.length >= 3;
}

export type RebuildEditCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks an edit against the page it was made for (REV-111): every id names one of its hero or content
 * sections or a piece of one, nothing is listed twice, something stays visible, and the opening section
 * keeps its h1 and, when it opens the page, its place.
 */
export function checkRebuildEdit(edit: IRebuildEditAnswer, read: Pick<ISiteSections, 'sections'>): RebuildEditCheck {
  const main = read.sections.filter((s) => s.role === 'hero' || s.role === 'content').slice(0, SITE_SECTIONS_LIMITS.sections);
  const byId = new Map(main.map((s) => [`s-${s.index}`, s]));
  const fail = (reason: string): RebuildEditCheck => ({ ok: false, reason });
  const order = edit.order ?? [];
  const hidden = edit.hidden ?? [];
  const dropped = edit.dropped ?? [];

  for (const id of [...order, ...hidden, ...Object.keys(edit.sections ?? {})]) {
    if (!byId.has(id)) return fail(`unknown section ${id}`);
  }
  const repeated = (list: string[]) => list.find((id, i) => list.indexOf(id) !== i);
  const twice = repeated(order) ?? repeated(hidden) ?? repeated(dropped);
  if (twice) return fail(`${twice} is listed twice`);
  for (const id of dropped) {
    const [, sectionId, part, n] = id.match(/^(s-\d+)\.([tix])(\d+)$/) ?? [];
    const section = sectionId ? byId.get(sectionId) : undefined;
    if (!section) return fail(`unknown piece ${id}`);
    const pieces = part === 't' ? section.intro.text : part === 'i' ? section.items : section.extra;
    if (Number(n) >= pieces.length) return fail(`unknown piece ${id}`);
  }
  if (main.every((s) => hidden.includes(`s-${s.index}`))) return fail('every section is hidden');
  const h1 = rebuildH1Section(main);
  if (h1) {
    const h1Id = `s-${h1.index}`;
    if (hidden.includes(h1Id)) return fail(`${h1Id} holds the page's main heading and cannot be hidden`);
    if (main[0] === h1 && order.length && order[0] !== h1Id) return fail(`${h1Id} opens the page and must stay first`);
  }

  // Modernize vocabulary (REV-114)
  for (const [id, change] of Object.entries(edit.sections ?? {})) {
    const section = byId.get(id)!;
    const { arrangement } = change;
    if (arrangement && arrangement !== section.arrangement) {
      const fits =
        section.arrangement === 'text'
          ? cardRun(section.intro.text) !== null
          : rebuildItemsFitCards(section) && arrangement === 'card-grid';
      if (!fits) return fail(`${id} cannot be shown as ${arrangement}`);
    }
    if ((change.mediaSide || change.media) && !(section.arrangement === 'media-beside-text' && section.images.length > 0)) {
      return fail(`${id} has no photo beside its text`);
    }
  }
  if (edit.hero) {
    if (!h1) return fail('the page has no main heading');
    const slides = h1.arrangement === 'slider' && h1.items.some((item) => item.image);
    if (h1.images.length || h1.style.backgroundImage || slides) return fail('the opening section already shows a photo');
    const [, sectionId, n] = edit.hero.photo.match(/^(s-\d+)\.m(\d+)$/) ?? [];
    const source = sectionId ? byId.get(sectionId) : undefined;
    const image = source?.images[Number(n)];
    if (!source || !image || !/^https?:\/\//i.test(image.src)) return fail(`unknown piece ${edit.hero.photo}`);
    if (source.index <= h1.index) return fail(`${edit.hero.photo} is not below the opening section`);
    if (edit.hero.style === 'banner' && (image.width ?? 0) < REBUILD_BANNER_MIN_WIDTH) {
      return fail(`${edit.hero.photo} is too small for a banner`);
    }
  }
  return { ok: true };
}

// Model-designed MVP page (REV-136)

const mvpHex = z.string().regex(/^#[0-9a-f]{6}$/i);
const briefText = z.string().min(1).max(4000);

export const MvpSourceBriefSchema = z
  .object({
    business: z
      .object({
        name: z.string().min(1).max(200),
        niche: z.string().min(1).max(100),
        city: z.string().min(1).max(200).optional(),
        originalUrl: z.string().url(),
      })
      .strict(),
    language: z.string().min(2).max(35).optional(),
    services: z.array(z.string().min(1).max(200)).max(MVP_BRIEF_LIMITS.services),
    copy: z
      .object({
        title: briefText.optional(),
        metaDescription: briefText.optional(),
        h1: briefText.optional(),
        headings: z.array(briefText).max(MVP_BRIEF_LIMITS.headings),
        paragraphs: z.array(briefText).max(MVP_BRIEF_LIMITS.paragraphs),
        serviceItems: z
          .array(z.object({ title: briefText, description: briefText.optional() }).strict())
          .max(MVP_BRIEF_LIMITS.serviceItems),
        testimonials: z
          .array(z.object({ text: briefText, author: z.string().min(1).max(200).optional() }).strict())
          .max(MVP_BRIEF_LIMITS.testimonials),
        rating: z.object({ value: z.number().min(0).max(100), count: z.number().int().min(0).optional() }).strict().optional(),
        foundingYear: z.number().int().min(1000).max(3000).optional(),
      })
      .strict(),
    brand: z
      .object({
        // Empty when the audit read no color; a color is never made up
        primary: z.string().max(50),
        secondary: z.string().max(50),
        accent: z.string().max(50),
        fonts: z.array(z.string().min(1).max(100)).max(10),
        logoUrl: z.string().url().optional(),
      })
      .strict(),
    images: z.array(z.string().url()).max(MVP_BRIEF_LIMITS.images),
    placeholders: z.array(z.enum(MVP_PLACEHOLDERS)),
  })
  .strict();

/** The theme the model declared in `:root`: colors as written and CSS font stacks */
const themeValue = z.string().min(1).max(200);
export const MvpThemeSchema = z
  .object({
    primary: themeValue,
    accent: themeValue,
    bg: themeValue,
    surface: themeValue,
    text: themeValue,
    fontHeading: themeValue,
    fontBody: themeValue,
  })
  .strict();

/** The operator's palette and font controls: `#rrggbb` colors and plain font family names, so they are safe in CSS */
const fontFamily = z.string().regex(/^[A-Za-z0-9 ]{1,40}$/);
export const MvpThemeControlsSchema = z
  .object({
    primary: mvpHex.optional(),
    accent: mvpHex.optional(),
    bg: mvpHex.optional(),
    surface: mvpHex.optional(),
    text: mvpHex.optional(),
    fontHeading: fontFamily.optional(),
    fontBody: fontFamily.optional(),
  })
  .strict();

/** WCAG 2.x relative luminance of a `#rrggbb` color */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colors, 1 to 21, in either order */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * PATCH /api/v1/mvp/:id/tokens (REV-139): the operator's palette and fonts over the model's theme. A group given
 * replaces the saved one, `null` clears it, a missing one is kept. The text must read on the background and the
 * surface (WCAG AA), and the fonts are one of the fixed pairings.
 */
export const UpdateMvpTokensSchema = z
  .object({
    colors: z
      .object({ primary: mvpHex, accent: mvpHex, bg: mvpHex, surface: mvpHex, text: mvpHex })
      .strict()
      .superRefine((colors, ctx) => {
        const low = [colors.bg, colors.surface].find((under) => contrastRatio(colors.text, under) < MVP_MIN_CONTRAST);
        if (low) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['text'],
            message: `The text color must have a contrast of at least ${MVP_MIN_CONTRAST}:1 on ${low === colors.bg ? 'the background' : 'the surface'}`,
          });
        }
      })
      .nullable()
      .optional(),
    fonts: z
      .object({ heading: z.string(), body: z.string() })
      .strict()
      .refine((fonts) => MVP_FONT_CHOICES.some((choice) => choice.heading === fonts.heading && choice.body === fonts.body), {
        message: 'The fonts must be one of the listed pairings',
      })
      .nullable()
      .optional(),
  })
  .strict()
  .refine((body) => body.colors !== undefined || body.fonts !== undefined, { message: 'Give colors, fonts or both' });

export type UpdateMvpTokensDto = z.infer<typeof UpdateMvpTokensSchema>;

/** The version number in POST /api/v1/mvp/:id/versions/:n/restore (REV-139) */
export const MvpVersionParamsSchema = z.object({ n: z.coerce.number().int().min(1) });

export const MvpGroundingFlagSchema = z
  .object({
    kind: z.enum(MVP_GROUNDING_KINDS),
    text: z.string().min(1).max(200),
    context: z.string().max(80),
  })
  .strict();

export const MvpPageFailureSchema = z.enum(MVP_PAGE_FAILURES);

export const MvpPageVersionSchema = z
  .object({
    n: z.number().int().min(1),
    kind: z.enum(MVP_PAGE_VERSION_KINDS),
    instruction: z.string().max(2000).optional(),
    from: z.number().int().min(1).optional(),
    jobId: z.string().max(100).optional(),
    provider: z.string().max(50).optional(),
    model: z.string().max(100).optional(),
    storagePath: z.string().min(1).max(500),
    createdAt: z.coerce.date(),
  })
  .strict();
