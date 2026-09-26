import {
  DiscoveryCandidateStatus,
  DiscoveryProvider,
  IDiscoveredBusiness,
  IDiscoveryCandidate,
  IDiscoveryJobData,
  IDiscoveryJobResult,
  NicheType,
} from '@revamp/shared-types';
import { DiscoveredBusinessSchema } from '@revamp/validation';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { OsmDiscoveryProvider } from './osm-discovery.provider.js';
import { GooglePlacesProvider } from './google-places.provider.js';

export type FetchFn = typeof fetch;

export interface DiscoverySearchParams {
  niche: NicheType;
  location: string;
  keyword?: string;
  /** Upper bound on listings to fetch from the provider */
  maxResults: number;
}

export interface DiscoveryProviderClient {
  search(params: DiscoverySearchParams): Promise<IDiscoveredBusiness[]>;
}

// Hosts that are profiles or directories rather than the business's own site
const NON_AUDITABLE_HOSTS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
  'vk.com',
  'ok.ru',
  't.me',
  'wa.me',
  'linktr.ee',
  'google.com',
  'goo.gl',
  'booksy.com',
  'yelp.com',
  'tripadvisor.com',
];

export function createDiscoveryProvider(provider: DiscoveryProvider): DiscoveryProviderClient {
  switch (provider) {
    case 'osm':
      return new OsmDiscoveryProvider({
        overpassUrl: env.OVERPASS_URL,
        nominatimUrl: env.NOMINATIM_URL,
        userAgent: env.DISCOVERY_USER_AGENT,
      });
    case 'google':
      return new GooglePlacesProvider({ apiKey: env.GOOGLE_PLACES_API_KEY });
    default:
      throw new Error(`Unknown discovery provider: ${provider as string}`);
  }
}

/**
 * Normalises a listing's website to an absolute http(s) URL and its bare domain.
 * Returns null when the site is missing, malformed, or a social/directory profile.
 */
export function normalizeWebsite(raw?: string): { url: string; domain: string } | null {
  if (!raw) return null;
  let value = raw.trim().split(/[\s;]+/)[0] ?? '';
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) return null;

  const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const isProfile = NON_AUDITABLE_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`));
  if (isProfile) return null;

  parsed.hash = '';
  return { url: parsed.toString(), domain };
}

/** Drops optional fields that would fail the Lead model's limits instead of rejecting the listing */
function sanitize(business: IDiscoveredBusiness, website: string): IDiscoveredBusiness {
  const phone = business.phone?.trim();
  const email = business.email?.trim().toLowerCase();
  return {
    ...business,
    website,
    phone: phone && phone.length <= 30 ? phone : undefined,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    address: business.address?.slice(0, 200),
    city: business.city?.slice(0, 100),
  };
}

/**
 * Searches a maps provider and classifies every listing for operator review. Nothing is imported
 * here: the operator picks which `new` businesses become leads (POST /discovery/:jobId/import).
 */
export async function runDiscovery(
  data: IDiscoveryJobData,
  provider: DiscoveryProviderClient = createDiscoveryProvider(data.provider),
): Promise<IDiscoveryJobResult> {
  const businesses = await provider.search({
    niche: data.niche,
    location: data.location,
    keyword: data.keyword,
    // Many listings are skipped as duplicates or lacking a site, so over-fetch
    maxResults: Math.min(data.limit * 3, 300),
  });

  // 1. Normalise, validate, and dedupe within the batch, keeping the provider's order
  const candidates: IDiscoveryCandidate[] = [];
  const seenDomains = new Set<string>();
  for (const business of businesses) {
    const base = {
      provider: business.provider,
      externalId: business.externalId,
      name: business.name.slice(0, 100),
      city: business.city?.slice(0, 100),
    };
    const site = normalizeWebsite(business.website);
    if (!site) {
      candidates.push({ ...base, status: 'no_website', phone: business.phone, address: business.address });
      continue;
    }
    const parsed = DiscoveredBusinessSchema.safeParse(sanitize(business, site.url));
    if (!parsed.success) {
      candidates.push({ ...base, status: 'invalid', website: site.url, domain: site.domain });
      continue;
    }
    const { name, phone, email, address, city } = parsed.data;
    const status = seenDomains.has(site.domain) ? 'duplicate' : 'new';
    seenDomains.add(site.domain);
    candidates.push({ ...base, name, phone, email, address, city, website: site.url, domain: site.domain, status });
  }

  // 2. Mark domains that are already leads
  const existing = (await Lead.find({ domain: { $in: [...seenDomains] } }, { domain: 1 })
    .lean()
    .exec()) as Array<{ _id: unknown; domain?: string }>;
  const leadIdByDomain = new Map(existing.map((lead) => [lead.domain, String(lead._id)]));
  for (const candidate of candidates) {
    const leadId = candidate.status === 'new' && candidate.domain ? leadIdByDomain.get(candidate.domain) : undefined;
    if (leadId) Object.assign(candidate, { status: 'existing_lead', leadId });
  }

  // 3. Offer at most `limit` new businesses; skipped listings are all kept so the operator sees why
  let offered = 0;
  const limited = candidates.filter((c) => c.status !== 'new' || ++offered <= data.limit);

  return { found: businesses.length, candidates: limited };
}

/** Counts candidates per status, for logs and summaries */
export function countByStatus(candidates: IDiscoveryCandidate[]): Record<DiscoveryCandidateStatus, number> {
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
