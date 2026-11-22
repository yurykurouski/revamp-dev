import mongoose from 'mongoose';
import { Audit, IAuditDocument, findAuditForLead } from '../models/Audit.model.js';
import { Lead, ILeadDocument } from '../models/Lead.model.js';

/**
 * The audit to generate an MVP from (REV-55) and the lead it is for. The dashboard sends an audit id or, when it
 * has none, the lead id. A lead collects one audit per retry, so this takes the given audit when it is COMPLETED,
 * otherwise the newest COMPLETED one of the lead.
 *
 * REV-208: a lead id gives the lead's own completed audit, else the completed audit of its business, and the lead
 * returned is always the one asked about: a lead that took another studio's audit is not confused with the lead
 * that ran it.
 */
export async function findGenerationAudit(
  auditOrLeadId: string,
): Promise<{ audit: IAuditDocument; lead: ILeadDocument } | null> {
  if (!mongoose.isValidObjectId(auditOrLeadId)) return null;

  const asLead = await Lead.findById(auditOrLeadId).exec();
  if (asLead) {
    const audit = await findAuditForLead(asLead, { completedOnly: true });
    return audit ? { audit, lead: asLead } : null;
  }

  const exact = await Audit.findById(auditOrLeadId).exec();
  if (!exact) return null;
  const lead = await Lead.findById(exact.leadId).exec();
  if (!lead) return null;
  if (exact.status === 'COMPLETED') return { audit: exact, lead };
  const audit = await findAuditForLead(lead, { completedOnly: true });
  return audit ? { audit, lead } : null;
}
