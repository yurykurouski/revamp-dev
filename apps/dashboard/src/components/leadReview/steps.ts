/** The steps of a lead review (REV-77), in order; approving outreach is possible only on the last one */
export const REVIEW_STEPS = ['audit', 'prototype', 'email'] as const;

export type ReviewStep = (typeof REVIEW_STEPS)[number];

/** The step after this one, or null on the last step */
export function nextStep(step: ReviewStep): ReviewStep | null {
  return REVIEW_STEPS[REVIEW_STEPS.indexOf(step) + 1] ?? null;
}

/** The step before this one, or null on the first step */
export function previousStep(step: ReviewStep): ReviewStep | null {
  return REVIEW_STEPS[REVIEW_STEPS.indexOf(step) - 1] ?? null;
}
