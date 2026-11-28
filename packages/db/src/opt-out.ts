import mongoose, { Types, type ClientSession } from 'mongoose';
import type { LeadStatus, LotStatus } from '@revamp/shared-types';
import { hashAddress } from './address-hash.js';
import { endContactRight } from './contact-rights.js';
import { Business } from './models/Business.model.js';
import { ContactRight } from './models/ContactRight.model.js';
import { EmailCampaign } from './models/EmailCampaign.model.js';
import { Lead } from './models/Lead.model.js';
import { Lot } from './models/Lot.model.js';
import { SuppressedAddress } from './models/SuppressedAddress.model.js';

/**
 * REV-227: an opt-out blocks every studio. `recordBusinessOptOut` is the one place allowed to write other studios'
 * leads and campaigns for an opt-out, and it does so in one transaction. It is idempotent: a repeat (also after a first
 * call that was interrupted) completes what is missing and reports zeros for what is already done.
 *
 * `@revamp/db` does not depend on `@revamp/validation`, so the caller passes the statuses that may move into
 * `UNSUBSCRIBED` (`leadStatusesInto('UNSUBSCRIBED')`): the state machine stays the one source.
 */

/** Campaigns that were not sent yet; `SENDING`, `DELIVERED` and `BOUNCED` are history and stay as they are */
const OPEN_CAMPAIGN_STATUSES = ['DRAFT', 'NEEDS_APPROVAL', 'APPROVED', 'SCHEDULED'] as const;

export interface BusinessOptOutInput {
  /** Absent for a legacy lead: only the address is suppressed */
  businessId?: Types.ObjectId | string;
  recipientEmail?: string;
  unsubscribableStatuses: readonly LeadStatus[];
  /**
   * REV-232: lots of the business in these statuses are withdrawn in the same transaction (reason `opted_out`); the
   * caller passes `LOT_LIVE_STATUSES`. A withdrawn RESERVED lot must be refunded by the purchase flow (REV-234).
   */
  withdrawLotStatuses?: readonly LotStatus[];
  now?: Date;
}

export interface BusinessOptOutResult {
  newlyOptedOut: boolean;
  rightEnded: boolean;
  leadsUnsubscribed: number;
  campaignsClosed: number;
  addressSuppressed: boolean;
}

export async function recordBusinessOptOut(input: BusinessOptOutInput): Promise<BusinessOptOutResult> {
  const now = input.now ?? new Date();
  const result: BusinessOptOutResult = { newlyOptedOut: false, rightEnded: false, leadsUnsubscribed: 0, campaignsClosed: 0, addressSuppressed: false };

  await mongoose.connection.transaction(async (session) => {
    // A retried transaction starts from zero again
    result.newlyOptedOut = false;
    result.rightEnded = false;
    result.leadsUnsubscribed = 0;
    result.campaignsClosed = 0;
    result.addressSuppressed = false;

    if (input.recipientEmail?.trim()) {
      const added = await SuppressedAddress.updateOne(
        { hash: hashAddress(input.recipientEmail) },
        { $setOnInsert: { hash: hashAddress(input.recipientEmail) } },
        { upsert: true, session },
      );
      result.addressSuppressed = added.upsertedCount > 0;
    }

    if (!input.businessId) return;
    const businessId = new Types.ObjectId(String(input.businessId));

    // The first opt-out's time stays
    const flagged = await Business.updateOne({ _id: businessId, optedOutAt: { $exists: false } }, { $set: { optedOutAt: now } }, { session });
    result.newlyOptedOut = flagged.modifiedCount > 0;

    const business = await Business.findById(businessId, { contactHold: 1 }, { session }).lean();
    const rightId = business?.contactHold?.rightId;
    if (rightId) {
      const active = await ContactRight.exists({ _id: rightId, endedAt: { $exists: false }, expiresAt: { $gt: now } }).session(session);
      if (active) {
        await endContactRight(rightId, { at: now, reason: 'opted_out' }, session);
        result.rightEnded = true;
      }
    }

    if (input.withdrawLotStatuses && input.withdrawLotStatuses.length > 0) {
      await Lot.updateMany(
        { businessId, status: { $in: [...input.withdrawLotStatuses] } },
        { $set: { status: 'WITHDRAWN', withdrawnAt: now, withdrawReason: 'opted_out' }, $unset: { live: '' } },
        { session },
      );
    }

    const leadIds = (await Lead.find({ businessId }, { _id: 1 }, { session }).lean()).map((lead) => lead._id);
    const leads = await Lead.updateMany(
      { businessId, status: { $in: [...input.unsubscribableStatuses] } },
      { $set: { status: 'UNSUBSCRIBED' }, $addToSet: { tags: 'unsubscribed' } },
      { session },
    );
    result.leadsUnsubscribed = leads.modifiedCount;

    if (leadIds.length > 0) {
      const campaigns = await EmailCampaign.updateMany(
        { leadId: { $in: leadIds }, status: { $in: [...OPEN_CAMPAIGN_STATUSES] } },
        { $set: { status: 'UNSUBSCRIBED', unsubscribedAt: now } },
        { session },
      );
      result.campaignsClosed = campaigns.modifiedCount;
    }
  });

  return result;
}

/** Whether the address (any case, any business) is on the suppression list; false for a missing or empty address */
export async function isAddressSuppressed(email: string | undefined, session?: ClientSession): Promise<boolean> {
  if (!email?.trim()) return false;
  return Boolean(await SuppressedAddress.exists({ hash: hashAddress(email) }).session(session ?? null));
}

export async function isBusinessOptedOut(businessId: Types.ObjectId | string | undefined): Promise<boolean> {
  if (!businessId) return false;
  return Boolean(await Business.exists({ _id: businessId, optedOutAt: { $exists: true } }));
}
