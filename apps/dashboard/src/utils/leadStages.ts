import { LEAD_STATUSES, type LeadStatus } from '@revamp/shared-types';
import type { Stage } from '../theme/theme.js';

/**
 * The Kanban column every lead status belongs to (REV-62). Typed over the shared `LeadStatus`, so a
 * status added to or removed from `LEAD_STATUSES` fails to compile until it is placed here.
 */
export const LEAD_STATUS_STAGE: Readonly<Record<LeadStatus, Stage>> = {
  QUEUED: 'queued',
  AUDITING: 'queued',
  AUDIT_FAILED: 'queued',
  AUDITED: 'queued',
  GENERATING: 'queued',
  NEEDS_APPROVAL: 'needs_approval',
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  OPENED: 'opened',
  CLICKED: 'clicked',
  ENGAGED: 'engaged',
  REJECTED: 'rejected',
  UNSUBSCRIBED: 'rejected',
};

/** The lead's Kanban column; undefined for a status the dashboard does not know */
export const leadStage = (status: string): Stage | undefined =>
  (LEAD_STATUSES as readonly string[]).includes(status) ? LEAD_STATUS_STAGE[status as LeadStatus] : undefined;
