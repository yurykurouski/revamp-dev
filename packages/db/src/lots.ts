import mongoose, { Types } from 'mongoose';
import type { ILotPriceSignal, LotBandCode, LotStatus, LotWithdrawReason, NicheType } from '@revamp/shared-types';
import { Audit, type IAuditDocument } from './models/Audit.model.js';
import { Business, type IBusinessDocument } from './models/Business.model.js';
import { Lot, type ILotDocument } from './models/Lot.model.js';
import { upsertBusinessByDomain } from './add-lead-to-business.js';
import { retryOnDuplicateKey } from './retry-duplicate-key.js';

// REV-232: the platform audit of a business no studio owns yet, and the lots made from it.

export interface CreatePlatformAuditInput {
  /** Canonical domain (`normalizeDomain`) */
  domain: string;
  originalUrl: string;
  businessName: string;
  niche: NicheType;
  city: string;
}

export interface CreatePlatformAuditResult {
  business: IBusinessDocument;
  audit: IAuditDocument;
  /** A new QUEUED audit was written: the caller must queue the job. False when an audit already exists. */
  queued: boolean;
}

/**
 * Finds or creates the business and its platform audit in one transaction: a COMPLETED audit of the business
 * (any, the audit is shared) or a QUEUED/PROCESSING platform audit is returned as it is; otherwise a QUEUED audit
 * without `leadId` is created. A city is written only for a business that has none.
 */
export async function createPlatformAudit(input: CreatePlatformAuditInput): Promise<CreatePlatformAuditResult> {
  const domain = input.domain.toLowerCase();
  return retryOnDuplicateKey(async () => {
    let result: CreatePlatformAuditResult | undefined;
    await mongoose.connection.transaction(async (session) => {
      const business = await upsertBusinessByDomain(
        { domain, originalUrl: input.originalUrl, businessName: input.businessName, niche: input.niche, city: input.city },
        session,
      );
      if (!business.city) {
        await Business.updateOne({ _id: business._id, city: { $exists: false } }, { $set: { city: input.city } }, { session });
        business.city = input.city;
      }

      const completed = await Audit.findOne({ businessId: business._id, status: 'COMPLETED' }, null, { session }).sort({ createdAt: -1 });
      if (completed) {
        result = { business, audit: completed, queued: false };
        return;
      }
      const running = await Audit.findOne(
        { businessId: business._id, leadId: { $exists: false }, status: { $in: ['QUEUED', 'PROCESSING'] } },
        null,
        { session },
      ).sort({ createdAt: -1 });
      if (running) {
        result = { business, audit: running, queued: false };
        return;
      }
      const [audit] = await Audit.create([{ businessId: business._id, status: 'QUEUED' }], { session });
      result = { business, audit: audit!, queued: true };
    });
    return result!;
  });
}

export type LotErrorCode = 'LOT_NOT_ELIGIBLE' | 'LOT_ALREADY_LIVE' | 'NO_COMPLETED_PLATFORM_AUDIT';

export class LotError extends Error {
  constructor(
    readonly code: LotErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'LotError';
  }
}

/** The price of a lot as `priceFromAudit` and `lotBandFromNeed` (`@revamp/validation`) computed it; passed in by the API */
export interface LotPriceInput {
  amountCents: number;
  currency: string;
  need: number;
  band: LotBandCode;
  signals: ILotPriceSignal[];
}

export interface CreateLotInput {
  businessId: Types.ObjectId | string;
  auditId: Types.ObjectId | string;
  price: LotPriceInput;
  now?: Date;
}

/**
 * Creates a DRAFT lot for a business. Refused with `LotError`: the business is missing, opted out, held or in
 * cooldown (`contactHold.cooldownUntil` in the future), or has no city (`LOT_NOT_ELIGIBLE`); it already has a live
 * lot (`LOT_ALREADY_LIVE`, decided by the unique index, so concurrent calls have one winner). Niche and city are
 * copied from the business.
 */
export async function createLot(input: CreateLotInput): Promise<ILotDocument> {
  const now = input.now ?? new Date();
  const business = await Business.findById(input.businessId).lean();
  if (!business) throw new LotError('LOT_NOT_ELIGIBLE', 'The business does not exist');
  if (business.optedOutAt) throw new LotError('LOT_NOT_ELIGIBLE', 'The business asked not to be contacted');
  if (business.contactHold && business.contactHold.cooldownUntil.getTime() > now.getTime()) {
    throw new LotError('LOT_NOT_ELIGIBLE', 'The business is held by a studio or in cooldown');
  }
  if (!business.city) throw new LotError('LOT_NOT_ELIGIBLE', 'The business has no city');

  try {
    return await Lot.create({
      businessId: business._id,
      auditId: input.auditId,
      niche: business.niche,
      city: business.city,
      priceCents: input.price.amountCents,
      currency: input.price.currency,
      band: input.price.band,
      need: input.price.need,
      priceSignals: input.price.signals,
      status: 'DRAFT',
      live: true,
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 11000) throw new LotError('LOT_ALREADY_LIVE', 'The business already has a live lot');
    throw error;
  }
}

export interface TransitionLotOptions {
  /** The statuses the lot may move from: `lotStatusesInto(to)` (`@revamp/validation`), or fewer for one route */
  allowedFrom: readonly LotStatus[];
  set?: { releaseAt?: Date; withdrawReason?: LotWithdrawReason };
  now?: Date;
}

/**
 * Moves a lot to `to` with one atomic filter on the allowed source statuses; `null` when the lot is missing or in
 * another status (nothing is written). SOLD and WITHDRAWN free the business's live-lot slot.
 */
export async function transitionLot(
  lotId: Types.ObjectId | string,
  to: LotStatus,
  options: TransitionLotOptions,
): Promise<ILotDocument | null> {
  const now = options.now ?? new Date();
  const $set: Record<string, unknown> = { status: to };
  if (options.set?.releaseAt) $set['releaseAt'] = options.set.releaseAt;
  const $unset: Record<string, ''> = {};
  if (to === 'SOLD' || to === 'WITHDRAWN') $unset['live'] = '';
  if (to === 'WITHDRAWN') {
    $set['withdrawnAt'] = now;
    if (options.set?.withdrawReason) $set['withdrawReason'] = options.set.withdrawReason;
  }
  return Lot.findOneAndUpdate(
    { _id: lotId, status: { $in: [...options.allowedFrom] } },
    { $set, ...(Object.keys($unset).length > 0 ? { $unset } : {}) },
    { new: true },
  );
}
