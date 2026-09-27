import type { LeadStatus } from '@revamp/shared-types';

/**
 * REV-62 migration: statuses that were dropped from `LeadStatus` because nothing writes them, and the
 * reachable status a stored lead in each one moves to. Nothing is promoted towards sending: an
 * APPROVED lead goes back to review, so the operator approves it again (Human-In-The-Loop).
 */
export const REMOVED_LEAD_STATUSES: Readonly<Record<string, LeadStatus>> = {
  PENDING: 'QUEUED',
  MVP_READY: 'NEEDS_APPROVAL',
  AWAITING_APPROVAL: 'NEEDS_APPROVAL',
  APPROVED: 'NEEDS_APPROVAL',
  DISPATCHED: 'SENT',
  REPLIED: 'ENGAGED',
};
