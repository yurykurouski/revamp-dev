import { skippedDemoLeadFilter, stalledAuditedLeadFilter } from '@revamp/db';
import { Lead } from '../models/Lead.model.js';
import { findAuditForLead } from '../models/Audit.model.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';

// At startup, queue MVP generation for leads whose audit completed before auto-chaining was active.
// Seeded demo leads (`demo-seed`, REV-199) are left alone (REV-204): they stay AUDITED on purpose and
// would otherwise cost real model calls for fake businesses. Generate MVP by hand still works on them.
export async function recoverStalledAuditedLeads(): Promise<number> {
  try {
    const skippedDemoLeads = await Lead.countDocuments(skippedDemoLeadFilter()).exec();
    if (skippedDemoLeads > 0) {
      console.log(`[Workers Recovery] Skipped ${skippedDemoLeads} demo leads (demo-seed) in AUDITED status.`);
    }

    const stalledLeads = await Lead.find(stalledAuditedLeadFilter()).exec();
    if (stalledLeads.length === 0) return 0;

    console.log(`[Workers Recovery] Found ${stalledLeads.length} leads in AUDITED status. Checking for completed audits to auto-enqueue...`);
    let enqueuedCount = 0;

    for (const lead of stalledLeads) {
      // The lead's own completed audit, else the one of its business (REV-208)
      const audit = await findAuditForLead(lead, { completedOnly: true });

      // A lead without a studio is not generated for until `migrate:tenants` ran (REV-210)
      if (audit && lead.tenantId) {
        await addAiGenerationJob({
          leadId: lead._id.toString(),
          tenantId: lead.tenantId.toString(),
          auditId: audit._id.toString(),
        });
        enqueuedCount++;
        console.log(`[Workers Recovery] Auto-enqueued stalled lead: ${lead.businessName} (${lead._id}) -> AI Generation Queue`);
      }
    }

    console.log(`[Workers Recovery] Auto-enqueued ${enqueuedCount} leads for AI content synthesis.`);
    return enqueuedCount;
  } catch (error) {
    console.error('[Workers Recovery] Error recovering stalled audited leads:', error);
    return 0;
  }
}
