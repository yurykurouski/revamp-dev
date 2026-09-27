import mongoose from 'mongoose';
import { Audit, IAuditDocument } from '../models/Audit.model.js';

/**
 * The audit an MVP is built from (REV-55). A lead collects one audit per retry, so "the lead's
 * audit" is ambiguous: use the given audit when it is a COMPLETED audit of this lead, otherwise
 * the lead's newest COMPLETED one. A failed or unfinished audit has no site content to build from.
 */
export async function findGenerationAudit(leadId: string, auditId?: string): Promise<IAuditDocument | null> {
  if (auditId && mongoose.isValidObjectId(auditId)) {
    const exact = await Audit.findOne({ _id: auditId, leadId }).exec();
    if (exact?.status === 'COMPLETED') return exact;
  }
  return Audit.findOne({ leadId, status: 'COMPLETED' }).sort({ createdAt: -1 }).exec();
}
