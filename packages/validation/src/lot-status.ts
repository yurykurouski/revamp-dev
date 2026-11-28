import { z } from 'zod';
import { LOT_STATUSES, type LotStatus } from '@revamp/shared-types';

// Lots and platform audits (REV-232). The lot state machine is one table, like LEAD_TRANSITIONS (REV-62):
// every write of `Lot.status` checks it, as an atomic `status: { $in: lotStatusesInto(to) }` filter.

export const LotStatusSchema = z.enum(LOT_STATUSES);

/**
 * - DRAFT: made by an admin from a completed platform audit, not yet offered.
 * - OPEN: offered to studios. RESERVED: a studio is buying it (REV-234); it returns to OPEN when the reservation expires.
 * - SOLD and WITHDRAWN are final. A studio's Add lead of the business withdraws a DRAFT or OPEN lot.
 */
export const LOT_TRANSITIONS: Readonly<Record<LotStatus, readonly LotStatus[]>> = {
  DRAFT: ['OPEN', 'WITHDRAWN'],
  OPEN: ['RESERVED', 'WITHDRAWN'],
  RESERVED: ['OPEN', 'SOLD', 'WITHDRAWN'],
  SOLD: [],
  WITHDRAWN: [],
};

export const isLotStatus = (status: unknown): status is LotStatus =>
  (LOT_STATUSES as readonly unknown[]).includes(status);

/** True when a lot in `from` may move to `to` */
export function canLotTransition(from: string | null | undefined, to: LotStatus): boolean {
  return isLotStatus(from) && LOT_TRANSITIONS[from].includes(to);
}

/** The statuses a lot may move to `to` from, for an atomic `status: { $in: ... }` update filter */
export function lotStatusesInto(to: LotStatus): LotStatus[] {
  return LOT_STATUSES.filter((status) => canLotTransition(status, to));
}

/** A lot that still can change: it holds the business's one live-lot slot (unique index on `live`) */
export const LOT_LIVE_STATUSES: readonly LotStatus[] = LOT_STATUSES.filter((s) => LOT_TRANSITIONS[s].length > 0);

/** What a studio's Add lead or import withdraws (the ruling of REV-232); a RESERVED lot is REV-234's case */
export const LOT_CLAIMABLE_BY_STUDIO: readonly LotStatus[] = ['DRAFT', 'OPEN'];

/** What the admin "open" route accepts: only a DRAFT (OPEN is also reachable from RESERVED, by expiry) */
export const LOT_ADMIN_OPENABLE: readonly LotStatus[] = ['DRAFT'];

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const CreateLotSchema = z.object({ businessId: objectIdString });

export const OpenLotSchema = z.object({ releaseAt: z.string().datetime().optional() });

export const AdminLotsQuerySchema = z.object({
  status: LotStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
