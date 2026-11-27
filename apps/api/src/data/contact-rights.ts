import type { Types } from 'mongoose';
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
