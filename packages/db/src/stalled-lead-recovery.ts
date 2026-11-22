import type { FilterQuery } from 'mongoose';
import type { ILeadDocument } from './models/Lead.model.js';
import { DEMO_SEED_TAG } from './seed/demo-dataset.js';

// The leads the workers' startup recovery queues for MVP generation (REV-204): every AUDITED lead except
// the seeded demo leads (`npm run db:seed`, REV-199), which stay AUDITED on purpose and would otherwise cost
// real model calls for fake businesses. On an array field `$ne` means "does not contain". Only the tag
// constant is read here, never seed data (REV-45). Generate MVP by hand still works on a demo lead.
export function stalledAuditedLeadFilter(): FilterQuery<ILeadDocument> {
  return { status: 'AUDITED', tags: { $ne: DEMO_SEED_TAG } };
}

// The seeded demo leads the recovery leaves alone, counted for its log line
export function skippedDemoLeadFilter(): FilterQuery<ILeadDocument> {
  return { status: 'AUDITED', tags: DEMO_SEED_TAG };
}
