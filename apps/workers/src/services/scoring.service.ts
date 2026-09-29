import { IAuditScores } from '@revamp/shared-types';
import { DesignCritiqueOutput } from '@revamp/validation';

export type SiteHealthRating = 'CRITICAL' | 'NEEDS_MODERNIZATION' | 'MODERN';

/** Pillar scores; a pillar that was not measured is left undefined (REV-100) */
export interface ScoreInputs {
  designScore: number;
  performanceScore?: number;
  accessibilityScore?: number;
  standardsScore?: number;
}

const clampScore = (value: number): number => Math.round(Math.min(100, Math.max(0, value)));

export class ScoringService {
  /**
   * Weights according to blueprint.md (1.2) and spec.md (3.1.5.1):
   * Total = 0.35 * Design + 0.25 * Performance + 0.20 * A11y + 0.20 * Standards
   */
  static readonly WEIGHTS = {
    DESIGN: 0.35,
    PERFORMANCE: 0.25,
    ACCESSIBILITY: 0.20,
    STANDARDS: 0.20,
  } as const;

  /**
   * Computes the normalized design score (0-100) from visual hierarchy
   * and mobile friendliness ratings produced by the Vision LLM.
   */
  static calculateDesignScore(
    critique: Pick<DesignCritiqueOutput, 'visualHierarchyRating' | 'mobileFriendlinessRating'>,
  ): number {
    const raw = (critique.visualHierarchyRating + critique.mobileFriendlinessRating) / 2;
    return Math.round(Math.min(100, Math.max(0, raw)));
  }

  /**
   * Computes the composite score across the pillars that were measured. A missing pillar is left out
   * and the remaining weights are scaled up to sum to 1, so an unmeasured pillar neither counts as 0
   * nor as a made-up value (REV-100)
   */
  static calculateCompositeScore(inputs: ScoreInputs): IAuditScores {
    const scores: IAuditScores = { total: 0, design: clampScore(inputs.designScore) };
    if (inputs.performanceScore !== undefined) scores.performance = clampScore(inputs.performanceScore);
    if (inputs.accessibilityScore !== undefined) scores.accessibility = clampScore(inputs.accessibilityScore);
    if (inputs.standardsScore !== undefined) scores.standards = clampScore(inputs.standardsScore);

    const weighted: Array<[number | undefined, number]> = [
      [scores.design, this.WEIGHTS.DESIGN],
      [scores.performance, this.WEIGHTS.PERFORMANCE],
      [scores.accessibility, this.WEIGHTS.ACCESSIBILITY],
      [scores.standards, this.WEIGHTS.STANDARDS],
    ];
    let sum = 0;
    let weights = 0;
    for (const [score, weight] of weighted) {
      if (score === undefined) continue;
      sum += weight * score;
      weights += weight;
    }

    scores.total = clampScore(sum / weights);
    return scores;
  }

  /**
   * Health classification according to spec.md (3.1.5.2):
   * 0 - 49: Critical state (high priority for cold outreach)
   * 50 - 74: Needs modernization
   * 75 - 100: Modern site (outreach not recommended)
   */
  static getSiteHealthRating(totalScore: number): SiteHealthRating {
    if (totalScore < 50) return 'CRITICAL';
    if (totalScore < 75) return 'NEEDS_MODERNIZATION';
    return 'MODERN';
  }
}

export const scoringService = new ScoringService();
