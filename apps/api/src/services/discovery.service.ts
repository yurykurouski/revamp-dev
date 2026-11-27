import {
  ImportDiscoveryDto,
  LEAD_IDENTITY_PROJECTION,
  LeadIdentity,
  ReverseGeocodeQuery,
  StartDiscoveryDto,
  createLeadMatcher,
  leadExternalId,
  leadMatchFilter,
  leadMatchKeys,
} from '@revamp/validation';
import { contactAvailabilityByDomain, type ContactAvailability } from '@revamp/db';
import {
  EMAIL_GUESSED_TAG,
  type DiscoveryImportOutcome,
  DiscoveryJobState,
  IDiscoveryCandidate,
  IDiscoveryJobData,
  IDiscoveryImportResult,
  IDiscoveryJobResult,
  IDiscoveryJobStatus,
  IReverseGeocodeResult,
} from '@revamp/shared-types';
import { env } from '../config/env.js';
import { addDiscoveryJob, getDiscoveryJob } from '../queues/discovery.queue.js';
import { AppError } from '../middlewares/errorHandler.js';
import { tenantIdOf, type TenantScope } from '../data/tenant-scope.js';
import { LeadService } from './lead.service.js';


/**
 * Finds which candidates are already leads, matching on the provider id, domain and phone.
 * Returns the matching lead id per candidate externalId. Only the studio's own leads count (REV-209): a site another
 * studio has is still new here.
 */
async function findExistingLeadIds(scope: TenantScope, candidates: IDiscoveryCandidate[]): Promise<Map<string, string>> {
  const keyed = candidates.map((c) => ({ externalId: c.externalId, keys: leadMatchKeys(c) }));
  const filter = leadMatchFilter(keyed.map((k) => k.keys));
  if (!filter) return new Map();

  const leads = (await scope.leads.find(filter, LEAD_IDENTITY_PROJECTION).lean().exec()) as LeadIdentity[];
  const match = createLeadMatcher(leads);
  const result = new Map<string, string>();
  for (const { externalId, keys } of keyed) {
    const leadId = match(keys);
    if (leadId) result.set(externalId, leadId);
  }
  return result;
}

/**
 * REV-225: which of these candidates the studio cannot claim, by domain. Reads the shared business and the suppressed
 * addresses (reason and date only, never who holds it). The address checked is the candidate's own or the `info@`
 * guess the import would use.
 */
async function findUnavailable(candidates: IDiscoveryCandidate[]): Promise<Map<string, ContactAvailability>> {
  const items = candidates.filter((c) => c.domain).map((c) => ({ domain: c.domain!, email: c.email ?? `info@${c.domain}` }));
  return contactAvailabilityByDomain(items);
}

const UNAVAILABLE_OUTCOME: Record<ContactAvailability['reason'], DiscoveryImportOutcome> = {
  held: 'right_held',
  cooldown: 'cooldown',
  opted_out: 'opted_out',
};
/** `createLead` answers a refused right with one of these codes (a race after the read) */
const REFUSAL_OUTCOME: Record<string, DiscoveryImportOutcome> = {
  CONTACT_RIGHT_HELD: 'right_held',
  BUSINESS_IN_COOLDOWN: 'cooldown',
  BUSINESS_OPTED_OUT: 'opted_out',
};

/** A search belongs to the studio that started it; another studio's job answers like a missing one (REV-209) */
async function getOwnedJob(scope: TenantScope, jobId: string) {
  const job = await getDiscoveryJob(jobId);
  const owner = job?.data.tenantId;
  if (!job || !owner || !scope.tenantId || owner !== scope.tenantId.toString()) {
    throw new AppError(404, 'DISCOVERY_JOB_NOT_FOUND', 'Discovery job not found');
  }
  return job;
}

/** The search parameters without the studio, which the caller already knows */
const publicParams = ({ tenantId: _tenantId, ...params }: IDiscoveryJobData): IDiscoveryJobData => params;

interface NominatimReverseResponse {
  error?: string;
  address?: Record<string, string | undefined>;
}

// Most specific settlement first; Nominatim uses different keys depending on its size
const SETTLEMENT_KEYS = ['city', 'town', 'village', 'municipality', 'county', 'state'] as const;

export class DiscoveryService {
  /**
   * Enqueues a maps-provider search; the operator reviews its results before importing any
   */
  static async startDiscovery(scope: TenantScope, dto: StartDiscoveryDto) {
    const job = await addDiscoveryJob({
      ...(scope.tenantId ? { tenantId: scope.tenantId.toString() } : {}),
      provider: dto.provider,
      niche: dto.niche,
      location: dto.location,
      keyword: dto.keyword,
      limit: dto.limit,
      ...(dto.excludeDomains?.length ? { excludeDomains: dto.excludeDomains } : {}),
    });
    return { jobId: job.id as string, params: publicParams(job.data) };
  }

  /**
   * Returns the state of a discovery job and, once finished, its import summary
   */
  static async getDiscoveryStatus(scope: TenantScope, jobId: string): Promise<IDiscoveryJobStatus> {
    const job = await getOwnedJob(scope, jobId);

    const state = (await job.getState()) as DiscoveryJobState;
    return {
      jobId: job.id as string,
      state,
      params: publicParams(job.data),
      result: await DiscoveryService.withCurrentLeads(scope, job.returnvalue ?? null),
      error: state === 'failed' ? job.failedReason ?? 'Unknown error' : null,
      attemptsMade: job.attemptsMade,
      createdAt: new Date(job.timestamp).toISOString(),
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }

  /**
   * Re-checks `new` candidates against current leads, so imported ones (or leads added since the
   * search) show as existing_lead
   */
  static async withCurrentLeads(scope: TenantScope, result: IDiscoveryJobResult | null): Promise<IDiscoveryJobResult | null> {
    // Jobs from before REV-29 have no candidate list
    if (!result || !Array.isArray(result.candidates)) return result;

    const leadIds = await findExistingLeadIds(scope, result.candidates.filter((c) => c.status === 'new'));
    const refreshed = result.candidates.map((c): IDiscoveryCandidate => {
      const leadId = c.status === 'new' ? leadIds.get(c.externalId) : undefined;
      return leadId ? { ...c, status: 'existing_lead', leadId } : c;
    });
    // REV-225: a candidate that is still new may be held by another studio, in cooldown or opted out
    const unavailable = await findUnavailable(refreshed.filter((c) => c.status === 'new'));
    const candidates = refreshed.map((c): IDiscoveryCandidate => {
      const why = c.status === 'new' && c.domain ? unavailable.get(c.domain.toLowerCase()) : undefined;
      return why ? { ...c, unavailable: { reason: why.reason, ...(why.until ? { until: why.until.toISOString() } : {}) } } : c;
    });
    // `counts` stays as the worker recorded it at search time
    return { ...result, candidates };
  }

  /**
   * Imports the operator's selection from a finished discovery job as QUEUED leads with audits.
   * Candidate data always comes from the job's stored result, never from the request.
   */
  static async importCandidates(scope: TenantScope, jobId: string, dto: ImportDiscoveryDto): Promise<IDiscoveryImportResult> {
    const job = await getOwnedJob(scope, jobId);
    if ((await job.getState()) !== 'completed') {
      throw new AppError(409, 'DISCOVERY_JOB_NOT_COMPLETED', 'Discovery job has not completed yet');
    }

    const byId = new Map((job.returnvalue?.candidates ?? []).map((c) => [c.externalId, c]));
    const selected = dto.externalIds.map((id) => byId.get(id));
    // Re-check at import time: a lead may have been added since the search
    const leadIds = await findExistingLeadIds(
      scope,
      selected.filter((c): c is IDiscoveryCandidate => c?.status === 'new'),
    );

    // REV-225: re-checked at import; the grant in the add-lead transaction is still the one rule
    const unavailable = await findUnavailable(selected.filter((c): c is IDiscoveryCandidate => c?.status === 'new' && !leadIds.has(c.externalId)));

    const results: IDiscoveryImportResult['results'] = [];
    // REV-202: once the audit queue is down, the rest are not created; each would wait out the timeout
    let queueDown = false;
    for (const [i, externalId] of dto.externalIds.entries()) {
      const candidate = selected[i];
      if (!candidate) {
        results.push({ externalId, outcome: 'not_found' });
        continue;
      }
      const existingLeadId = candidate.leadId ?? leadIds.get(candidate.externalId);
      if (candidate.status === 'existing_lead' || existingLeadId) {
        results.push({ externalId, outcome: 'existing_lead', leadId: existingLeadId });
        continue;
      }
      if (candidate.status !== 'new' || !candidate.website || !candidate.domain) {
        results.push({ externalId, outcome: 'not_importable' });
        continue;
      }

      const why = unavailable.get(candidate.domain.toLowerCase());
      if (why) {
        results.push({ externalId, outcome: UNAVAILABLE_OUTCOME[why.reason], ...(why.until ? { until: why.until.toISOString() } : {}) });
        continue;
      }

      if (queueDown) {
        results.push({ externalId, outcome: 'failed' });
        continue;
      }

      try {
        const tags = ['discovered', `source:${candidate.provider}`];
        if (!candidate.email) tags.push(EMAIL_GUESSED_TAG);
        const { lead } = await LeadService.createLead(
          {
            businessName: candidate.name,
            originalUrl: candidate.website,
            contactEmail: candidate.email ?? `info@${candidate.domain}`,
            niche: job.data.niche,
            city: candidate.city ?? job.data.location.slice(0, 100),
            contactPhone: candidate.phone,
            ...(dto.operatorLocale ? { operatorLocale: dto.operatorLocale } : {}),
          },
          {
            tags,
            source: candidate.provider,
            externalId: leadExternalId(candidate.provider, candidate.externalId),
            tenantId: tenantIdOf(scope),
          },
        );
        results.push({ externalId, outcome: 'imported', leadId: lead._id.toString() });
      } catch (error) {
        // This studio already has a lead for the site (REV-208): not a failure, the same as a known site
        if (error instanceof AppError && error.code === 'LEAD_ALREADY_EXISTS') {
          const leadId = (error.details as { leadId?: string } | undefined)?.leadId;
          results.push({ externalId, outcome: 'existing_lead', ...(leadId ? { leadId } : {}) });
          continue;
        }
        // The right was refused at the add, after the read above (REV-225): not a failure, and the loop goes on
        const refused = error instanceof AppError ? REFUSAL_OUTCOME[error.code] : undefined;
        if (refused) {
          const details = error instanceof AppError ? (error.details as { expiresAt?: string; availableAt?: string } | undefined) : undefined;
          const until = details?.expiresAt ?? details?.availableAt;
          results.push({ externalId, outcome: refused, ...(until ? { until } : {}) });
          continue;
        }
        console.error(`[Discovery] Failed to import ${candidate.name} (${candidate.domain}):`, error);
        if (error instanceof AppError && error.code === 'AUDIT_QUEUE_UNAVAILABLE') {
          // The lead was saved and is AUDIT_FAILED, so the operator can retry its audit
          queueDown = true;
          const leadId = (error.details as { leadId?: string } | undefined)?.leadId;
          results.push({ externalId, outcome: 'failed', ...(leadId ? { leadId } : {}) });
          continue;
        }
        results.push({ externalId, outcome: 'failed' });
      }
    }

    return { imported: results.filter((r) => r.outcome === 'imported').length, results };
  }

  /**
   * Resolves browser coordinates to a "City, Country" name for the discovery form.
   * Proxied through the API so Nominatim gets the identifying User-Agent its usage policy requires.
   */
  static async reverseGeocode(
    query: ReverseGeocodeQuery,
    fetchFn: typeof fetch = fetch,
  ): Promise<IReverseGeocodeResult> {
    const url = new URL(env.NOMINATIM_REVERSE_URL);
    url.searchParams.set('lat', String(query.lat));
    url.searchParams.set('lon', String(query.lng));
    url.searchParams.set('format', 'jsonv2');
    // City-level detail is enough and avoids returning the operator's street address
    url.searchParams.set('zoom', '10');
    if (query.lang) url.searchParams.set('accept-language', query.lang);

    let body: NominatimReverseResponse;
    try {
      const res = await fetchFn(url.toString(), {
        headers: { 'User-Agent': env.DISCOVERY_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = (await res.json()) as NominatimReverseResponse;
    } catch {
      throw new AppError(502, 'GEOCODING_UNAVAILABLE', 'Reverse geocoding service is unavailable');
    }

    const address = body.address ?? {};
    const city = SETTLEMENT_KEYS.map((key) => address[key]).find(Boolean);
    const country = address['country'];
    if (body.error || (!city && !country)) {
      throw new AppError(404, 'PLACE_NOT_FOUND', 'No place found at these coordinates');
    }

    return {
      location: [city, country].filter(Boolean).join(', '),
      city,
      country,
    };
  }
}
