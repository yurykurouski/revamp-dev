import { describe, it, expect } from 'vitest';
import { ScoringService } from '../scoring.service.js';

describe('ScoringService', () => {
  describe('calculateDesignScore', () => {
    it('should calculate design score as average of visual hierarchy and mobile friendliness', () => {
      const critique = {
        visualHierarchyRating: 80,
        mobileFriendlinessRating: 60,
      };
      const score = ScoringService.calculateDesignScore(critique);
      expect(score).toBe(70);
    });

    it('should clamp scores between 0 and 100', () => {
      expect(
        ScoringService.calculateDesignScore({
          visualHierarchyRating: -10,
          mobileFriendlinessRating: -20,
        }),
      ).toBe(0);

      expect(
        ScoringService.calculateDesignScore({
          visualHierarchyRating: 120,
          mobileFriendlinessRating: 110,
        }),
      ).toBe(100);
    });
  });

  describe('calculateCompositeScore', () => {
    it('should compute exact weighted score according to blueprint formula (0.35, 0.25, 0.20, 0.20)', () => {
      // 0.35 * 80 + 0.25 * 90 + 0.20 * 70 + 0.20 * 100
      // = 28 + 22.5 + 14 + 20 = 84.5 -> 85
      const scores = ScoringService.calculateCompositeScore({
        designScore: 80,
        performanceScore: 90,
        accessibilityScore: 70,
        standardsScore: 100,
      });

      expect(scores.design).toBe(80);
      expect(scores.performance).toBe(90);
      expect(scores.accessibility).toBe(70);
      expect(scores.standards).toBe(100);
      expect(scores.total).toBe(85);
    });

    it('should return 100 when all scores are 100', () => {
      const scores = ScoringService.calculateCompositeScore({
        designScore: 100,
        performanceScore: 100,
        accessibilityScore: 100,
        standardsScore: 100,
      });
      expect(scores.total).toBe(100);
    });

    it('should return 0 when all scores are 0', () => {
      const scores = ScoringService.calculateCompositeScore({
        designScore: 0,
        performanceScore: 0,
        accessibilityScore: 0,
        standardsScore: 0,
      });
      expect(scores.total).toBe(0);
    });

    it('should clamp out-of-bounds input scores to 0-100', () => {
      const scores = ScoringService.calculateCompositeScore({
        designScore: 150,
        performanceScore: -50,
        accessibilityScore: 200,
        standardsScore: 100,
      });

      // 0.35*100 + 0.25*0 + 0.20*100 + 0.20*100 = 35 + 0 + 20 + 20 = 75
      expect(scores.design).toBe(100);
      expect(scores.performance).toBe(0);
      expect(scores.accessibility).toBe(100);
      expect(scores.standards).toBe(100);
      expect(scores.total).toBe(75);
    });
  });

  describe('getSiteHealthRating', () => {
    it('should categorize score < 50 as CRITICAL', () => {
      expect(ScoringService.getSiteHealthRating(0)).toBe('CRITICAL');
      expect(ScoringService.getSiteHealthRating(49)).toBe('CRITICAL');
    });

    it('should categorize score 50 to 74 as NEEDS_MODERNIZATION', () => {
      expect(ScoringService.getSiteHealthRating(50)).toBe('NEEDS_MODERNIZATION');
      expect(ScoringService.getSiteHealthRating(74)).toBe('NEEDS_MODERNIZATION');
    });

    it('should categorize score >= 75 as MODERN', () => {
      expect(ScoringService.getSiteHealthRating(75)).toBe('MODERN');
      expect(ScoringService.getSiteHealthRating(100)).toBe('MODERN');
    });
  });
});
