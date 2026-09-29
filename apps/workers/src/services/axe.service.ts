import AxeBuilder from '@axe-core/playwright';
import { Page } from 'playwright';
import { IA11ySummary, IA11yViolation, IMeasurementError } from '@revamp/shared-types';
import { sanitizeAuditError } from '@revamp/validation';

/**
 * The accessibility scan's result. A scan that failed has no score or summary and lists the reason in
 * `errors`; it is never reported as a clean page or a stand-in score (REV-100)
 */
export interface AxeAuditResult {
  a11yScore?: number;
  summary?: IA11ySummary;
  rawViolations: unknown[];
  errors: IMeasurementError[];
}

export interface AxeViolationItem {
  id?: string;
  impact?: string | null;
  description?: string;
  nodes?: Array<{ target?: unknown }>;
}

export class AxeService {
  /**
   * Calculates normalized accessibility score (0 - 100) based on WCAG 2.1 AA violations
   */
  static calculateScore(violations: AxeViolationItem[]): number {
    let deductions = 0;

    for (const v of violations) {
      const nodeCount = v.nodes?.length || 1;
      switch (v.impact) {
        case 'critical':
          deductions += 15 * nodeCount;
          break;
        case 'serious':
          deductions += 10 * nodeCount;
          break;
        case 'moderate':
          deductions += 5 * nodeCount;
          break;
        case 'minor':
          deductions += 2 * nodeCount;
          break;
        default:
          deductions += 3 * nodeCount;
          break;
      }
    }

    return Math.max(0, Math.min(100, Math.round(100 - deductions)));
  }

  /**
   * Analyzes an active Playwright page with Axe-core WCAG 2.1 AA rules
   */
  async scanPage(page: Page): Promise<AxeAuditResult> {
    try {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const violations = results.violations || [];
      let contrastIssuesCount = 0;
      let missingAltCount = 0;
      const criticalViolations: IA11yViolation[] = [];

      for (const v of violations) {
        const nodeCount = v.nodes?.length || 1;

        if (v.id === 'color-contrast') {
          contrastIssuesCount += nodeCount;
        }
        if (v.id === 'image-alt') {
          missingAltCount += nodeCount;
        }

        if (v.impact === 'critical' || v.impact === 'serious') {
          for (const node of v.nodes || []) {
            const selector = Array.isArray(node.target)
              ? node.target.join(' ')
              : String(node.target || '');
            criticalViolations.push({
              id: v.id,
              description: v.description,
              impact: v.impact as 'critical' | 'serious',
              selector: selector || 'body',
            });
          }
        }
      }

      const a11yScore = AxeService.calculateScore(violations);

      return {
        a11yScore,
        summary: {
          violationsCount: violations.length,
          contrastIssuesCount,
          missingAltCount,
          criticalViolations: criticalViolations.slice(0, 15), // cap top 15 critical violations
        },
        rawViolations: violations,
        errors: [],
      };
    } catch (error) {
      console.warn('[AxeService] Warning: Failed to complete Axe-core scan on page:', error);
      // The page closed early or blocked script injection: the scan is reported as not run
      return {
        rawViolations: [],
        errors: [{ measurement: 'accessibility', message: sanitizeAuditError(error) }],
      };
    }
  }
}

export const axeService = new AxeService();
