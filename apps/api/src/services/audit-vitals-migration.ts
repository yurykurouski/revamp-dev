/**
 * REV-105 migration: vitals that were stored without being measured. `speedIndex` was the load event
 * time or LCP × 1.1, and `fidOrInp` was never written; both were removed from `ILighthouseMetrics`.
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
