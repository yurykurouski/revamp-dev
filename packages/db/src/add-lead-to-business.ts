import mongoose, { Types } from 'mongoose';
import { EMAIL_GUESSED_TAG } from '@revamp/shared-types';
import { Audit, type IAuditDocument } from './models/Audit.model.js';
import { Business, type IBusinessDocument } from './models/Business.model.js';
import { Lead, type ILeadDocument } from './models/Lead.model.js';
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
      const business = await Business.findOneAndUpdate(
        { domain },
        {
          $setOnInsert: {
            originalUrl: input.lead['originalUrl'],
            businessName: input.lead['businessName'],
            niche: input.lead['niche'] ?? 'other',
            ...(input.lead['city'] ? { city: input.lead['city'] } : {}),
          },
        },
        { upsert: true, new: true, session, setDefaultsOnInsert: true },
      );
      if (!business) throw new Error(`Could not find or create the business of ${domain}`);

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
        result = { lead: lead!, business, sourceAudit: completed, reused: true };
        return;
      }

      const [lead] = await Lead.create([base], { session });
      const [audit] = await Audit.create([{ leadId: lead!._id, businessId: business._id, status: 'QUEUED' }], { session });
      result = { lead: lead!, business, audit: audit!, reused: false };
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
