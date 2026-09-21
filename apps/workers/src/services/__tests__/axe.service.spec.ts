import { describe, it, expect, vi } from 'vitest';
import { AxeService } from '../axe.service.js';

vi.mock('@axe-core/playwright', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        withTags: vi.fn().mockReturnThis(),
        analyze: vi.fn().mockResolvedValue({
          violations: [
            {
              id: 'color-contrast',
              impact: 'serious',
              description: 'Ensures the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
              nodes: [
                { target: ['#header > p'] },
                { target: ['#footer > span'] },
              ],
            },
            {
              id: 'image-alt',
              impact: 'critical',
              description: 'Ensures <img> elements have alternate text or a role of none or presentation',
              nodes: [{ target: ['img.banner'] }],
            },
            {
              id: 'heading-order',
              impact: 'moderate',
              description: 'Ensures the order of headings is semantically correct',
              nodes: [{ target: ['h3.sub'] }],
            },
          ],
        }),
      };
    }),
  };
});

describe('AxeService', () => {
  it('should calculate weighted score reductions correctly', () => {
    // 1 critical (-15), 1 serious (-10) = 75
    const score = AxeService.calculateScore([
      { impact: 'critical', nodes: [{}] },
      { impact: 'serious', nodes: [{}] },
    ]);
    expect(score).toBe(75);
  });

  it('should return 100 when there are no accessibility violations', () => {
    const score = AxeService.calculateScore([]);
    expect(score).toBe(100);
  });

  it('should floor the score at 0 for extremely high violation counts', () => {
    const score = AxeService.calculateScore([
      { impact: 'critical', nodes: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}] }, // 10 * 15 = 150 deductions
    ]);
    expect(score).toBe(0);
  });

  it('should scan page and categorize violations into summary', async () => {
    const service = new AxeService();
    const mockPage: any = {};

    const result = await service.scanPage(mockPage);

    expect(result.summary.violationsCount).toBe(3);
    expect(result.summary.contrastIssuesCount).toBe(2);
    expect(result.summary.missingAltCount).toBe(1);
    expect(result.summary.criticalViolations.length).toBeGreaterThan(0);
    expect(result.a11yScore).toBeLessThan(100);
  });
});
