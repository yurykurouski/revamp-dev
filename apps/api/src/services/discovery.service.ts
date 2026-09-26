import { ReverseGeocodeQuery, StartDiscoveryDto } from '@revamp/validation';
import { DiscoveryJobState, IDiscoveryJobStatus, IReverseGeocodeResult } from '@revamp/shared-types';
import { env } from '../config/env.js';
import { addDiscoveryJob, getDiscoveryJob } from '../queues/discovery.queue.js';
import { AppError } from '../middlewares/errorHandler.js';

interface NominatimReverseResponse {
  error?: string;
  address?: Record<string, string | undefined>;
}

// Most specific settlement first; Nominatim uses different keys depending on its size
const SETTLEMENT_KEYS = ['city', 'town', 'village', 'municipality', 'county', 'state'] as const;

export class DiscoveryService {
  /**
   * Enqueues a maps-provider search; the discovery worker imports results as QUEUED leads
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
      result: job.returnvalue ?? null,
      error: state === 'failed' ? job.failedReason ?? 'Unknown error' : null,
      attemptsMade: job.attemptsMade,
      createdAt: new Date(job.timestamp).toISOString(),
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
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
