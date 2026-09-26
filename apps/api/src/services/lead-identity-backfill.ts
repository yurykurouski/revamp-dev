import { DiscoveryProvider, IDiscoveryJobResult, LeadSource } from '@revamp/shared-types';
import { leadExternalId, normalizeDomain, normalizePhone } from '@revamp/validation';

/** The lead fields the REV-35 backfill reads */
export interface BackfillLead {
  _id: unknown;
  originalUrl?: string;
  domain?: string;
  contactPhone?: string;
  phoneE164?: string;
  source?: LeadSource;
  externalId?: string;
  tags?: string[];
}

/** Provider-qualified listing ids per `<provider>|<domain>`; null when several listings share the domain */
export type DiscoveredIdIndex = Map<string, string | null>;

const indexKey = (provider: string, domain: string) => `${provider}|${domain}`;

/**
 * Indexes the listings of finished discovery jobs by provider and domain, so a lead imported
 * before REV-35 can get back the listing id it came from. Ambiguous domains are not recovered.
 */
export function indexDiscoveredIds(results: Array<IDiscoveryJobResult | null | undefined>): DiscoveredIdIndex {
  const index: DiscoveredIdIndex = new Map();
  for (const result of results) {
    for (const candidate of result?.candidates ?? []) {
      const domain = normalizeDomain(candidate.domain);
      if (!domain) continue;
      const key = indexKey(candidate.provider, domain);
      const id = leadExternalId(candidate.provider, candidate.externalId);
      const known = index.get(key);
      index.set(key, known === undefined || known === id ? id : null);
    }
  }
  return index;
}

/** Discovery imports are tagged `source:<provider>` (REV-29) */
function sourceFromTags(tags: string[] = []): DiscoveryProvider | undefined {
  const tag = tags.find((t) => t === 'source:osm' || t === 'source:google');
  return tag?.slice('source:'.length) as DiscoveryProvider | undefined;
}

function domainOf(lead: BackfillLead): string | undefined {
  try {
    if (lead.originalUrl) return normalizeDomain(new URL(lead.originalUrl).hostname);
  } catch {
    // Fall back to the stored domain
  }
  return normalizeDomain(lead.domain);
}

/**
 * Fields to `$set` on one lead so older leads are matched like new ones: the normalised domain,
 * the E.164 phone, the source and, where discovery results still hold it, the listing id.
 * Returns null when the lead is already up to date.
 */
export function planLeadIdentityUpdate(lead: BackfillLead, discovered: DiscoveredIdIndex): Record<string, string> | null {
  const set: Record<string, string> = {};

  const domain = domainOf(lead);
  if (domain && domain !== lead.domain) set['domain'] = domain;

  const phoneE164 = normalizePhone(lead.contactPhone);
  if (phoneE164 && phoneE164 !== lead.phoneE164) set['phoneE164'] = phoneE164;

  const provider = sourceFromTags(lead.tags);
  const source: LeadSource = lead.source ?? provider ?? 'manual';
  if (source !== lead.source) set['source'] = source;

  if (!lead.externalId && provider && domain) {
    const externalId = discovered.get(indexKey(provider, domain));
    if (externalId) set['externalId'] = externalId;
  }

  return Object.keys(set).length > 0 ? set : null;
}
