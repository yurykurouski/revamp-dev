import mongoose from 'mongoose';
import { Audit, IAuditDocument, auditBelongsToLead, findAuditForLead } from '../models/Audit.model.js';
import type { ILeadDocument } from '../models/Lead.model.js';
import type { TenantScope } from '../data/tenant-scope.js';

/**
 * The audit to generate an MVP from (REV-55) and the lead it is for. The dashboard sends an audit id or, when it
 * has none, the lead id. A lead collects one audit per retry, so this takes the given audit when it is COMPLETED,
 * otherwise the newest COMPLETED one of the lead.
 *
 * REV-208: a lead id gives the lead's own completed audit, else the completed audit of its business, and the lead
 * returned is always the one asked about: a lead that took another studio's audit is not confused with the lead
 * that ran it. A request that names its lead (`leadId`) always gets that lead; an audit id alone is refused when
 * several leads read the audit.
 */
export async function findGenerationAudit(
  scope: TenantScope,
  auditOrLeadId: string,
  leadId?: string,
): Promise<{ audit: IAuditDocument; lead: ILeadDocument } | null> {
  if (!mongoose.isValidObjectId(auditOrLeadId)) return null;

  // The request names its lead: the lead is that one, and the audit is the given one when it is the lead's own or one
  // of its business, else the lead's own or its business's completed audit (REV-208)
  if (leadId) {
    if (!mongoose.isValidObjectId(leadId)) return null;
    const named = await scope.leads.findById(leadId).exec();
    if (!named) return null;
    if (auditOrLeadId !== leadId) {
      const given = await Audit.findById(auditOrLeadId).exec();
      if (given?.status === 'COMPLETED' && (await auditBelongsToLead(given._id, named))) return { audit: given, lead: named };
    }
    const audit = await findAuditForLead(named, { completedOnly: true });
    return audit ? { audit, lead: named } : null;
  }

  const asLead = await scope.leads.findById(auditOrLeadId).exec();
  if (asLead) {
    const audit = await findAuditForLead(asLead, { completedOnly: true });
    return audit ? { audit, lead: asLead } : null;
  }

  const exact = await Audit.findById(auditOrLeadId).exec();
  if (!exact) return null;
  // An audit that more than one lead of the studio reads says nothing about whose lead is meant: the request must name
  // its lead then (the dashboard always does). Audits are shared, so the lead is looked up in the studio only: an
  // audit no lead of the studio reads answers like a missing one (REV-209). A platform audit has no `leadId` (REV-232):
  // `{ _id: undefined }` would be dropped by Mongoose and match every lead, so the `$or` is built without it.
  const readers = await scope.leads
    .find({ $or: [...(exact.leadId ? [{ _id: exact.leadId }] : []), ...(exact.businessId ? [{ businessId: exact.businessId }] : [])] })
    .limit(2)
    .exec();
  if (readers.length !== 1) return null;
  const lead = readers[0]!;
  if (exact.status === 'COMPLETED') return { audit: exact, lead };
  const audit = await findAuditForLead(lead, { completedOnly: true });
  return audit ? { audit, lead } : null;
}
