import {
  DiscoveryProvider,
  IDiscoveredBusiness,
  IDiscoveryCandidate,
  IDiscoveryJobData,
  IDiscoveryJobResult,
  NicheType,
} from '@revamp/shared-types';
import {
  DiscoveredBusinessSchema,
  LEAD_IDENTITY_PROJECTION,
  LeadIdentity,
  countCandidatesByStatus,
  createLeadMatcher,
  leadMatchFilter,
  leadMatchKeys,
  normalizeDomain,
} from '@revamp/validation';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { OsmDiscoveryProvider } from './osm-discovery.provider.js';
import { GooglePlacesProvider } from './google-places.provider.js';

export type FetchFn = typeof fetch;

export interface DiscoverySearchParams {
  niche: NicheType;
  location: string;
  keyword?: string;
  /** Upper bound on listings to fetch in one provider request */
  maxResults: number;
}

export interface DiscoveryPage {
  businesses: IDiscoveredBusiness[];
  /** Opaque cursor for the next request; absent when the provider has nothing more for this search */
  nextCursor?: string;
}

export interface DiscoveryProviderClient {
  search(params: DiscoverySearchParams, cursor?: string): Promise<DiscoveryPage>;
}

export interface RunDiscoveryOptions {
  /** Hard cap on provider requests per job, which bounds API cost and fair-use load */
  maxRequests: number;
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

  const domain = normalizeDomain(parsed.hostname);
  if (!domain) return null;
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

/** Normalises, validates and classifies listings, deduping by domain against every listing seen so far */
function classify(businesses: IDiscoveredBusiness[], seenDomains: Set<string>): IDiscoveryCandidate[] {
  const candidates: IDiscoveryCandidate[] = [];
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
  return candidates;
}

/** Marks `new` candidates that are already leads, matching on provider id, then domain, then phone */
async function markExistingLeads(candidates: IDiscoveryCandidate[]): Promise<void> {
  const fresh = candidates.filter((c) => c.status === 'new').map((c) => ({ candidate: c, keys: leadMatchKeys(c) }));
  const filter = leadMatchFilter(fresh.map((f) => f.keys));
  if (!filter) return;

  const leads = (await Lead.find(filter, LEAD_IDENTITY_PROJECTION).lean().exec()) as LeadIdentity[];
  const match = createLeadMatcher(leads);
  for (const { candidate, keys } of fresh) {
    const leadId = match(keys);
    if (leadId) Object.assign(candidate, { status: 'existing_lead', leadId });
  }
}

/**
 * Searches a maps provider and classifies every listing for operator review. Nothing is imported
 * here: the operator picks which `new` businesses become leads (POST /discovery/:jobId/import).
 *
 * Businesses that are already leads don't count toward the limit, so the search keeps paging
 * through the provider until it has `limit` new ones, the provider runs out, or it hits the
 * request cap.
 */
export async function runDiscovery(
  data: IDiscoveryJobData,
  provider: DiscoveryProviderClient = createDiscoveryProvider(data.provider),
  options: RunDiscoveryOptions = { maxRequests: env.DISCOVERY_MAX_REQUESTS },
): Promise<IDiscoveryJobResult> {
  const params: DiscoverySearchParams = {
    niche: data.niche,
    location: data.location,
    keyword: data.keyword,
    // Many listings are skipped as duplicates or lacking a site, so over-fetch
    maxResults: Math.min(data.limit * 3, 300),
  };

  const candidates: IDiscoveryCandidate[] = [];
  const seenListings = new Set<string>();
  const seenDomains = new Set<string>();
  let newCount = 0;
  let requests = 0;
  let cursor: string | undefined;

  do {
    const page = await provider.search(params, cursor);
    requests++;
    cursor = page.nextCursor;

    // A wider follow-up request (OSM) returns the earlier listings again
    const fresh = page.businesses.filter((b) => !seenListings.has(b.externalId));
    for (const b of fresh) seenListings.add(b.externalId);

    const pageCandidates = classify(fresh, seenDomains);
    await markExistingLeads(pageCandidates);
    candidates.push(...pageCandidates);
    newCount += pageCandidates.filter((c) => c.status === 'new').length;
  } while (cursor && newCount < data.limit && requests < options.maxRequests);

  // Offer at most `limit` new businesses; skipped listings are all kept so the operator sees why
  let offered = 0;
  const limited = candidates.filter((c) => c.status !== 'new' || ++offered <= data.limit);

  return {
    found: seenListings.size,
    candidates: limited,
    counts: countCandidatesByStatus(limited),
    requests,
    exhausted: !cursor,
  };
}
