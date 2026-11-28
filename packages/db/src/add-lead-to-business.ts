import mongoose, { Types } from 'mongoose';
import { EMAIL_GUESSED_TAG, type ContactRightSource, type LotStatus } from '@revamp/shared-types';
import { Audit, type IAuditDocument } from './models/Audit.model.js';
import { Business, type IBusinessDocument } from './models/Business.model.js';
import { Lead, type ILeadDocument } from './models/Lead.model.js';
import { ContactRightRefusedError, grantContactRight, type ContactRightDurations } from './contact-rights.js';
import type { IContactRightDocument } from './models/ContactRight.model.js';
import { Lot } from './models/Lot.model.js';
import { retryOnDuplicateKey } from './retry-duplicate-key.js';

// REV-208: adding a lead. The company and its site are one shared `Business` (one per domain); the lead is one
// studio's pursuit of it. A business that already has a COMPLETED audit hands it to the new lead at once.

/** This studio already has a lead for the business; `leadId` is that lead */
export class LeadAlreadyExistsError extends Error {
  readonly code = 'LEAD_ALREADY_EXISTS';
  constructor(public readonly leadId: string) {
    super('This studio already has a lead for this site');
    this.name = 'LeadAlreadyExistsError';
  }
}

/** The lead fields a finished audit decides (`leadFieldsFromAudit` in `@revamp/validation`, passed in by the API) */
export type DeriveFromAudit = (
  audit: IAuditDocument,
  lead: { contactPhone?: string; contactEmail?: string; tags?: string[] },
) => { set: Record<string, unknown>; clearsEmailGuess: boolean };

export interface AddLeadInput {
  /** The studio's id (the caller's organization). Without one (a script) the lead is not restricted */
  tenantId?: Types.ObjectId | string;
  /** The lead's own fields: name, URL, the canonical `domain`, niche, contacts, source, tags, status `QUEUED` */
  lead: Record<string, unknown>;
  deriveFromAudit: DeriveFromAudit;
  /**
   * REV-225: claim the studio's contact right for the business in this transaction (needs `tenantId`). A refusal
   * throws `ContactRightRefusedError` and rolls back the lead, its audit and a new business. Scripts omit it.
   */
  contactRight?: { durations: ContactRightDurations; source: ContactRightSource; now?: Date };
  /**
   * REV-232: when the studio's right was claimed, withdraw the business's lots in these statuses in the same
   * transaction (`withdrawnReason: 'claimed_by_studio'`). A studio's own add wins over a lot; the caller passes
   * `LOT_CLAIMABLE_BY_STUDIO` (`@revamp/validation`). Needs `tenantId` and `contactRight`.
   */
  withdrawLots?: { statuses: readonly LotStatus[]; now?: Date };
}

export interface AddLeadResult {
  lead: ILeadDocument;
  business: IBusinessDocument;
  /** The lead's own QUEUED audit; absent when it reuses a completed one */
  audit?: IAuditDocument;
  /** The completed audit the lead took, when it did (`reused`) */
  sourceAudit?: IAuditDocument;
  /** The lead took a completed audit of the business and starts as AUDITED: no audit job is needed */
  reused: boolean;
  /** The right claimed together with the lead (only when `contactRight` was asked for) */
  contactRight?: IContactRightDocument;
  /** How many lots of the business were withdrawn because of this add; never shown to the studio */
  withdrawnLots: number;
}

/** The business upsert of both `addLeadToBusiness` and `createPlatformAudit`: one document per canonical domain */
export async function upsertBusinessByDomain(
  fields: { domain: string; originalUrl: string; businessName: string; niche?: string; city?: string },
  session: mongoose.ClientSession,
): Promise<IBusinessDocument> {
  const business = await Business.findOneAndUpdate(
    { domain: fields.domain },
    {
      $setOnInsert: {
        originalUrl: fields.originalUrl,
        businessName: fields.businessName,
        niche: fields.niche ?? 'other',
        ...(fields.city ? { city: fields.city } : {}),
      },
    },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  );
  if (!business) throw new Error(`Could not find or create the business of ${fields.domain}`);
  return business;
}

async function withdrawClaimedLots(
  input: AddLeadInput,
  business: IBusinessDocument,
  claimed: IContactRightDocument | undefined,
  session: mongoose.ClientSession,
): Promise<number> {
  if (!input.withdrawLots || !claimed) return 0;
  const res = await Lot.updateMany(
    { businessId: business._id, status: { $in: [...input.withdrawLots.statuses] } },
    { $set: { status: 'WITHDRAWN', withdrawnAt: input.withdrawLots.now ?? new Date(), withdrawReason: 'claimed_by_studio' }, $unset: { live: '' } },
    { session },
  );
  return res.modifiedCount;
}

async function claimRight(
  input: AddLeadInput,
  business: IBusinessDocument,
  lead: ILeadDocument,
  session: mongoose.ClientSession,
): Promise<IContactRightDocument | undefined> {
  if (!input.tenantId || !input.contactRight) return undefined;
  const granted = await grantContactRight({
    tenantId: input.tenantId,
    businessId: business._id,
    leadId: lead._id,
    contactEmail: lead.contactEmail,
    source: input.contactRight.source,
    durations: input.contactRight.durations,
    now: input.contactRight.now,
    session,
  });
  if (granted.granted) return granted.right;
  throw new ContactRightRefusedError(granted.reason, 'expiresAt' in granted ? granted.expiresAt : 'availableAt' in granted ? granted.availableAt : undefined);
}

/**
 * Finds or creates the business of `lead.domain`, then in one transaction inserts the lead and either its own
 * QUEUED audit or, when the business has a COMPLETED audit, the lead as AUDITED with that audit's score, complexity
 * and contacts. Creating a lead with a status is not a state change, so `LEAD_TRANSITIONS` is untouched.
 *
 * - A studio's second lead for one business is `LeadAlreadyExistsError`, also when two requests race (the partial
 *   unique index `{ tenantId, businessId }` decides, and the retry finds the winner).
 * - Racing first adds of one site write the business with an upsert filtered on `domain`, retried once on E11000
 *   (REV-201), so there is one business.
 */
export async function addLeadToBusiness(input: AddLeadInput): Promise<AddLeadResult> {
  const domain = String(input.lead['domain']).toLowerCase();
  return retryOnDuplicateKey(async () => {
    let result: AddLeadResult | undefined;
    await mongoose.connection.transaction(async (session) => {
      const business = await upsertBusinessByDomain(
        {
          domain,
          originalUrl: input.lead['originalUrl'] as string,
          businessName: input.lead['businessName'] as string,
          niche: (input.lead['niche'] as string | undefined) ?? 'other',
          city: input.lead['city'] as string | undefined,
        },
        session,
      );

      if (input.tenantId) {
        const existing = await Lead.findOne({ tenantId: input.tenantId, businessId: business._id }, { _id: 1 }, { session }).lean();
        if (existing) throw new LeadAlreadyExistsError(String(existing._id));
      }

      const completed = await Audit.findOne({ businessId: business._id, status: 'COMPLETED' }, null, { session }).sort({ createdAt: -1 });
      const base = {
        ...input.lead,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        businessId: business._id,
      };

      if (completed) {
        const { set, clearsEmailGuess } = input.deriveFromAudit(completed, {
          contactPhone: input.lead['contactPhone'] as string | undefined,
          contactEmail: input.lead['contactEmail'] as string | undefined,
          tags: input.lead['tags'] as string[] | undefined,
        });
        const tags = (input.lead['tags'] as string[] | undefined)?.filter((tag) => !(clearsEmailGuess && tag === EMAIL_GUESSED_TAG));
        const [lead] = await Lead.create([{ ...base, ...set, ...(tags ? { tags } : {}), status: 'AUDITED' }], { session });
        const contactRight = await claimRight(input, business, lead!, session);
        const withdrawnLots = await withdrawClaimedLots(input, business, contactRight, session);
        result = { lead: lead!, business, sourceAudit: completed, reused: true, withdrawnLots, ...(contactRight ? { contactRight } : {}) };
        return;
      }

      const [lead] = await Lead.create([base], { session });
      const [audit] = await Audit.create([{ leadId: lead!._id, businessId: business._id, status: 'QUEUED' }], { session });
      const contactRight = await claimRight(input, business, lead!, session);
      const withdrawnLots = await withdrawClaimedLots(input, business, contactRight, session);
      result = { lead: lead!, business, audit: audit!, reused: false, withdrawnLots, ...(contactRight ? { contactRight } : {}) };
    });
    return result!;
  }).catch(async (error) => {
    // The unique index refused a racing second lead of one studio: report it as the rule it enforces
    if ((error as { code?: unknown } | null)?.code === 11000 && input.tenantId) {
      const business = await Business.findOne({ domain }, { _id: 1 }).lean();
      const existing = business ? await Lead.findOne({ tenantId: input.tenantId, businessId: business._id }, { _id: 1 }).lean() : null;
      if (existing) throw new LeadAlreadyExistsError(String(existing._id));
    }
    throw error;
  });
}
