import { z } from 'zod';
import {
  DISCOVERY_MAX_EXCLUDED_DOMAINS,
  DiscoveryCandidateStatus,
  LLM_PROVIDER_IDS,
  STANDARDS_CHECKS,
  STANDARDS_POINTS,
  SITE_DATED_SIGNS,
  SITE_ASSESSMENT_FAILURES,
  SITE_ASSESSMENT_VERDICTS,
  SITE_BAD_SIGNS,
  SITE_COMPLEXITY_CLASSES,
  SITE_COMPLEXITY_SIGNS,
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

/** Score at which a site counts as dated (REV-114) */
export const SITE_DATED_THRESHOLD = 3;

export const SiteEraSchema = z
  .object({
    dated: z.boolean(),
    score: z.number().min(0),
    signs: z.array(z.enum(SITE_DATED_SIGNS)).max(SITE_DATED_SIGNS.length),
    contentWidth: z.number().min(0).optional(),
  })
  .strict();

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

/** Why the model gave no page (REV-132, REV-138) */
export const MvpRenderFailureSchema = z.object({
  code: z.literal('MVP_PAGE_UNAVAILABLE'),
  reason: z.enum(MVP_PAGE_FAILURES),
  message: z.string().max(300).optional(),
  at: z.coerce.date(),
});

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
