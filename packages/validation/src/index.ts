import { z } from 'zod';

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
  contactEmail: z.string().email(),
  niche: NicheEnumSchema.default('other'),
  city: z.string().max(100).optional(),
  contactPhone: z.string().max(30).optional(),
  ownerName: z.string().max(100).optional(),
});

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
export const GenerateMvpSchema = z.object({
  auditId: z.string().min(1),
  forceRegenerate: z.boolean().optional().default(false),
});

export type GenerateMvpDto = z.infer<typeof GenerateMvpSchema>;

/**
 * MVP generation rules by lead status (REV-31), shared by the API and the dashboard.
 * - `first`: the lead is audited and has no MVP yet.
 * - `regenerate`: an MVP exists and outreach has not been scheduled; needs `forceRegenerate`.
 * - `blocked`: no finished audit yet, generation already running, or outreach scheduled/dispatched.
 */
export type MvpGenerationMode = 'first' | 'regenerate' | 'blocked';

export const MVP_REGENERATABLE_STATUSES = [
  'MVP_READY',
  'NEEDS_APPROVAL',
  'AWAITING_APPROVAL',
  'APPROVED',
] as const;

export function mvpGenerationMode(status: string | undefined | null): MvpGenerationMode {
  if (status === 'AUDITED') return 'first';
  if ((MVP_REGENERATABLE_STATUSES as readonly string[]).includes(status ?? '')) return 'regenerate';
  return 'blocked';
}

/**
 * Schema for PATCH /api/v1/mvp/:id/tokens
 */
export const UpdateMvpTokensSchema = z.object({
  primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  secondaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  accentColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  headline: z.string().max(90).optional(),
  subheadline: z.string().max(180).optional(),
  services: z
    .array(
      z.object({
        title: z.string().max(50),
        description: z.string().max(120),
        icon: z.string().optional(),
      }),
    )
    .optional(),
});

export type UpdateMvpTokensDto = z.infer<typeof UpdateMvpTokensSchema>;

/**
 * Schema for POST /api/v1/outreach/:id/approve (HITL Gate)
 */
export const ApproveOutreachSchema = z.object({
  scheduleTime: z.string().datetime().optional(),
  approvedBy: z.string().default('operator'),
  subject: z.string().optional(),
  preheader: z.string().optional(),
  body: z.string().optional(),
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

export const BentoTemplateDataSchema = z.object({
  businessName: z.string().min(1).max(100),
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
  customHeadSnippet: z.string().optional(),
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

