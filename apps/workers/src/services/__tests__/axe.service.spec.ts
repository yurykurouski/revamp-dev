import { describe, it, expect, vi } from 'vitest';
import AxeBuilder from '@axe-core/playwright';
import { AxeService, AXE_STORAGE_LIMITS } from '../axe.service.js';

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
    expect(result.errors).toEqual([]);
    // Every violation is kept for the audit, not only the critical ones (REV-102)
    expect(result.violations?.map((v) => [v.id, v.impact, v.nodeCount])).toEqual([
      ['color-contrast', 'serious', 2],
      ['image-alt', 'critical', 1],
      ['heading-order', 'moderate', 1],
    ]);
    expect(result.violations?.[0].nodes.map((n) => n.target)).toEqual(['#header > p', '#footer > span']);
  });

  it('keeps each violation for storage with its rule, help and nodes (REV-102)', () => {
    const [stored] = AxeService.toStoredViolations([
      {
        id: 'label',
        impact: 'critical',
        description: 'Form elements must have labels',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
        tags: ['wcag2a', 'wcag412'],
        nodes: [
          {
            target: [['iframe#booking', 'input#name']],
            html: '<input id="name">',
            failureSummary: 'Fix any of the following: Form element does not have an implicit label',
          },
        ],
      },
    ]);

    expect(stored).toEqual({
      id: 'label',
      impact: 'critical',
      description: 'Form elements must have labels',
      help: 'Form elements must have labels',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
      tags: ['wcag2a', 'wcag412'],
      nodeCount: 1,
      nodes: [
        {
          target: 'iframe#booking input#name',
          html: '<input id="name">',
          failureSummary: 'Fix any of the following: Form element does not have an implicit label',
        },
      ],
    });
  });

  it('caps nodes per rule and truncates long selectors, HTML and summaries, keeping the full node count', () => {
    const nodes = Array.from({ length: AXE_STORAGE_LIMITS.nodesPerViolation + 5 }, (_, i) => ({
      target: [`li:nth-child(${i + 1}) ${'> div '.repeat(AXE_STORAGE_LIMITS.targetChars)}`],
      html: 'x'.repeat(AXE_STORAGE_LIMITS.htmlChars * 3),
      failureSummary: 'y'.repeat(AXE_STORAGE_LIMITS.failureSummaryChars * 2),
    }));

    const [stored] = AxeService.toStoredViolations([{ id: 'list', impact: 'serious', nodes }]);

    expect(stored.nodeCount).toBe(AXE_STORAGE_LIMITS.nodesPerViolation + 5);
    expect(stored.nodes).toHaveLength(AXE_STORAGE_LIMITS.nodesPerViolation);
    expect(stored.nodes[0].html).toHaveLength(AXE_STORAGE_LIMITS.htmlChars);
    expect(stored.nodes[0].target).toHaveLength(AXE_STORAGE_LIMITS.targetChars);
    expect(stored.nodes[0].target.startsWith('li:nth-child(1)')).toBe(true);
    expect(stored.nodes[0].html.endsWith('…')).toBe(true);
    expect(stored.nodes[0].failureSummary).toHaveLength(AXE_STORAGE_LIMITS.failureSummaryChars);
  });

  it('leaves out an unknown impact rather than guessing one', () => {
    const [stored] = AxeService.toStoredViolations([{ id: 'region', impact: null, nodes: [{ target: ['div'] }] }]);

    expect(stored).not.toHaveProperty('impact');
    expect(stored.nodes).toEqual([{ target: 'div', html: '' }]);
    expect(stored.tags).toEqual([]);
  });

  it('reports the scan as not measured when axe fails, never as a clean page or a stand-in score', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(AxeBuilder).mockImplementationOnce(function () {
      return {
        withTags: vi.fn().mockReturnThis(),
        analyze: vi.fn().mockRejectedValue(new Error('Target page, context or browser has been closed')),
      } as any;
    });

    const result = await new AxeService().scanPage({} as any);

    expect(result).toEqual({
      errors: [{ measurement: 'accessibility', message: 'Target page, context or browser has been closed' }],
    });
    expect(result.a11yScore).toBeUndefined();
    expect(result.summary).toBeUndefined();
    warn.mockRestore();
  });
});
