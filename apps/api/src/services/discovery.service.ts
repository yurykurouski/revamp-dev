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
import {
  DiscoveryJobState,
  IDiscoveryCandidate,
  IDiscoveryImportResult,
  IDiscoveryJobResult,
  IDiscoveryJobStatus,
  IReverseGeocodeResult,
} from '@revamp/shared-types';
import { env } from '../config/env.js';
import { addDiscoveryJob, getDiscoveryJob } from '../queues/discovery.queue.js';
import { AppError } from '../middlewares/errorHandler.js';
import { Lead } from '../models/Lead.model.js';
import { LeadService } from './lead.service.js';

/** Must match the workers' EMAIL_GUESSED_TAG: the audit swaps the guessed email for the site's own */
const EMAIL_GUESSED_TAG = 'email-guessed';

/**
 * Finds which candidates are already leads, matching on the provider id, domain and phone.
 * Returns the matching lead id per candidate externalId.
 */
async function findExistingLeadIds(candidates: IDiscoveryCandidate[]): Promise<Map<string, string>> {
  const keyed = candidates.map((c) => ({ externalId: c.externalId, keys: leadMatchKeys(c) }));
  const filter = leadMatchFilter(keyed.map((k) => k.keys));
  if (!filter) return new Map();

  const leads = (await Lead.find(filter, LEAD_IDENTITY_PROJECTION).lean().exec()) as LeadIdentity[];
  const match = createLeadMatcher(leads);
  const result = new Map<string, string>();
  for (const { externalId, keys } of keyed) {
    const leadId = match(keys);
    if (leadId) result.set(externalId, leadId);
  }
  return result;
}

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
  static async startDiscovery(dto: StartDiscoveryDto) {
    const job = await addDiscoveryJob({
      provider: dto.provider,
      niche: dto.niche,
      location: dto.location,
      keyword: dto.keyword,
      limit: dto.limit,
    });
    return { jobId: job.id as string, params: job.data };
  }

  /**
   * Returns the state of a discovery job and, once finished, its import summary
   */
  static async getDiscoveryStatus(jobId: string): Promise<IDiscoveryJobStatus> {
    const job = await getDiscoveryJob(jobId);
    if (!job) {
      throw new AppError('Discovery job not found', 404);
    }

    const state = (await job.getState()) as DiscoveryJobState;
    return {
      jobId: job.id as string,
      state,
      params: job.data,
      result: await DiscoveryService.withCurrentLeads(job.returnvalue ?? null),
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
  static async withCurrentLeads(result: IDiscoveryJobResult | null): Promise<IDiscoveryJobResult | null> {
    // Jobs from before REV-29 have no candidate list
    if (!result || !Array.isArray(result.candidates)) return result;

    const leadIds = await findExistingLeadIds(result.candidates.filter((c) => c.status === 'new'));
    const candidates = result.candidates.map((c): IDiscoveryCandidate => {
      const leadId = c.status === 'new' ? leadIds.get(c.externalId) : undefined;
      return leadId ? { ...c, status: 'existing_lead', leadId } : c;
    });
    // `counts` stays as the worker recorded it at search time
    return { ...result, candidates };
  }

  /**
   * Imports the operator's selection from a finished discovery job as QUEUED leads with audits.
   * Candidate data always comes from the job's stored result, never from the request.
   */
  static async importCandidates(jobId: string, dto: ImportDiscoveryDto): Promise<IDiscoveryImportResult> {
    const job = await getDiscoveryJob(jobId);
    if (!job) {
      throw new AppError('Discovery job not found', 404);
    }
    if ((await job.getState()) !== 'completed') {
      throw new AppError('Discovery job has not completed yet', 409);
    }

    const byId = new Map((job.returnvalue?.candidates ?? []).map((c) => [c.externalId, c]));
    const selected = dto.externalIds.map((id) => byId.get(id));
    // Re-check at import time: a lead may have been added since the search
    const leadIds = await findExistingLeadIds(
      selected.filter((c): c is IDiscoveryCandidate => c?.status === 'new'),
    );

    const results: IDiscoveryImportResult['results'] = [];
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
          },
          { tags, source: candidate.provider, externalId: leadExternalId(candidate.provider, candidate.externalId) },
        );
        results.push({ externalId, outcome: 'imported', leadId: lead._id.toString() });
      } catch (error) {
        console.error(`[Discovery] Failed to import ${candidate.name} (${candidate.domain}):`, error);
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
      throw new AppError('Reverse geocoding service is unavailable', 502);
    }

    const address = body.address ?? {};
    const city = SETTLEMENT_KEYS.map((key) => address[key]).find(Boolean);
    const country = address['country'];
    if (body.error || (!city && !country)) {
      throw new AppError('No place found at these coordinates', 404);
    }

    return {
      location: [city, country].filter(Boolean).join(', '),
      city,
      country,
    };
  }
}
