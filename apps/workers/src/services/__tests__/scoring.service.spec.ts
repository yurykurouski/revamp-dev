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

  describe('calculateCompositeScore with unmeasured pillars (REV-100)', () => {
    it('leaves an unmeasured pillar out and rescales the remaining weights', () => {
      // Accessibility not measured: (0.35*80 + 0.25*90 + 0.20*100) / 0.80 = 70.5 / 0.8 = 88.125 -> 88
      const scores = ScoringService.calculateCompositeScore({
        designScore: 80,
        performanceScore: 90,
        standardsScore: 100,
      });

      expect(scores).toEqual({ total: 88, design: 80, performance: 90, standards: 100 });
      expect('accessibility' in scores).toBe(false);
    });

    it('does not count an unmeasured pillar as 0', () => {
      const withZero = ScoringService.calculateCompositeScore({
        designScore: 60,
        performanceScore: 0,
        accessibilityScore: 60,
        standardsScore: 60,
      });
      const unmeasured = ScoringService.calculateCompositeScore({
        designScore: 60,
        accessibilityScore: 60,
        standardsScore: 60,
      });

      expect(withZero.total).toBe(45);
      expect(unmeasured.total).toBe(60);
    });

    it('scores on design alone when every deterministic measurement failed', () => {
      expect(ScoringService.calculateCompositeScore({ designScore: 42 })).toEqual({ total: 42, design: 42 });
    });
  });

  describe('calculateCompositeScore without a design score (REV-101)', () => {
    it('leaves the design pillar out when the critique is a template', () => {
      // (0.25*40 + 0.20*60 + 0.20*100) / 0.65 = 64.6 -> 65
      const scores = ScoringService.calculateCompositeScore({
        performanceScore: 40,
        accessibilityScore: 60,
        standardsScore: 100,
      });

      expect(scores).toEqual({ total: 65, performance: 40, accessibility: 60, standards: 100 });
      expect('design' in scores).toBe(false);
    });

    it('throws when no pillar was measured instead of inventing a total', () => {
      expect(() => ScoringService.calculateCompositeScore({})).toThrow('No part of the audit could be measured');
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
