import type { ContactRightRefusal } from '@revamp/shared-types';
import { hashAddress } from './address-hash.js';
import { Business } from './models/Business.model.js';
import { SuppressedAddress } from './models/SuppressedAddress.model.js';

/**
 * REV-225: which businesses a studio cannot claim right now, read in bulk for the discovery candidates. It applies the
 * same order as `grantContactRight` (opted out, then held, then cooldown) but only reads, so the answer can be stale by
 * the time of the import; the grant in the add-lead transaction stays the one rule. It returns the reason and the date,
 * never which studio holds the business.
 */
export interface ContactAvailability {
  reason: ContactRightRefusal;
  /** `expiresAt` of the right (held) or `availableAt` (cooldown); none for an opt-out */
  until?: Date;
}

/** Only the unavailable domains are in the map; a free or unknown domain is absent */
export async function contactAvailabilityByDomain(
  items: Array<{ domain: string; email?: string }>,
  now: Date = new Date(),
): Promise<Map<string, ContactAvailability>> {
  const result = new Map<string, ContactAvailability>();
  const domains = [...new Set(items.map((item) => item.domain.toLowerCase()))];
  if (domains.length === 0) return result;

  const hashes = [...new Set(items.filter((item) => item.email).map((item) => hashAddress(item.email!)))];
  const [businesses, suppressed] = await Promise.all([
    Business.find({ domain: { $in: domains } }, { domain: 1, contactHold: 1, optedOutAt: 1 }).lean(),
    hashes.length > 0 ? SuppressedAddress.find({ hash: { $in: hashes } }, { hash: 1 }).lean() : Promise.resolve([]),
  ]);
  const suppressedHashes = new Set(suppressed.map((row) => row.hash));
  const byDomain = new Map(businesses.map((business) => [business.domain, business]));

  for (const item of items) {
    const domain = item.domain.toLowerCase();
    const business = byDomain.get(domain);
    if (business?.optedOutAt || (item.email && suppressedHashes.has(hashAddress(item.email)))) {
      result.set(domain, { reason: 'opted_out' });
      continue;
    }
    const hold = business?.contactHold;
    if (hold && now < hold.expiresAt) result.set(domain, { reason: 'held', until: hold.expiresAt });
    else if (hold && now < hold.cooldownUntil) result.set(domain, { reason: 'cooldown', until: hold.cooldownUntil });
  }
  return result;
}
