import { describe, it, expect } from 'vitest';
import { LEAD_STATUSES } from '@revamp/shared-types';
import { LEAD_STATUS_STAGE, leadStage } from '../leadStages.js';
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
