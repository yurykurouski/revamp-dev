import { Types } from 'mongoose';
import { Audit, type IAuditDocument } from './models/Audit.model.js';

// REV-208: an audit is computed once per business and read by every studio that pursues it. A lead keeps the audits
// it ran itself (`leadId`); a lead that took another studio's audit at add time has none of its own.

type LeadRef = { _id: Types.ObjectId | string; businessId?: Types.ObjectId | string | null };

/**
 * The audit to show or build from for a lead: its own newest audit first (any status, or COMPLETED only with
 * `completedOnly`), else the newest COMPLETED audit of its business. Another studio's retry or failed run is never
 * picked, because only COMPLETED business audits are shared. A lead without a business behaves as before the split.
 */
export async function findAuditForLead(lead: LeadRef, options: { completedOnly?: boolean } = {}): Promise<IAuditDocument | null> {
  const own = await Audit.findOne({ leadId: lead._id, ...(options.completedOnly ? { status: 'COMPLETED' } : {}) })
    .sort({ createdAt: -1 })
    .exec();
  if (own || !lead.businessId) return own;
  return Audit.findOne({ businessId: lead.businessId, status: 'COMPLETED' }).sort({ createdAt: -1 }).exec();
}

/** Whether this audit is the lead's own or one of its business: an audit id from a request is checked against it */
export async function auditBelongsToLead(auditId: Types.ObjectId | string, lead: LeadRef): Promise<boolean> {
  const owners: Record<string, unknown>[] = [{ leadId: lead._id }];
  if (lead.businessId) owners.push({ businessId: lead.businessId });
  return (await Audit.exists({ _id: auditId, $or: owners })) !== null;
}
