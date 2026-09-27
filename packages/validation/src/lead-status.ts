import { z } from 'zod';
import { LEAD_STATUSES, LeadStatus } from '@revamp/shared-types';

export const LeadStatusSchema = z.enum(LEAD_STATUSES);

/**
 * The lead state machine (REV-62): for each status, the statuses a lead may move to next. Every
 * writer in the API and the workers checks this table, usually as an atomic `status: { $in: ... }`
 * filter, so a stale job or a late tracking hit can never move a lead backwards.
 *
 * - UNSUBSCRIBED is reachable from every status: an opt-out always wins, whatever stage the lead
 *   reached (REV-73). It is final.
 * - SCHEDULED → REJECTED is the email worker's pre-flight MX bounce, not an operator action.
 * - GENERATING → AUDITED / NEEDS_APPROVAL is a failed first generation / regeneration (REV-31).
 * - AUDIT_FAILED → QUEUED is an operator retry (REV-44).
 */
export const LEAD_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  QUEUED: ['AUDITING', 'REJECTED', 'UNSUBSCRIBED'],
  AUDITING: ['AUDITED', 'AUDIT_FAILED', 'REJECTED', 'UNSUBSCRIBED'],
  AUDIT_FAILED: ['QUEUED', 'REJECTED', 'UNSUBSCRIBED'],
  AUDITED: ['GENERATING', 'REJECTED', 'UNSUBSCRIBED'],
  GENERATING: ['NEEDS_APPROVAL', 'AUDITED', 'REJECTED', 'UNSUBSCRIBED'],
  NEEDS_APPROVAL: ['GENERATING', 'SCHEDULED', 'REJECTED', 'UNSUBSCRIBED'],
  SCHEDULED: ['SENT', 'REJECTED', 'UNSUBSCRIBED'],
  SENT: ['OPENED', 'CLICKED', 'ENGAGED', 'UNSUBSCRIBED'],
  OPENED: ['CLICKED', 'ENGAGED', 'UNSUBSCRIBED'],
  CLICKED: ['ENGAGED', 'UNSUBSCRIBED'],
  ENGAGED: ['UNSUBSCRIBED'],
  REJECTED: ['UNSUBSCRIBED'],
  UNSUBSCRIBED: [],
};

export const isLeadStatus = (status: unknown): status is LeadStatus =>
  (LEAD_STATUSES as readonly unknown[]).includes(status);

/** True when a lead in `from` may move to `to`. Staying in the same status is not a transition. */
export function canTransition(from: string | null | undefined, to: LeadStatus): boolean {
  return isLeadStatus(from) && LEAD_TRANSITIONS[from].includes(to);
}

/**
 * The statuses a lead may move to `to` from, for an atomic `status: { $in: ... }` update filter.
 * `includeSelf` also matches a lead already in `to`, for writers a BullMQ retry runs again.
 */
export function leadStatusesInto(to: LeadStatus, options: { includeSelf?: boolean } = {}): LeadStatus[] {
  const from = LEAD_STATUSES.filter((status) => canTransition(status, to));
  return options.includeSelf ? [...from, to] : from;
}

/** Statuses a lead's outreach can be approved from: the MVP is ready for operator review (REV-59) */
export const OUTREACH_APPROVABLE_STATUSES: readonly LeadStatus[] = leadStatusesInto('SCHEDULED');

/**
 * Statuses the operator can reject a lead from: everything before its outreach is approved (REV-59).
 * SCHEDULED is left out: from there only the email worker's MX bounce rejects it.
 */
export const OUTREACH_REJECTABLE_STATUSES: readonly LeadStatus[] = leadStatusesInto('REJECTED').filter(
  (status) => status !== 'SCHEDULED',
);

export const canApproveOutreach = (status: string | null | undefined): boolean =>
  (OUTREACH_APPROVABLE_STATUSES as readonly string[]).includes(status ?? '');
export const canRejectLead = (status: string | null | undefined): boolean =>
  (OUTREACH_REJECTABLE_STATUSES as readonly string[]).includes(status ?? '');

/**
 * MVP generation rules by lead status (REV-31), shared by the API and the dashboard.
 * - `first`: the lead is audited and has no MVP yet.
 * - `regenerate`: an MVP exists and outreach has not been scheduled; needs `forceRegenerate`.
 * - `blocked`: no finished audit yet, generation already running, or outreach scheduled/dispatched.
 */
export type MvpGenerationMode = 'first' | 'regenerate' | 'blocked';

export const MVP_REGENERATABLE_STATUSES: readonly LeadStatus[] = leadStatusesInto('GENERATING').filter(
  (status) => status !== 'AUDITED',
);

export function mvpGenerationMode(status: string | undefined | null): MvpGenerationMode {
  if (status === 'AUDITED') return 'first';
  if ((MVP_REGENERATABLE_STATUSES as readonly string[]).includes(status ?? '')) return 'regenerate';
  return 'blocked';
}

/**
 * Whether the operator may switch the layout of a lead's existing MVP (REV-84): under the same rule as
 * a regeneration, so never while one is running or once outreach is scheduled or dispatched.
 */
export const canChangeMvpLayout = (status: string | undefined | null): boolean =>
  mvpGenerationMode(status) === 'regenerate';
