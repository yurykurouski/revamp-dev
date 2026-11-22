import mongoose from 'mongoose';
import { Audit, IAuditDocument, auditBelongsToLead, findAuditForLead } from '../models/Audit.model.js';
import { Lead } from '../models/Lead.model.js';

/**
 * The audit an MVP is built from (REV-55). A lead collects one audit per retry, so "the lead's audit" is ambiguous:
 * use the given audit when it is COMPLETED and is the lead's own or one of its business (REV-208), otherwise the
 * lead's newest COMPLETED one, else the completed audit of its business (a lead that took another studio's audit has
 * none of its own). A failed or unfinished audit has no site content to build from.
 */
export async function findGenerationAudit(leadId: string, auditId?: string): Promise<IAuditDocument | null> {
  const lead = await Lead.findById(leadId, { businessId: 1 }).lean().exec();
  const ref = { _id: leadId, businessId: lead?.businessId };
  if (auditId && mongoose.isValidObjectId(auditId)) {
    const exact = await Audit.findById(auditId).exec();
    if (exact?.status === 'COMPLETED' && (await auditBelongsToLead(auditId, ref))) return exact;
  }
  return findAuditForLead(ref, { completedOnly: true });
}
