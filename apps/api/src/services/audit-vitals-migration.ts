/**
 * REV-105 migration: vitals that were stored without being measured. `speedIndex` was the load event
 * time or LCP × 1.1, and `fidOrInp` was never written; both were removed from the audit's vitals.
 */
export const REMOVED_VITALS_FIELDS = ['lighthouseMetrics.speedIndex', 'lighthouseMetrics.fidOrInp'] as const;

/** Audits that still hold one of the removed vitals */
export const auditsWithRemovedVitals = () => ({
  $or: REMOVED_VITALS_FIELDS.map((field) => ({ [field]: { $exists: true } })),
});

/** Unsets every removed vital; the measured `lcp` and `cls` stay */
export const unsetRemovedVitals = () => ({
  $unset: Object.fromEntries(REMOVED_VITALS_FIELDS.map((field) => [field, ''])),
});

/**
 * REV-102 migration: no Lighthouse runs, so `lighthouseMetrics` is now `webVitals`. Runs after the
 * REV-105 step, so only measured `lcp` and `cls` are moved.
 */
export const LEGACY_VITALS_FIELD = 'lighthouseMetrics';
export const VITALS_FIELD = 'webVitals';

/** Audits written before the rename, with no `webVitals` yet */
export const auditsWithLegacyVitalsOnly = () => ({
  [LEGACY_VITALS_FIELD]: { $exists: true },
  [VITALS_FIELD]: { $exists: false },
});

/** Moves the vitals to their new field */
export const renameLegacyVitals = () => ({ $rename: { [LEGACY_VITALS_FIELD]: VITALS_FIELD } });

/**
 * Audits re-run after the rename hold both fields; their `webVitals` is newer, so the old field is
 * dropped rather than moved over it
 */
export const auditsWithStaleLegacyVitals = () => ({
  [LEGACY_VITALS_FIELD]: { $exists: true },
  [VITALS_FIELD]: { $exists: true },
});

export const unsetLegacyVitals = () => ({ $unset: { [LEGACY_VITALS_FIELD]: '' } });
