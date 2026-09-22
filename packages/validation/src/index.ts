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
  services: z
    .array(
      z.object({
        title: z.string().max(50),
        description: z.string().max(120),
        lucideIconName: z.string(),
      }),
    )
    .min(3)
    .max(6),
  trustSignals: z
    .array(
      z.object({
        metric: z.string().max(20), // e.g. "12 лет", "4.9"
        label: z.string().max(50),  // e.g. "на рынке СПб", "рейтинг в картах"
      }),
    )
    .length(3),
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
  }, z.string().url('Укажите корректный URL сайта (например, https://example.com)')),
  niche: NicheEnumSchema.default('other'),
  businessName: z.string().min(2).max(100).optional(),
  contactEmail: z.string().email('Некорректный адрес электронной почты').optional().or(z.literal('')),
});

export type QuickAddLeadInput = z.infer<typeof QuickAddLeadSchema>;

export type CreateLeadDto = z.infer<typeof CreateLeadSchema>;

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
  rating: z.number().min(1).max(5).default(5),
  comment: z.string().min(5).max(300),
  date: z.string().max(50).optional(),
  source: z.enum(['Яндекс Карты', 'Google Карты', '2ГИС', 'Прямой отзыв']).optional(),
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

export const BentoTemplateDataSchema = z.object({
  businessName: z.string().min(1).max(100),
  niche: NicheEnumSchema.optional(),
  logoUrl: z.string().url().optional(),
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

