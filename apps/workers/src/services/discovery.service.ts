import {
  DiscoveryProvider,
  IDiscoveredBusiness,
  IDiscoveryJobData,
  IDiscoveryJobResult,
  NicheType,
} from '@revamp/shared-types';
import { DiscoveredBusinessSchema } from '@revamp/validation';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { addAuditJob } from '../queues/audit.queue.js';
import { OsmDiscoveryProvider } from './osm-discovery.provider.js';
import { GooglePlacesProvider } from './google-places.provider.js';
import { EMAIL_GUESSED_TAG } from './discovery.constants.js';

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
 * Searches a maps provider and imports businesses with their own website as QUEUED leads,
 * each with an Audit record and an audit job. The pipeline still halts at NEEDS_APPROVAL (HITL).
 */
export async function runDiscovery(
  data: IDiscoveryJobData,
  provider: DiscoveryProviderClient = createDiscoveryProvider(data.provider),
): Promise<IDiscoveryJobResult> {
  const businesses = await provider.search({
    niche: data.niche,
    location: data.location,
    keyword: data.keyword,
    // Many listings are dropped as duplicates or lacking a site, so over-fetch
    maxResults: Math.min(data.limit * 3, 300),
  });

  const result: IDiscoveryJobResult = {
    found: businesses.length,
    created: 0,
    skippedNoWebsite: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    leadIds: [],
  };

  // 1. Normalise, validate, and dedupe within the batch
  const candidates = new Map<string, IDiscoveredBusiness & { website: string }>();
  for (const business of businesses) {
    const site = normalizeWebsite(business.website);
    if (!site) {
      result.skippedNoWebsite++;
      continue;
    }
    const parsed = DiscoveredBusinessSchema.safeParse(sanitize(business, site.url));
    if (!parsed.success) {
      result.skippedInvalid++;
      continue;
    }
    if (candidates.has(site.domain)) {
      result.skippedDuplicate++;
      continue;
    }
    candidates.set(site.domain, { ...parsed.data, website: site.url });
  }

  // 2. Skip domains that are already leads
  const existing = await Lead.find({ domain: { $in: [...candidates.keys()] } }, { domain: 1 })
    .lean()
    .exec();
  for (const lead of existing as Array<{ domain?: string }>) {
    if (lead.domain && candidates.delete(lead.domain)) result.skippedDuplicate++;
  }

  // 3. Create leads and dispatch audits
  for (const [domain, business] of candidates) {
    if (result.created >= data.limit) break;
    try {
      const tags = ['discovered', `source:${data.provider}`];
      if (!business.email) tags.push(EMAIL_GUESSED_TAG);

      const lead = await Lead.create({
        businessName: business.name,
        originalUrl: business.website,
        domain,
        niche: data.niche,
        city: business.city ?? data.location.slice(0, 100),
        contactEmail: business.email ?? `info@${domain}`,
        contactPhone: business.phone,
        status: 'QUEUED',
        tags,
      });
      await Audit.create({ leadId: lead._id, status: 'QUEUED' });
      await addAuditJob({ leadId: lead._id.toString(), url: business.website, niche: data.niche });

      result.created++;
      result.leadIds.push(lead._id.toString());
    } catch (error) {
      console.error(`[Discovery] Failed to import ${business.name} (${domain}):`, error);
      result.skippedInvalid++;
    }
  }

  return result;
}
