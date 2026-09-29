import { describe, it, expect } from 'vitest';
import {
  REMOVED_VITALS_FIELDS,
  auditsWithRemovedVitals,
  unsetRemovedVitals,
} from '../audit-vitals-migration.js';

describe('audit vitals migration (REV-105)', () => {
  it('removes only the vitals that were never measured', () => {
    expect([...REMOVED_VITALS_FIELDS]).toEqual(['lighthouseMetrics.speedIndex', 'lighthouseMetrics.fidOrInp']);
  });

  it('matches audits holding any removed vital', () => {
    expect(auditsWithRemovedVitals()).toEqual({
      $or: [
        { 'lighthouseMetrics.speedIndex': { $exists: true } },
        { 'lighthouseMetrics.fidOrInp': { $exists: true } },
      ],
    });
  });

  it('unsets the removed vitals and keeps the measured LCP and CLS', () => {
    const update = unsetRemovedVitals();
    expect(update).toEqual({
      $unset: { 'lighthouseMetrics.speedIndex': '', 'lighthouseMetrics.fidOrInp': '' },
    });
    expect(Object.keys(update.$unset)).not.toContain('lighthouseMetrics.lcp');
    expect(Object.keys(update.$unset)).not.toContain('lighthouseMetrics.cls');
  });
});
