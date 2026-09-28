import {
  QuickAddLeadInput,
  QuickAddLeadSchema,
  ImportDiscoverySchema,
  StartDiscoveryInput,
  StartDiscoverySchema,
  GenerateMvpSchema,
  TriggerAuditSchema,
} from '@revamp/validation';
import {
  ApiErrorCode,
  IApiError,
  IAudit,
  ICriticalFlaw,
  ILead,
  IMvpProject,
  Serialized,
  IDiscoveryImportResult,
  IDiscoveryJobStatus,
  ILlmProvidersResponse,
  LlmProviderId,
  IMvpCompletenessSummary,
  IMvpEditJobResult,
  MvpLayoutVariant,
  IReverseGeocodeResult,
  ILeadStats,
  LeadStatus,
  NicheType,
  SiteComplexityClass,
} from '@revamp/shared-types';
import { ComplexityFilter } from '../utils/siteComplexity.js';

export interface ILeadItem {
  id: string;
  businessName: string;
  domain: string;
  originalUrl: string;
  niche: NicheType;
  city?: string;
  phone?: string;
  totalScore?: number;
  status: LeadStatus;
  auditId?: string;
  previewUrl?: string;
  comparisonBannerUrl?: string;
  /** When the current MVP was deployed; cache-busts the preview after a regeneration (REV-31) */
  mvpGeneratedAt?: string;
  /** Why the last MVP generation failed, if it did (REV-31) */
  generationError?: string;
  /** Why the last audit failed for good, if it did (REV-44) */
  auditError?: string;
  /** How much of the original site's key data the MVP kept (REV-36) */
  completeness?: IMvpCompletenessSummary;
  /** Complexity class from the latest audit (REV-38) */
  siteComplexity?: SiteComplexityClass;
  createdAt: string;
}

// Initial realistic dataset including the real Listonosz target from REV-7 -> REV-13
const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && (window as unknown as { __REVAMP_API_URL__?: string }).__REVAMP_API_URL__) {
    return (window as unknown as { __REVAMP_API_URL__?: string }).__REVAMP_API_URL__!;
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }
  } catch {
    // import.meta is unavailable outside Vite; use the local API
  }
  return 'http://localhost:4000/api/v1';
};

const API_BASE_URL = getApiBaseUrl();

/**
 * A lead as `GET /leads` returns it: the serialized document plus the MVP completeness summary the
 * list adds for the card (REV-36, REV-67)
 */
export type IServerLead = Serialized<ILead> & { completeness?: IMvpCompletenessSummary };

/** Maps a lead from the API; a lead without an id is a malformed response, never given a made-up one (REV-67) */
export const mapServerLead = (l: IServerLead): ILeadItem => {
  if (!l._id) throw new Error('Malformed server response: lead without an id');

  return {
    id: l._id,
    businessName: l.businessName,
    domain: l.domain,
    originalUrl: l.originalUrl,
    niche: l.niche,
    city: l.city,
    phone: l.contactPhone,
    totalScore: l.totalScore,
    status: l.status,
    previewUrl: l.previewUrl,
    comparisonBannerUrl: l.comparisonBannerUrl,
    mvpGeneratedAt: l.mvpGeneratedAt,
    generationError: l.generationError,
    auditError: l.auditError,
    completeness: l.completeness,
    siteComplexity: l.siteComplexity,
    createdAt: l.createdAt,
  };
};

export interface LeadListFilters {
  search?: string;
  status?: string;
  niche?: string;
  complexity?: ComplexityFilter;
}

/** Largest page the API serves (`GetLeadsQuerySchema.limit`) */
export const LEADS_PAGE_SIZE = 100;
/** Stops a runaway loop if the total keeps growing while paging */
const MAX_LEAD_PAGES = 50;

/**
 * Loads every lead matching the filters by walking the API's pages; the Kanban and the table both
 * need the full set, not the API's default first page of 20 (REV-43)
 */
export async function fetchAllLeadPages(filters?: LeadListFilters): Promise<{ leads: ILeadItem[]; total: number }> {
  const leads: ILeadItem[] = [];
  let total = 0;

  for (let page = 1; page <= MAX_LEAD_PAGES; page++) {
    const params = new URLSearchParams({ page: String(page), limit: String(LEADS_PAGE_SIZE) });
    if (filters?.status && filters.status !== 'ALL') params.append('status', filters.status);
    if (filters?.niche && filters.niche !== 'ALL') params.append('niche', filters.niche);
    if (filters?.complexity && filters.complexity !== 'ALL') params.append('complexity', filters.complexity);
    const search = filters?.search?.trim();
    if (search) params.append('search', search);

    const res = await fetch(`${API_BASE_URL}/leads?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to load leads (HTTP ${res.status})`);
    const body = (await res.json()) as {
      success?: boolean;
      data?: IServerLead[];
      pagination?: { total?: number; totalPages?: number };
    };
    if (!body.success || !Array.isArray(body.data)) throw new Error('Unexpected leads response');

    leads.push(...body.data.map(mapServerLead));
    total = body.pagination?.total ?? leads.length;
    const totalPages = body.pagination?.totalPages ?? 1;
    if (page >= totalPages || body.data.length === 0) break;
  }

  return { leads, total };
}

/** Pipeline-wide counts by status, independent of the list filters (REV-43); feeds the rail's Needs-you badge (REV-76) */
export async function fetchLeadStats(): Promise<ILeadStats> {
  const res = await fetch(`${API_BASE_URL}/leads/stats`, { headers: { Accept: 'application/json' } });
  return readDataOrThrow<ILeadStats>(res);
}

export const apiClient = {
  /**
   * Fetches every lead matching the status, niche, complexity and text filters, plus the pipeline KPIs
   */
  async getLeads(filters?: LeadListFilters): Promise<{ leads: ILeadItem[]; total: number }> {
    return fetchAllLeadPages(filters);
  },

  /** Pipeline-wide counts by status (REV-43) */
  async getLeadStats(): Promise<ILeadStats> {
    return fetchLeadStats();
  },

  /**
   * Adds a new website for automated audit & MVP generation
   */
  async createLead(input: QuickAddLeadInput): Promise<ILeadItem> {
    const validated = QuickAddLeadSchema.parse(input);

    let targetUrl = validated.url;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
    const capitalizedDomain = domain.split('.')[0] ?? 'Website';
    const businessName =
      validated.businessName ||
      capitalizedDomain.charAt(0).toUpperCase() + capitalizedDomain.slice(1);

    const res = await fetch(`${API_BASE_URL}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName,
        originalUrl: targetUrl,
        // Without an email the audit takes the one published on the site; none is invented (REV-45)
        ...(validated.contactEmail ? { contactEmail: validated.contactEmail } : {}),
        niche: validated.niche || 'other',
      }),
    });
    const data = await readDataOrThrow<{ id?: string; auditId?: string }>(res);
    const createdId = data.id;
    if (!createdId) throw new Error('Malformed server response');

    return {
      id: createdId,
      businessName,
      domain,
      originalUrl: targetUrl,
      niche: validated.niche || 'other',
      status: 'QUEUED',
      auditId: data.auditId,
      createdAt: new Date().toISOString(),
    };
  },

  /**
   * Fetches audit diagnostics and critique details for Side-by-Side Inspector
   */
  async getAudit(auditId: string): Promise<IAuditDetail> {
    const res = await fetch(`${API_BASE_URL}/audits/${encodeURIComponent(auditId)}`);
    return mapServerAudit(await readDataOrThrow<IServerAudit>(res), auditId);
  },

  /**
   * Approves lead outreach and transitions status to SCHEDULED (HITL Approval Gate). The draft is
   * required: the API sends only the text the operator approved (REV-61)
   */
  async approveOutreach(
    leadId: string,
    emailData: IEmailDraft,
  ): Promise<{ success: boolean; leadId: string; status: LeadStatus }> {
    const res = await fetch(`${API_BASE_URL}/outreach/${encodeURIComponent(leadId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvedBy: 'operator',
        ...emailData,
      }),
    });
    await readDataOrThrow<unknown>(res);
    return { success: true, leadId, status: 'SCHEDULED' };
  },

  /**
   * Sends the current draft to the operator's own address (REV-60). Resolves only once the email
   * provider accepted it; a missing provider or a failed send rejects with the API's message.
   */
  async sendTestEmail(leadId: string, testEmail: string, draft: IEmailDraft): Promise<ITestEmailResult> {
    const res = await fetch(`${API_BASE_URL}/outreach/${encodeURIComponent(leadId)}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testEmail, ...draft }),
    });
    return readDataOrThrow<ITestEmailResult>(res);
  },

  /**
   * Rejects outreach draft and transitions status to REJECTED
   */
  async rejectLead(
    leadId: string,
    reason: string,
  ): Promise<{ success: boolean; leadId: string; status: LeadStatus }> {
    const res = await fetch(`${API_BASE_URL}/outreach/${encodeURIComponent(leadId)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    await readDataOrThrow<unknown>(res);
    return { success: true, leadId, status: 'REJECTED' };
  },

  /**
   * Saves the MVP's palette (primaryColor, accentColor, etc.) by the MVP's own id and returns the saved
   * MVP; an invalid or unknown id throws (REV-65)
   */
  async updateMvpTokens(
    mvpId: string,
    tokens: { primaryColor?: string; secondaryColor?: string; accentColor?: string },
  ): Promise<IMvpProjectDetail> {
    const res = await fetch(`${API_BASE_URL}/mvp/${encodeURIComponent(mvpId)}/tokens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens),
    });
    return readDataOrThrow<IMvpProjectDetail>(res);
  },

  /**
   * Saves the layout the operator picked for the MVP, by the MVP's own id, and returns the saved MVP
   * (REV-84). The server then re-renders the published page in it; a lead past review throws.
   */
  async updateMvpLayout(mvpId: string, variant: MvpLayoutVariant): Promise<IMvpProjectDetail> {
    const res = await fetch(`${API_BASE_URL}/mvp/${encodeURIComponent(mvpId)}/layout`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant }),
    });
    return readDataOrThrow<IMvpProjectDetail>(res);
  },

  /**
   * Asks for a change to the MVP in the operator's own words (REV-85). Answers once the workers' LLM has
   * applied it and the page is re-published, or has explained why nothing changed.
   */
  async editMvp(mvpId: string, instruction: string): Promise<IMvpEditResult> {
    const res = await fetch(`${API_BASE_URL}/mvp/${encodeURIComponent(mvpId)}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    });
    return readDataOrThrow<IMvpEditResult>(res);
  },

  /**
   * Fetches MVP project details by leadId, mvpId, or slug
   */
  async getMvp(idOrLeadId: string): Promise<IMvpProjectDetail | null> {
    const res = await fetch(`${API_BASE_URL}/mvp/${encodeURIComponent(idOrLeadId)}`);
    // No MVP generated yet for this lead
    if (res.status === 404) return null;
    return readDataOrThrow<IMvpProjectDetail>(res);
  },

  /**
   * Triggers MVP generation for an audited lead, or regenerates an existing MVP with
   * `forceRegenerate` (REV-31). Server rejections (e.g. 409 once outreach is scheduled) and an
   * unreachable backend are thrown.
   */
  async generateMvp(
    auditId: string,
    options: { forceRegenerate?: boolean; provider?: LlmProviderId; model?: string } = {},
  ): Promise<{ success: boolean; status: LeadStatus }> {
    // Validated before the request, so an invalid provider/model never reaches the API
    const payload = GenerateMvpSchema.parse({
      auditId,
      forceRegenerate: options.forceRegenerate ?? false,
      provider: options.provider,
      model: options.model,
    });
    const res = await fetch(`${API_BASE_URL}/mvp/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await readDataOrThrow<unknown>(res);
    return { success: true, status: 'GENERATING' };
  },

  /**
   * Re-queues the audit of a lead whose audit failed (REV-44). The lead goes back to QUEUED;
   * server rejections and an unreachable backend are thrown.
   */
  async retryAudit(leadId: string): Promise<{ success: boolean; status: LeadStatus }> {
    const payload = TriggerAuditSchema.parse({ leadId });
    const res = await fetch(`${API_BASE_URL}/audits/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await readDataOrThrow<unknown>(res);
    return { success: true, status: 'QUEUED' };
  },

  /**
   * LLM providers/models for MVP generation and which the workers can run right now (REV-32)
   */
  async getLlmProviders(): Promise<ILlmProvidersResponse> {
    const res = await fetch(`${API_BASE_URL}/mvp/providers`, { headers: { Accept: 'application/json' } });
    return readDataOrThrow<ILlmProvidersResponse>(res);
  },

  /**
   * Queues a maps-provider search that imports local businesses as leads (REV-26/27)
   */
  async startDiscovery(input: StartDiscoveryInput): Promise<{ jobId: string }> {
    const validated = StartDiscoverySchema.parse(input);
    const res = await fetch(`${API_BASE_URL}/discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validated),
    });
    const data = await readDataOrThrow<{ jobId: string }>(res);
    return { jobId: data.jobId };
  },

  /**
   * Polls a discovery job for its state and import summary
   */
  async getDiscoveryStatus(jobId: string): Promise<IDiscoveryJobStatus> {
    const res = await fetch(`${API_BASE_URL}/discovery/${encodeURIComponent(jobId)}`, {
      headers: { Accept: 'application/json' },
    });
    return readDataOrThrow<IDiscoveryJobStatus>(res);
  },

  /**
   * Imports the operator's selection from a finished discovery job as leads (REV-29)
   */
  async importDiscoveryCandidates(jobId: string, externalIds: string[]): Promise<IDiscoveryImportResult> {
    const res = await fetch(`${API_BASE_URL}/discovery/${encodeURIComponent(jobId)}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ImportDiscoverySchema.parse({ externalIds })),
    });
    return readDataOrThrow<IDiscoveryImportResult>(res);
  },

  /**
   * Resolves browser coordinates to a "City, Country" name in the given language (REV-28)
   */
  async reverseGeocode(lat: number, lng: number, lang?: string): Promise<IReverseGeocodeResult> {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (lang) params.set('lang', lang);
    const res = await fetch(`${API_BASE_URL}/discovery/reverse-geocode?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    return readDataOrThrow<IReverseGeocodeResult>(res);
  },
};

/** Returns the `data` of a JSON API response, turning non-2xx responses into an Error with the server's message */
/** The draft as the operator sees it in the preview, with its variables substituted */
/** An outreach draft with its variables substituted, as the preview shows it (REV-60, REV-72) */
export interface IEmailDraft {
  subject: string;
  preheader?: string;
  body: string;
}

export interface ITestEmailResult {
  to: string;
  messageId?: string;
  provider: string;
  sentAt: string;
}

/** An error response from the API, with its `error.code` for callers that branch on it (REV-63) */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: ApiErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readDataOrThrow<T>(res: Response): Promise<T> {
  let body: { error?: Partial<IApiError>; data?: T } | null = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body; fall through to the status-based message
  }
  if (!res.ok) {
    const error = body?.error;
    throw new ApiError(error?.message || `Server error (${res.status})`, res.status, error?.code, error?.details);
  }
  if (body?.data === undefined) {
    throw new Error('Malformed server response');
  }
  return body.data;
}

/**
 * An MVP project as `GET /mvp/:id` returns it (REV-67). Only the lead and the preview URL are certain;
 * the rest is optional so a record written by an older version still renders.
 */
export type IMvpProjectDetail = Pick<Serialized<IMvpProject>, 'leadId' | 'fullPreviewUrl'> &
  Partial<Serialized<IMvpProject>> & {
    /** Copy of `_id` the API's JSON transform adds */
    id?: string;
  };

/** What `POST /mvp/:id/edit` returns (REV-85): the change the model made and the MVP as saved after it */
export interface IMvpEditResult extends IMvpEditJobResult {
  mvp: IMvpProjectDetail;
}

/**
 * An audit as the inspector shows it. Values the audit did not measure stay undefined, so the UI
 * shows them as missing instead of a made-up number (REV-45).
 */
export interface IAuditDetail {
  id: string;
  leadId: string;
  desktopScreenshotUrl?: string;
  mobileScreenshotUrl?: string;
  /** Full-page captures of the original site; absent for audits made before REV-21 */
  desktopFullScreenshotUrl?: string;
  mobileFullScreenshotUrl?: string;
  lcpSeconds?: number;
  a11yScore?: number;
  a11yViolationsCount?: number;
  visualHierarchyRating?: number;
  mobileFriendlinessRating?: number;
  criticalFlaws: ICriticalFlaw[];
  quickWins: string[];
  colorPalette: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  /** Services the crawler found on the original site; undefined when it did not extract them (REV-81) */
  originalServiceCount?: number;
}

/**
 * An audit as `GET /audits/:id` returns it (REV-67). A queued or failed audit has not filled in its
 * sections yet, so everything but the lead is optional.
 */
export type IServerAudit = Pick<Serialized<IAudit>, 'leadId'> & Partial<Serialized<IAudit>>;

/** Maps an audit from the API, keeping unmeasured values undefined */
export const mapServerAudit = (a: IServerAudit, auditId: string): IAuditDetail => ({
  id: a._id || auditId,
  leadId: a.leadId,
  desktopScreenshotUrl: a.screenshotUrls?.desktopOriginal || undefined,
  mobileScreenshotUrl: a.screenshotUrls?.mobileOriginal || undefined,
  desktopFullScreenshotUrl: a.screenshotUrls?.desktopFull || undefined,
  mobileFullScreenshotUrl: a.screenshotUrls?.mobileFull || undefined,
  // lighthouseMetrics.lcp is in milliseconds
  lcpSeconds: a.lighthouseMetrics?.lcp != null ? a.lighthouseMetrics.lcp / 1000 : undefined,
  a11yScore: a.scores?.accessibility ?? undefined,
  a11yViolationsCount: a.a11ySummary?.violationsCount ?? undefined,
  visualHierarchyRating: a.designCritique?.visualHierarchyRating ?? undefined,
  mobileFriendlinessRating: a.designCritique?.mobileFriendlinessRating ?? undefined,
  criticalFlaws: a.designCritique?.criticalFlaws ?? [],
  quickWins: a.designCritique?.quickWins ?? [],
  colorPalette: {
    primary: a.extractedBrandTokens?.primaryColor || undefined,
    secondary: a.extractedBrandTokens?.secondaryColor || undefined,
    accent: a.extractedBrandTokens?.accentColor || undefined,
  },
  originalServiceCount: a.extractedServices?.length ?? a.extractedContent?.serviceItems?.length ?? undefined,
});
