import { describe, it, expect } from 'vitest';
import { LEAD_STATUSES } from '@revamp/shared-types';
import {
  LEAD_BUCKETS,
  LEAD_STATUS_BUCKET,
  LEAD_STATUS_STAGE,
  countLeadsByBucket,
  countStatsByBucket,
  leadBucket,
  leadStage,
  matchesBucket,
} from '../leadStages.js';
import { STAGES } from '../../theme/theme.js';
import { en } from '../../i18n/locales/en.js';
import { ru } from '../../i18n/locales/ru.js';
import { be } from '../../i18n/locales/be.js';
import { pl } from '../../i18n/locales/pl.js';
import { lt } from '../../i18n/locales/lt.js';

describe('lead stages (REV-62)', () => {
  it('puts every shared lead status in exactly one Kanban column', () => {
    expect(Object.keys(LEAD_STATUS_STAGE).sort()).toEqual([...LEAD_STATUSES].sort());
    for (const status of LEAD_STATUSES) expect(STAGES).toContain(LEAD_STATUS_STAGE[status]);
  });

  it('gives every column at least one status', () => {
    for (const stage of STAGES) expect(Object.values(LEAD_STATUS_STAGE)).toContain(stage);
  });

  it('groups the pre-review pipeline and the closed statuses', () => {
    expect(leadStage('AUDIT_FAILED')).toBe('queued');
    expect(leadStage('GENERATING')).toBe('queued');
    expect(leadStage('NEEDS_APPROVAL')).toBe('needs_approval');
    expect(leadStage('UNSUBSCRIBED')).toBe('rejected');
  });

  it('has no column for a status the shared list does not have', () => {
    for (const removed of ['PENDING', 'MVP_READY', 'AWAITING_APPROVAL', 'APPROVED', 'DISPATCHED', 'REPLIED', '']) {
      expect(leadStage(removed)).toBeUndefined();
    }
  });

  it.each([
    ['en', en],
    ['ru', ru],
    ['be', be],
    ['pl', pl],
    ['lt', lt],
  ])('labels exactly the shared statuses in %s', (_language, locale) => {
    expect(Object.keys(locale.statuses).sort()).toEqual([...LEAD_STATUSES].sort());
  });
});

describe('Review-queue buckets (REV-76)', () => {
  it('puts every lead status in exactly one bucket', () => {
    expect(Object.keys(LEAD_STATUS_BUCKET).sort()).toEqual([...LEAD_STATUSES].sort());
    for (const status of LEAD_STATUSES) expect(LEAD_BUCKETS).toContain(LEAD_STATUS_BUCKET[status]);
  });

  it('puts the leads that wait for the operator in Needs you', () => {
    const needsYou = LEAD_STATUSES.filter((s) => LEAD_STATUS_BUCKET[s] === 'needs_you');
    expect(needsYou.sort()).toEqual(['AUDIT_FAILED', 'NEEDS_APPROVAL']);
  });

  it('keeps the pipeline order: in progress, outreach, closed', () => {
    expect(LEAD_STATUS_BUCKET.QUEUED).toBe('in_progress');
    expect(LEAD_STATUS_BUCKET.GENERATING).toBe('in_progress');
    expect(LEAD_STATUS_BUCKET.SCHEDULED).toBe('outreach');
    expect(LEAD_STATUS_BUCKET.CLICKED).toBe('outreach');
    expect(LEAD_STATUS_BUCKET.ENGAGED).toBe('closed');
    expect(LEAD_STATUS_BUCKET.REJECTED).toBe('closed');
    expect(LEAD_STATUS_BUCKET.UNSUBSCRIBED).toBe('closed');
  });

  it('matches a bucket filter, with ALL letting every status through', () => {
    expect(matchesBucket('NEEDS_APPROVAL', 'needs_you')).toBe(true);
    expect(matchesBucket('SENT', 'needs_you')).toBe(false);
    expect(matchesBucket('SENT', 'ALL')).toBe(true);
    // A status from a newer API passes only the ALL filter
    expect(leadBucket('ARCHIVED')).toBeUndefined();
    expect(matchesBucket('ARCHIVED', 'ALL')).toBe(true);
    expect(matchesBucket('ARCHIVED', 'closed')).toBe(false);
  });

  it('counts a list of leads per bucket', () => {
    const counts = countLeadsByBucket(
      ['NEEDS_APPROVAL', 'AUDIT_FAILED', 'QUEUED', 'SENT', 'REJECTED', 'ARCHIVED'].map((status) => ({ status })),
    );
    expect(counts).toEqual({ ALL: 6, needs_you: 2, in_progress: 1, outreach: 1, closed: 1 });
    expect(countLeadsByBucket([])).toEqual({ ALL: 0, needs_you: 0, in_progress: 0, outreach: 0, closed: 0 });
  });

  it('counts the pipeline stats per bucket', () => {
    expect(countStatsByBucket({ NEEDS_APPROVAL: 3, AUDIT_FAILED: 1, AUDITING: 2, OPENED: 4, ENGAGED: 5 })).toEqual({
      ALL: 15,
      needs_you: 4,
      in_progress: 2,
      outreach: 4,
      closed: 5,
    });
    expect(countStatsByBucket({})).toEqual({ ALL: 0, needs_you: 0, in_progress: 0, outreach: 0, closed: 0 });
  });
});
