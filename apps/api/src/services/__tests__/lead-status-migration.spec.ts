import { describe, it, expect } from 'vitest';
import { LEAD_STATUSES } from '@revamp/shared-types';
import { canApproveOutreach, isLeadStatus } from '@revamp/validation';
import { REMOVED_LEAD_STATUSES } from '../lead-status-migration.js';

describe('lead status migration (REV-62)', () => {
  it('maps every removed status to a status the state machine has', () => {
    expect(Object.keys(REMOVED_LEAD_STATUSES).sort()).toEqual(
      ['APPROVED', 'AWAITING_APPROVAL', 'DISPATCHED', 'MVP_READY', 'PENDING', 'REPLIED'],
    );
    for (const [removed, target] of Object.entries(REMOVED_LEAD_STATUSES)) {
      expect(isLeadStatus(removed)).toBe(false);
      expect(isLeadStatus(target)).toBe(true);
    }
  });

  it.each([
    ['PENDING', 'QUEUED'],
    ['MVP_READY', 'NEEDS_APPROVAL'],
    ['AWAITING_APPROVAL', 'NEEDS_APPROVAL'],
    ['DISPATCHED', 'SENT'],
    ['REPLIED', 'ENGAGED'],
  ])('moves %s to %s', (from, to) => {
    expect(REMOVED_LEAD_STATUSES[from]).toBe(to);
  });

  it('sends an APPROVED lead back to review instead of making it sendable (HITL)', () => {
    expect(REMOVED_LEAD_STATUSES['APPROVED']).toBe('NEEDS_APPROVAL');
    expect(canApproveOutreach(REMOVED_LEAD_STATUSES['APPROVED'])).toBe(true);
  });

  it('never touches a status that is still valid', () => {
    for (const status of LEAD_STATUSES) expect(REMOVED_LEAD_STATUSES).not.toHaveProperty(status);
  });
});
