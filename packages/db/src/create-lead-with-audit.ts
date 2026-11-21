import mongoose from 'mongoose';
import { Lead, type ILeadDocument } from './models/Lead.model.js';
import { Audit, type IAuditDocument } from './models/Audit.model.js';

/**
 * Inserts a new lead and its first audit (both QUEUED) in one transaction (REV-202), so a failed
 * audit insert never leaves a lead with no audit. Needs a replica set: local MongoDB runs as `rs0`
 * (REV-198) and Atlas is one. The caller queues the audit job after the commit.
 */
export async function createLeadWithAudit(
  lead: Record<string, unknown>,
): Promise<{ lead: ILeadDocument; audit: IAuditDocument }> {
  let created: { lead: ILeadDocument; audit: IAuditDocument } | undefined;
  await mongoose.connection.transaction(async (session) => {
    const [leadDoc] = await Lead.create([lead], { session });
    const [auditDoc] = await Audit.create([{ leadId: leadDoc!._id, status: 'QUEUED' }], { session });
    created = { lead: leadDoc!, audit: auditDoc! };
  });
  return created!;
}
