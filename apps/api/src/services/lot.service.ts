import mongoose from 'mongoose';
import type { ILotPriceSignal } from '@revamp/shared-types';
import {
  LOT_ADMIN_OPENABLE,
  lotBandFromNeed,
  lotStatusesInto,
  normalizeDomain,
  priceFromAudit,
  type CreatePlatformAuditInput,
} from '@revamp/validation';
import type { LotStatus } from '@revamp/shared-types';
import { LotError, createLot, createPlatformAudit, transitionLot } from '@revamp/db';
import { lotPriceSettings } from '../config/env.js';
import { AppError } from '../middlewares/errorHandler.js';
import { Audit } from '../models/Audit.model.js';
import { Lot } from '../models/Lot.model.js';
import { addPlatformAuditJob } from '../queues/audit.queue.js';
import { redisConnection } from '../queues/connection.js';
import { AUDIT_ENQUEUE_TIMEOUT_MS } from './audit-enqueue.js';
import { withTimeout } from './with-timeout.js';

// REV-232: platform audits and lots. Platform-owned records: no studio scope, admin routes only.

export const PLATFORM_AUDIT_QUEUE_ERROR = 'Could not queue the audit';

/**
 * Audits a business no studio owns yet. The business is found or created by its domain; an existing COMPLETED audit
 * or a platform audit already waiting is returned as it is and queues nothing. A new audit is queued with the same
 * timeout as a lead audit; when the queue fails the audit is marked FAILED and the answer is 503.
 */
export async function requestPlatformAudit(dto: CreatePlatformAuditInput, timeoutMs: number = AUDIT_ENQUEUE_TIMEOUT_MS) {
  let domain: string | undefined;
  try {
    domain = normalizeDomain(new URL(dto.url).hostname);
  } catch {
    domain = undefined;
  }
  if (!domain) throw new AppError(400, 'VALIDATION_ERROR', 'The URL is not valid');
  const { business, audit, queued } = await createPlatformAudit({
    domain,
    originalUrl: dto.url,
    businessName: dto.businessName,
    niche: dto.niche,
    city: dto.city,
  });
  const auditId = String(audit._id);
  const businessId = String(business._id);

  if (queued) {
    try {
      if (redisConnection.status !== 'ready') throw new Error(`Redis is ${redisConnection.status}`);
      await withTimeout(addPlatformAuditJob({ auditId, businessId, url: business.originalUrl, niche: business.niche }), timeoutMs, 'Audit queue');
    } catch (queueError) {
      console.error(`[AuditQueue] Could not queue the platform audit of business ${businessId}:`, queueError);
      try {
        await Audit.updateOne({ _id: auditId, status: 'QUEUED' }, { $set: { status: 'FAILED', errorMessage: PLATFORM_AUDIT_QUEUE_ERROR } }).exec();
      } catch (updateError) {
        console.error(`[AuditQueue] Could not mark platform audit ${auditId} as failed:`, updateError);
      }
      throw new AppError(503, 'AUDIT_QUEUE_UNAVAILABLE', 'The audit could not be queued; try again', { auditId });
    }
  }
  return { auditId, businessId, status: audit.status, queued };
}

/** A platform audit by id; an unknown id and an audit that a studio's lead ran answer the same 404 */
export async function getPlatformAudit(id: string) {
  const audit = mongoose.isValidObjectId(id)
    ? await Audit.findOne({ _id: id, leadId: { $exists: false } }).lean().exec()
    : null;
  if (!audit) throw new AppError(404, 'PLATFORM_AUDIT_NOT_FOUND', 'Platform audit not found');
  return {
    auditId: String(audit._id),
    businessId: audit.businessId ? String(audit.businessId) : undefined,
    status: audit.status,
    scores: audit.scores,
    measurementErrors: audit.measurementErrors ?? [],
    completedAt: audit.completedAt,
    ...(audit.errorMessage ? { errorMessage: audit.errorMessage } : {}),
  };
}

/**
 * A DRAFT lot for a business from its newest COMPLETED audit (a lead's or the platform's: the audit is shared). The
 * price and band come from `priceFromAudit` and `lotBandFromNeed`, never from a model; an audit that measured no
 * price signal is not priceable (409).
 */
export async function createLotForBusiness(businessId: string) {
  const audit = await Audit.findOne({ businessId, status: 'COMPLETED' }).sort({ createdAt: -1 }).lean().exec();
  if (!audit) throw new AppError(409, 'NO_COMPLETED_PLATFORM_AUDIT', 'The business has no completed audit');
  const price = priceFromAudit(audit, lotPriceSettings);
  const band = lotBandFromNeed(price.need);
  if (price.need === null || !band) throw new AppError(409, 'LOT_NOT_PRICEABLE', 'The audit measured no price signal');
  try {
    return await createLot({
      businessId,
      auditId: audit._id,
      price: {
        amountCents: price.amountCents,
        currency: price.currency,
        need: price.need,
        band,
        signals: price.signals as ILotPriceSignal[],
      },
    });
  } catch (error) {
    if (error instanceof LotError) throw new AppError(409, error.code, error.message);
    throw error;
  }
}

async function notFoundOrNotAllowed(id: string): Promise<AppError> {
  const exists = mongoose.isValidObjectId(id) && (await Lot.exists({ _id: id }));
  return exists
    ? new AppError(409, 'LOT_TRANSITION_NOT_ALLOWED', 'The lot is not in a status that allows this change')
    : new AppError(404, 'LOT_NOT_FOUND', 'Lot not found');
}

/** DRAFT to OPEN; `releaseAt` defaults to now */
export async function openLot(id: string, releaseAt?: string) {
  if (!mongoose.isValidObjectId(id)) throw await notFoundOrNotAllowed(id);
  const lot = await transitionLot(id, 'OPEN', {
    allowedFrom: LOT_ADMIN_OPENABLE,
    set: { releaseAt: releaseAt ? new Date(releaseAt) : new Date() },
  });
  if (!lot) throw await notFoundOrNotAllowed(id);
  return lot;
}

/** Any live lot to WITHDRAWN (reason `admin`) */
export async function withdrawLot(id: string) {
  if (!mongoose.isValidObjectId(id)) throw await notFoundOrNotAllowed(id);
  const lot = await transitionLot(id, 'WITHDRAWN', { allowedFrom: lotStatusesInto('WITHDRAWN'), set: { withdrawReason: 'admin' } });
  if (!lot) throw await notFoundOrNotAllowed(id);
  return lot;
}

export async function listLots(query: { status?: LotStatus; page: number; limit: number }) {
  const filter = query.status ? { status: query.status } : {};
  const [data, total] = await Promise.all([
    Lot.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean()
      .exec(),
    Lot.countDocuments(filter).exec(),
  ]);
  return { data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}
