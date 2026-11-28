import { describe, expect, it } from 'vitest';
import { LOT_STATUSES } from '@revamp/shared-types';
import {
  LOT_ADMIN_OPENABLE,
  LOT_CLAIMABLE_BY_STUDIO,
  LOT_LIVE_STATUSES,
  LOT_TRANSITIONS,
  canLotTransition,
  lotStatusesInto,
} from '../src/lot-status';

describe('lot status table', () => {
  it('has an entry for every status', () => {
    expect(Object.keys(LOT_TRANSITIONS).sort()).toEqual([...LOT_STATUSES].sort());
  });
  it('makes SOLD and WITHDRAWN final', () => {
    expect(LOT_TRANSITIONS.SOLD).toEqual([]);
    expect(LOT_TRANSITIONS.WITHDRAWN).toEqual([]);
  });
  it('checks single moves', () => {
    expect(canLotTransition('OPEN', 'RESERVED')).toBe(true);
    expect(canLotTransition('SOLD', 'OPEN')).toBe(false);
    expect(canLotTransition('DRAFT', 'DRAFT')).toBe(false);
    expect(canLotTransition('nope', 'OPEN')).toBe(false);
    expect(canLotTransition(undefined, 'OPEN')).toBe(false);
  });
  it('lists the sources of a target', () => {
    expect(lotStatusesInto('WITHDRAWN')).toEqual(['DRAFT', 'OPEN', 'RESERVED']);
    expect(lotStatusesInto('OPEN')).toEqual(['DRAFT', 'RESERVED']);
    expect(lotStatusesInto('DRAFT')).toEqual([]);
  });
  it('derives the live statuses from the table', () => {
    expect(LOT_LIVE_STATUSES).toEqual(LOT_STATUSES.filter((s) => LOT_TRANSITIONS[s].length > 0));
    expect(LOT_LIVE_STATUSES).toEqual(['DRAFT', 'OPEN', 'RESERVED']);
  });
  it('lets a studio claim only DRAFT and OPEN lots', () => {
    for (const s of LOT_CLAIMABLE_BY_STUDIO) expect(LOT_LIVE_STATUSES).toContain(s);
    expect(LOT_CLAIMABLE_BY_STUDIO).not.toContain('RESERVED');
    for (const s of LOT_CLAIMABLE_BY_STUDIO) expect(canLotTransition(s, 'WITHDRAWN')).toBe(true);
  });
  it('lets the admin open only a DRAFT', () => {
    expect(LOT_ADMIN_OPENABLE).toEqual(['DRAFT']);
  });
});
