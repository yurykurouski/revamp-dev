import { describe, it, expect } from 'vitest';
import {
  activeFilterCount,
  DEFAULT_QUEUE_BUCKET,
  filterQueue,
  formatAge,
  isLeadBucket,
  keepSelectedLead,
  leadScoreBand,
  NO_QUEUE_FILTERS,
  queueStatusOptions,
  resolveSelection,
  scoreBand,
  scoreBandOptions,
  sortQueue,
  stepSelection,
  toggleValue,
  type QueueFilters,
} from '../reviewQueue.js';

const at = (createdAt: string, id = createdAt) => ({ id, createdAt });

describe('review queue order (REV-79)', () => {
  const leads = [at('2026-09-27T10:00:00Z', 'mid'), at('2026-09-25T10:00:00Z', 'old'), at('2026-09-27T12:00:00Z', 'new')];

  it('lists Needs you oldest first', () => {
    expect(sortQueue(leads, 'needs_you').map((l) => l.id)).toEqual(['old', 'mid', 'new']);
  });

  it.each(['in_progress', 'outreach', 'closed'] as const)('lists %s newest first', (bucket) => {
    expect(sortQueue(leads, bucket).map((l) => l.id)).toEqual(['new', 'mid', 'old']);
  });

  it('puts leads without a valid date last and leaves the input alone', () => {
    const withBad = [at('not a date', 'bad'), ...leads];
    expect(sortQueue(withBad, 'needs_you').map((l) => l.id)).toEqual(['old', 'mid', 'new', 'bad']);
    expect(sortQueue(withBad, 'closed').map((l) => l.id)).toEqual(['new', 'mid', 'old', 'bad']);
    expect(withBad[0].id).toBe('bad');
  });

  it('opens on Needs you and accepts only real buckets', () => {
    expect(DEFAULT_QUEUE_BUCKET).toBe('needs_you');
    expect(isLeadBucket('outreach')).toBe(true);
    for (const value of ['ALL', 'NEEDS_APPROVAL', '', null, undefined]) expect(isLeadBucket(value)).toBe(false);
  });
});

describe('queue selection (REV-79)', () => {
  it('keeps the requested lead while it is in the list', () => {
    expect(resolveSelection(['a', 'b', 'c'], 'b', ['a', 'b', 'c'])).toBe('b');
  });

  it('selects the first lead when none is requested or the requested one was never listed', () => {
    expect(resolveSelection(['a', 'b'], null, [])).toBe('a');
    expect(resolveSelection(['a', 'b'], 'elsewhere', ['a', 'b'])).toBe('a');
  });

  it('selects the next lead after the selected one is approved or rejected', () => {
    expect(resolveSelection(['a', 'c'], 'b', ['a', 'b', 'c'])).toBe('c');
  });

  it('skips leads that left the list together with the selected one', () => {
    expect(resolveSelection(['a', 'd'], 'b', ['a', 'b', 'c', 'd'])).toBe('d');
  });

  it('falls back to the lead before when the last one leaves', () => {
    expect(resolveSelection(['a', 'b'], 'c', ['a', 'b', 'c'])).toBe('b');
  });

  it('selects nothing when the list empties', () => {
    expect(resolveSelection([], 'a', ['a'])).toBeNull();
    expect(resolveSelection([], null, [])).toBeNull();
  });

  describe('keeping the selected lead listed (REV-86)', () => {
    const a = at('2026-09-25T10:00:00Z', 'a');
    const b = at('2026-09-26T10:00:00Z', 'b');
    const c = at('2026-09-27T10:00:00Z', 'c');
    const all = [a, b, c];
    const ids = (leads: readonly { id: string }[]) => leads.map((l) => l.id);

    it('keeps the selected lead a worker moved out of the bucket, in its sorted place', () => {
      const shown = [a, c];
      const kept = keepSelectedLead(shown, all, 'b', ['a', 'b', 'c'], null, 'needs_you');
      expect(ids(kept)).toEqual(['a', 'b', 'c']);
      expect(resolveSelection(ids(kept), 'b', ['a', 'b', 'c'])).toBe('b');
      expect(ids(keepSelectedLead(shown, all, 'b', ['c', 'b', 'a'], null, 'in_progress'))).toEqual(['c', 'b', 'a']);
    });

    it('returns the list untouched when the selected lead is still in it', () => {
      const shown = [a, b, c];
      expect(keepSelectedLead(shown, all, 'b', ['a', 'b', 'c'], null, 'needs_you')).toBe(shown);
    });

    it('lets a lead the operator decided on leave, so the next one is selected', () => {
      const shown = [a, c];
      const kept = keepSelectedLead(shown, all, 'b', ['a', 'b', 'c'], 'b', 'needs_you');
      expect(kept).toBe(shown);
      expect(resolveSelection(ids(kept), 'b', ['a', 'b', 'c'])).toBe('c');
    });

    it('keeps only a lead that was shown and still exists', () => {
      const shown = [a, c];
      // A link to a lead of another bucket: never shown here
      expect(keepSelectedLead(shown, all, 'b', ['a', 'c'], null, 'needs_you')).toBe(shown);
      // Deleted
      expect(keepSelectedLead(shown, [a, c], 'b', ['a', 'b', 'c'], null, 'needs_you')).toBe(shown);
      // Nothing selected
      expect(keepSelectedLead(shown, all, null, ['a', 'b', 'c'], null, 'needs_you')).toBe(shown);
    });
  });

  it('steps through the list and stops at its ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'b', -1)).toBe('a');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection(ids, 'gone', -1)).toBe('a');
    expect(stepSelection([], 'a', 1)).toBeNull();
  });
});

describe('lead age (REV-79)', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');

  it('shows minutes, hours, then days', () => {
    expect(formatAge('2026-09-27T11:55:00Z', now, 'en')).toBe('5m');
    expect(formatAge('2026-09-27T10:00:00Z', now, 'en')).toBe('2h');
    expect(formatAge('2026-09-24T12:00:00Z', now, 'en')).toBe('3d');
  });

  it('shows at least one minute, also for a clock that runs ahead', () => {
    expect(formatAge('2026-09-27T12:00:00Z', now, 'en')).toBe('1m');
    expect(formatAge('2026-09-27T12:05:00Z', now, 'en')).toBe('1m');
  });

  it('is empty for an invalid date and localized for other languages', () => {
    expect(formatAge('', now, 'en')).toBe('');
    expect(formatAge('2026-09-27T10:00:00Z', now, 'ru')).toMatch(/^2\s?ч/);
  });
});

describe('review queue quick filters (REV-80)', () => {
  const lead = (id: string, status: string, totalScore?: number) => ({ id, status, totalScore });
  const leads = [
    lead('a', 'NEEDS_APPROVAL', 25),
    lead('b', 'AUDIT_FAILED'),
    lead('c', 'NEEDS_APPROVAL', 55),
    lead('d', 'NEEDS_APPROVAL', 90),
    lead('e', 'AUDIT_FAILED', 40),
  ];
  const ids = (list: { id: string }[]) => list.map((l) => l.id);

  it.each([
    [0, 'low'],
    [39, 'low'],
    [40, 'medium'],
    [69, 'medium'],
    [70, 'high'],
    [100, 'high'],
  ] as const)('puts score %d in the %s band', (score, band) => {
    expect(scoreBand(score)).toBe(band);
  });

  it('has no band for a lead without a numeric score', () => {
    expect(leadScoreBand({ status: 'AUDIT_FAILED' })).toBeUndefined();
    expect(leadScoreBand({ status: 'AUDIT_FAILED', totalScore: Number.NaN })).toBeUndefined();
    expect(leadScoreBand({ status: 'NEEDS_APPROVAL', totalScore: 70 })).toBe('high');
  });

  it('keeps every lead, unscored ones too, with no filter picked', () => {
    expect(filterQueue(leads, NO_QUEUE_FILTERS)).toEqual(leads);
    expect(activeFilterCount(NO_QUEUE_FILTERS)).toBe(0);
  });

  it('keeps the picked statuses in their original order', () => {
    expect(ids(filterQueue(leads, { statuses: ['AUDIT_FAILED'], scoreBands: [] }))).toEqual(['b', 'e']);
    expect(ids(filterQueue(leads, { statuses: ['AUDIT_FAILED', 'NEEDS_APPROVAL'], scoreBands: [] }))).toEqual(ids(leads));
  });

  it('keeps only scored leads in the picked bands once a band is picked', () => {
    expect(ids(filterQueue(leads, { statuses: [], scoreBands: ['low'] }))).toEqual(['a']);
    expect(ids(filterQueue(leads, { statuses: [], scoreBands: ['medium', 'high'] }))).toEqual(['c', 'd', 'e']);
    expect(ids(filterQueue(leads, { statuses: [], scoreBands: ['low', 'medium', 'high'] }))).not.toContain('b');
  });

  it('combines status and score filters', () => {
    const filters: QueueFilters = { statuses: ['NEEDS_APPROVAL'], scoreBands: ['medium', 'high'] };
    expect(ids(filterQueue(leads, filters))).toEqual(['c', 'd']);
    expect(activeFilterCount(filters)).toBe(3);
  });

  it('offers each status present, with its count, in lifecycle order', () => {
    expect(queueStatusOptions(leads)).toEqual([
      { value: 'AUDIT_FAILED', count: 2 },
      { value: 'NEEDS_APPROVAL', count: 3 },
    ]);
    expect(queueStatusOptions([])).toEqual([]);
  });

  it('keeps a picked status on offer at 0 and lists an unknown status last', () => {
    expect(queueStatusOptions([lead('x', 'FUTURE_STATUS'), lead('y', 'SENT')], ['OPENED'])).toEqual([
      { value: 'SENT', count: 1 },
      { value: 'OPENED', count: 0 },
      { value: 'FUTURE_STATUS', count: 1 },
    ]);
  });

  it('counts the leads in every score band', () => {
    expect(scoreBandOptions(leads)).toEqual([
      { value: 'low', count: 1 },
      { value: 'medium', count: 2 },
      { value: 'high', count: 1 },
    ]);
    expect(scoreBandOptions([]).map((o) => o.count)).toEqual([0, 0, 0]);
  });

  it('toggles a value in or out without changing the input', () => {
    const picked = ['low'];
    expect(toggleValue(picked, 'high')).toEqual(['low', 'high']);
    expect(toggleValue(picked, 'low')).toEqual([]);
    expect(picked).toEqual(['low']);
  });
});
