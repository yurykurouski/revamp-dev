import type { Types } from 'mongoose';
import type { IContactRightView } from '@revamp/shared-types';
import type { IContactRightDocument } from '../models/ContactRight.model.js';
import type { TenantScope } from './tenant-scope.js';

// REV-226: the studio's contact right for a business, read through the tenant scope (the registry's own functions in
// `@revamp/db` take a tenant id and are for the workers and scripts).

type BusinessId = Types.ObjectId | string | undefined;

/** The studio's right that is active at `now` (granted, not expired, not ended); a lead without a business has none */
export async function activeContactRight(scope: TenantScope, businessId: BusinessId, now: Date = new Date()): Promise<IContactRightDocument | null> {
  if (!businessId) return null;
  return scope.rights
    .findOne({ businessId, grantedAt: { $lte: now }, expiresAt: { $gt: now }, endedAt: { $exists: false } })
    .sort({ grantedAt: -1 })
    .exec();
}

/** The studio's newest right for the business, active or not, for the date an error reports */
export async function latestContactRight(scope: TenantScope, businessId: BusinessId): Promise<IContactRightDocument | null> {
  if (!businessId) return null;
  return scope.rights.findOne({ businessId }).sort({ grantedAt: -1 }).exec();
}

/** What the dashboard may see of a right: the same "active" rule as `activeContactRight`, evaluated at `now` (REV-228) */
export function toContactRightView(
  right: Pick<IContactRightDocument, 'grantedAt' | 'expiresAt' | 'endedAt' | 'endReason'>,
  now: Date = new Date(),
): IContactRightView {
  const active = right.grantedAt <= now && right.expiresAt > now && !right.endedAt;
  return {
    expiresAt: right.expiresAt.toISOString(),
    active,
    ...(right.endedAt ? { endedAt: right.endedAt.toISOString() } : {}),
    ...(right.endReason ? { endReason: right.endReason } : {}),
  };
}

/** The studio's newest right per business, read in one query (REV-228); a business without one is absent from the map */
export async function contactRightViews(scope: TenantScope, businessIds: Array<Types.ObjectId | string>, now: Date = new Date()): Promise<Map<string, IContactRightView>> {
  const views = new Map<string, IContactRightView>();
  if (businessIds.length === 0) return views;
  const rights = await scope.rights.find({ businessId: { $in: businessIds } }).sort({ grantedAt: -1 }).lean().exec();
  for (const right of rights) {
    const key = right.businessId.toString();
    if (!views.has(key)) views.set(key, toContactRightView(right, now));
  }
  return views;
}
