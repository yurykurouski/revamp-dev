import { describe, it, expect, vi } from 'vitest';
import { VitalsService } from '../vitals.service.js';

describe('VitalsService', () => {
  it('should calculate performance scores using Google CWV thresholds', () => {
    // Fast LCP <= 1.8s, low CLS <= 0.1
    expect(VitalsService.calculatePerformanceScore(1.2, 0.02)).toBe(100);

    // Moderate LCP <= 2.5s
    expect(VitalsService.calculatePerformanceScore(2.3, 0.05)).toBe(90);

    // Needs improvement LCP 2.5 - 4.0s
    expect(VitalsService.calculatePerformanceScore(3.5, 0.15)).toBe(50);

    // Poor LCP > 4.0s
    expect(VitalsService.calculatePerformanceScore(5.2, 0.3)).toBe(10);
  });

  it('should calculate standards score based on SSL, Viewport, and Title', () => {
    expect(VitalsService.calculateStandardsScore(true, true, true)).toBe(100);
    expect(VitalsService.calculateStandardsScore(false, true, true)).toBe(60);
    expect(VitalsService.calculateStandardsScore(true, false, false)).toBe(40);
  });

  it('should collect vitals from page evaluate', async () => {
    const service = new VitalsService();
    const mockPage: any = {
      evaluate: vi.fn().mockResolvedValue({
        lcpMs: 2400,
        cls: 0.04,
        speedIndexMs: 2200,
        hasViewport: true,
        hasTitle: true,
      }),
    };

    const result = await service.collectVitals(mockPage, 'https://example-secure.com');

    expect(result.lcpSeconds).toBe(2.4);
    expect(result.lighthouseMetrics.lcp).toBe(2400);
    expect(result.lighthouseMetrics.cls).toBe(0.04);
    expect(result.standards.hasSsl).toBe(true);
    expect(result.standards.hasViewport).toBe(true);
    expect(result.performanceScore).toBeGreaterThanOrEqual(80);
    expect(result.standardsScore).toBe(100);
  });
});
