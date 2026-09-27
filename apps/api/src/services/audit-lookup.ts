import mongoose from 'mongoose';
import { Audit, IAuditDocument } from '../models/Audit.model.js';

/**
 * The audit to generate an MVP from (REV-55). The dashboard sends an audit id or, when it has none,
 * the lead id. A lead collects one audit per retry, so this takes the given audit when it is
 * COMPLETED, otherwise the newest COMPLETED audit of its lead.
 */
export async function findGenerationAudit(auditOrLeadId: string): Promise<IAuditDocument | null> {
  if (!mongoose.isValidObjectId(auditOrLeadId)) return null;

  const exact = await Audit.findById(auditOrLeadId).exec();
  if (exact?.status === 'COMPLETED') return exact;

  const leadId = exact ? exact.leadId : auditOrLeadId;
  return Audit.findOne({ leadId, status: 'COMPLETED' }).sort({ createdAt: -1 }).exec();
}
