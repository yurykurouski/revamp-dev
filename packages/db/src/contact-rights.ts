import mongoose, { Types, type ClientSession } from 'mongoose';
import type { ContactRightRefusal, ContactRightSource } from '@revamp/shared-types';
import { hashAddress } from './address-hash.js';
import { Business } from './models/Business.model.js';
import { ContactRight, type IContactRightDocument } from './models/ContactRight.model.js';
import { SuppressedAddress } from './models/SuppressedAddress.model.js';

/**
 * REV-224: the registry that says which studio may contact which business. The one rule lives in `grantContactRight`:
 * a right is written only together with a compare-and-set on the business's `contactHold`, so concurrent grants for
 * one business have exactly one winner and a refused grant writes nothing. Create a `ContactRight` through this
 * function only. Durations come from the caller (the API env); this package reads no environment.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ContactRightDurations {
  rightDays: number;
  cooldownDays: number;
}

export interface GrantContactRightInput {
  tenantId: Types.ObjectId | string;
  businessId: Types.ObjectId | string;
  leadId: Types.ObjectId | string;
  /** Checked against the suppressed addresses, whatever business it is under */
  contactEmail?: string;
  source: ContactRightSource;
  durations: ContactRightDurations;
  now?: Date;
  /** Run inside the caller's transaction (E2.2 puts the grant in the add-lead transaction) */
  session?: ClientSession;
}

export type GrantContactRightResult =
  | { granted: true; right: IContactRightDocument }
  | { granted: false; reason: 'opted_out' }
  | { granted: false; reason: 'held'; expiresAt: Date }
  | { granted: false; reason: 'cooldown'; availableAt: Date };

/**
 * Thrown inside a caller's transaction when the grant was refused (REV-225), so the whole transaction aborts.
 * `until` is `expiresAt` (held) or `availableAt` (cooldown); the other studio is never named.
 */
export class ContactRightRefusedError extends Error {
  readonly code = 'CONTACT_RIGHT_REFUSED';
  constructor(
    readonly reason: ContactRightRefusal,
    readonly until?: Date,
  ) {
    super(`The contact right was refused: ${reason}`);
    this.name = 'ContactRightRefusedError';
  }
}

async function grantInSession(input: GrantContactRightInput, session: ClientSession | undefined): Promise<GrantContactRightResult> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.durations.rightDays * DAY_MS);
  const cooldownUntil = new Date(expiresAt.getTime() + input.durations.cooldownDays * DAY_MS);

  if (input.contactEmail) {
    const suppressed = await SuppressedAddress.exists({ hash: hashAddress(input.contactEmail) }).session(session ?? null);
    if (suppressed) return { granted: false, reason: 'opted_out' };
  }

  const rightId = new Types.ObjectId();
  const tenantId = new Types.ObjectId(String(input.tenantId));
  const won = await Business.findOneAndUpdate(
    {
      _id: input.businessId,
      optedOutAt: { $exists: false },
      $or: [{ contactHold: { $exists: false } }, { contactHold: null }, { 'contactHold.cooldownUntil': { $lte: now } }],
    },
    { $set: { contactHold: { rightId, tenantId, expiresAt, cooldownUntil } } },
    { new: true, session },
  );

  if (!won) {
    const business = await Business.findById(input.businessId, { optedOutAt: 1, contactHold: 1 }, { session }).lean();
    if (!business) throw new Error(`Business ${String(input.businessId)} not found`);
    if (business.optedOutAt) return { granted: false, reason: 'opted_out' };
    const hold = business.contactHold;
    if (hold && now < hold.expiresAt) return { granted: false, reason: 'held', expiresAt: hold.expiresAt };
    if (hold) return { granted: false, reason: 'cooldown', availableAt: hold.cooldownUntil };
    // The hold vanished between the two reads (only a manual edit does that): fail rather than guess
    throw new Error(`The contact hold of business ${String(input.businessId)} changed during the grant`);
  }

  const [right] = await ContactRight.create(
    [
      {
        _id: rightId,
        tenantId,
        businessId: input.businessId,
        leadId: input.leadId,
        source: input.source,
        grantedAt: now,
        expiresAt,
        cooldownUntil,
      },
    ],
    { session },
  );
  return { granted: true, right: right! };
}

/**
 * Grants the studio the exclusive right to contact the business, or refuses with why (`opted_out`, `held`, `cooldown`,
 * checked in that order). A refusal is a result, not an error, and writes nothing. Without a `session` the hold and the
 * right are written in one transaction of their own.
 */
export async function grantContactRight(input: GrantContactRightInput): Promise<GrantContactRightResult> {
  if (input.session) return grantInSession(input, input.session);
  let result: GrantContactRightResult | undefined;
  await mongoose.connection.transaction(async (session) => {
    result = await grantInSession(input, session);
  });
  return result!;
}

/** The right that is active at `now` (granted, not expired, not ended), for a studio and business or for a lead */
export async function findActiveContactRight(
  query: { tenantId: Types.ObjectId | string; businessId: Types.ObjectId | string } | { leadId: Types.ObjectId | string },
  now: Date = new Date(),
  session?: ClientSession,
): Promise<IContactRightDocument | null> {
  return ContactRight.findOne(
    { ...query, grantedAt: { $lte: now }, expiresAt: { $gt: now }, endedAt: { $exists: false } },
    null,
    { session },
  ).sort({ grantedAt: -1 });
}

/**
 * Ends a right before its time (an opt-out): marks it ended and, when it is still the business's hold, moves the hold's
 * end to `at` so the cooldown starts there and keeps its length.
 */
export async function endContactRight(
  rightId: Types.ObjectId | string,
  end: { at: Date; reason: 'opted_out' },
  session?: ClientSession,
): Promise<void> {
  const right = await ContactRight.findByIdAndUpdate(rightId, { $set: { endedAt: end.at, endReason: end.reason } }, { session });
  if (!right) throw new Error(`Contact right ${String(rightId)} not found`);
  const cooldownMs = right.cooldownUntil.getTime() - right.expiresAt.getTime();
  await Business.updateOne(
    { _id: right.businessId, 'contactHold.rightId': right._id },
    { $set: { 'contactHold.expiresAt': end.at, 'contactHold.cooldownUntil': new Date(end.at.getTime() + cooldownMs) } },
    { session },
  );
}
