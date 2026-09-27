import { describe, it, expect } from 'vitest';
import { LEAD_STATUSES, type LeadStatus } from '@revamp/shared-types';
import {
  LEAD_TRANSITIONS,
  LeadStatusSchema,
  MVP_REGENERATABLE_STATUSES,
  OUTREACH_APPROVABLE_STATUSES,
  OUTREACH_REJECTABLE_STATUSES,
  canApproveOutreach,
  canRejectLead,
  canTransition,
  isLeadStatus,
  leadStatusesInto,
  mvpGenerationMode,
} from '../src/index.js';

// The lifecycle written out edge by edge, independently of LEAD_TRANSITIONS (REV-62)
const EXPECTED_EDGES: ReadonlyArray<[LeadStatus, LeadStatus]> = [
  ['QUEUED', 'AUDITING'],
  ['AUDITING', 'AUDITED'],
  ['AUDITING', 'AUDIT_FAILED'],
  ['AUDIT_FAILED', 'QUEUED'],
  ['AUDITED', 'GENERATING'],
  ['GENERATING', 'NEEDS_APPROVAL'],
  ['GENERATING', 'AUDITED'],
  ['NEEDS_APPROVAL', 'GENERATING'],
  ['NEEDS_APPROVAL', 'SCHEDULED'],
  ['SCHEDULED', 'SENT'],
  ['SENT', 'OPENED'],
  ['SENT', 'CLICKED'],
  ['SENT', 'ENGAGED'],
  ['OPENED', 'CLICKED'],
  ['OPENED', 'ENGAGED'],
  ['CLICKED', 'ENGAGED'],
  // Operator reject before approval, plus the email worker's MX bounce from SCHEDULED
  ['QUEUED', 'REJECTED'],
  ['AUDITING', 'REJECTED'],
  ['AUDIT_FAILED', 'REJECTED'],
  ['AUDITED', 'REJECTED'],
  ['GENERATING', 'REJECTED'],
  ['NEEDS_APPROVAL', 'REJECTED'],
  ['SCHEDULED', 'REJECTED'],
  // An opt-out wins from any status (REV-73)
  ...LEAD_STATUSES.filter((s) => s !== 'UNSUBSCRIBED').map((s): [LeadStatus, LeadStatus] => [s, 'UNSUBSCRIBED']),
];

const isExpected = (from: LeadStatus, to: LeadStatus) => EXPECTED_EDGES.some(([f, t]) => f === from && t === to);

describe('Lead state machine (REV-62)', () => {
  it('lists only the statuses the system writes; SENT, not DISPATCHED, follows dispatch', () => {
    expect([...LEAD_STATUSES]).toEqual([
      'QUEUED', 'AUDITING', 'AUDIT_FAILED', 'AUDITED', 'GENERATING', 'NEEDS_APPROVAL', 'SCHEDULED',
      'SENT', 'OPENED', 'CLICKED', 'ENGAGED', 'REJECTED', 'UNSUBSCRIBED',
    ]);
    for (const removed of ['PENDING', 'MVP_READY', 'AWAITING_APPROVAL', 'APPROVED', 'DISPATCHED', 'REPLIED']) {
      expect(isLeadStatus(removed)).toBe(false);
      expect(LeadStatusSchema.safeParse(removed).success).toBe(false);
    }
  });

  it('has a row for every status and targets only known statuses', () => {
    expect(Object.keys(LEAD_TRANSITIONS).sort()).toEqual([...LEAD_STATUSES].sort());
    for (const targets of Object.values(LEAD_TRANSITIONS)) {
      for (const to of targets) expect(isLeadStatus(to)).toBe(true);
    }
  });

  describe.each(LEAD_STATUSES.map((from) => [from]))('from %s', (from) => {
    it.each(LEAD_STATUSES.map((to) => [to]))(`to %s matches the documented lifecycle`, (to) => {
      expect(canTransition(from, to)).toBe(isExpected(from, to));
    });
  });

  it('never treats staying in a status as a transition', () => {
    for (const status of LEAD_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it('rejects unknown or missing source statuses', () => {
    expect(canTransition('DISPATCHED', 'OPENED')).toBe(false);
    expect(canTransition('', 'AUDITING')).toBe(false);
    expect(canTransition(undefined, 'AUDITING')).toBe(false);
    expect(canTransition(null, 'AUDITING')).toBe(false);
  });

  it('refuses the old shortcuts: engagement before the email is sent, and moving back', () => {
    expect(canTransition('QUEUED', 'OPENED')).toBe(false);
    expect(canTransition('SCHEDULED', 'OPENED')).toBe(false);
    expect(canTransition('SCHEDULED', 'ENGAGED')).toBe(false);
    expect(canTransition('CLICKED', 'OPENED')).toBe(false);
    expect(canTransition('SENT', 'SCHEDULED')).toBe(false);
    expect(canTransition('NEEDS_APPROVAL', 'AUDITING')).toBe(false);
  });

  it('reaches every status from QUEUED, and UNSUBSCRIBED is final', () => {
    const seen = new Set<LeadStatus>(['QUEUED']);
    const queue: LeadStatus[] = ['QUEUED'];
    while (queue.length) {
      for (const next of LEAD_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...LEAD_STATUSES].sort());
    expect(LEAD_TRANSITIONS.UNSUBSCRIBED).toEqual([]);
  });

  it('leadStatusesInto lists the sources of a status, optionally with the status itself', () => {
    expect(leadStatusesInto('AUDITING')).toEqual(['QUEUED']);
    expect(leadStatusesInto('AUDITING', { includeSelf: true })).toEqual(['QUEUED', 'AUDITING']);
    expect(leadStatusesInto('SENT')).toEqual(['SCHEDULED']);
    expect(leadStatusesInto('OPENED')).toEqual(['SENT']);
    expect(leadStatusesInto('ENGAGED')).toEqual(['SENT', 'OPENED', 'CLICKED']);
    expect(leadStatusesInto('NEEDS_APPROVAL')).toEqual(['GENERATING']);
    expect(leadStatusesInto('UNSUBSCRIBED')).toEqual(LEAD_STATUSES.filter((s) => s !== 'UNSUBSCRIBED'));
    expect(leadStatusesInto('QUEUED')).toEqual(['AUDIT_FAILED']);
  });

  describe('outreach approve and reject (REV-59)', () => {
    it('approves only from NEEDS_APPROVAL', () => {
      expect(OUTREACH_APPROVABLE_STATUSES).toEqual(['NEEDS_APPROVAL']);
      for (const status of LEAD_STATUSES) expect(canApproveOutreach(status)).toBe(status === 'NEEDS_APPROVAL');
      expect(canApproveOutreach(undefined)).toBe(false);
    });

    it('rejects everything before approval, never a scheduled, sent or closed lead', () => {
      expect(OUTREACH_REJECTABLE_STATUSES).toEqual([
        'QUEUED', 'AUDITING', 'AUDIT_FAILED', 'AUDITED', 'GENERATING', 'NEEDS_APPROVAL',
      ]);
      for (const status of ['SCHEDULED', 'SENT', 'OPENED', 'CLICKED', 'ENGAGED', 'REJECTED', 'UNSUBSCRIBED']) {
        expect(canRejectLead(status)).toBe(false);
      }
      expect(canRejectLead(null)).toBe(false);
    });
  });

  describe('mvpGenerationMode (REV-31)', () => {
    it('generates first from AUDITED and regenerates only from NEEDS_APPROVAL', () => {
      expect(mvpGenerationMode('AUDITED')).toBe('first');
      expect(MVP_REGENERATABLE_STATUSES).toEqual(['NEEDS_APPROVAL']);
      expect(mvpGenerationMode('NEEDS_APPROVAL')).toBe('regenerate');
    });

    it('blocks generation from every other status', () => {
      for (const status of LEAD_STATUSES.filter((s) => s !== 'AUDITED' && s !== 'NEEDS_APPROVAL')) {
        expect(mvpGenerationMode(status)).toBe('blocked');
      }
      expect(mvpGenerationMode('MVP_READY')).toBe('blocked');
      expect(mvpGenerationMode(undefined)).toBe('blocked');
    });
  });
});
