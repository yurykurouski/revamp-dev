import { IAuditScores } from '@revamp/shared-types';
import { DesignCritiqueOutput } from '@revamp/validation';

export type SiteHealthRating = 'CRITICAL' | 'NEEDS_MODERNIZATION' | 'MODERN';

export interface ScoreInputs {
  designScore: number;
  performanceScore: number;
  accessibilityScore: number;
  standardsScore: number;
}

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
   * Computes the composite score across all 4 pillars
   */
  static calculateCompositeScore(inputs: ScoreInputs): IAuditScores {
    const design = Math.round(Math.min(100, Math.max(0, inputs.designScore)));
    const performance = Math.round(Math.min(100, Math.max(0, inputs.performanceScore)));
    const accessibility = Math.round(Math.min(100, Math.max(0, inputs.accessibilityScore)));
    const standards = Math.round(Math.min(100, Math.max(0, inputs.standardsScore)));

    const rawTotal =
      this.WEIGHTS.DESIGN * design +
      this.WEIGHTS.PERFORMANCE * performance +
      this.WEIGHTS.ACCESSIBILITY * accessibility +
      this.WEIGHTS.STANDARDS * standards;

    const total = Math.round(Math.min(100, Math.max(0, rawTotal)));

    return {
      total,
      design,
      performance,
      accessibility,
      standards,
    };
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
