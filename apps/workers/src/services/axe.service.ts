import AxeBuilder from '@axe-core/playwright';
import { Page } from 'playwright';
import {
  IA11ySummary,
  IA11yViolation,
  IAxeViolation,
  IMeasurementError,
} from '@revamp/shared-types';
import { sanitizeAuditError } from '@revamp/validation';

/**
 * The accessibility scan's result. A scan that failed has no score or summary and lists the reason in
 * `errors`; it is never reported as a clean page or a stand-in score (REV-100)
 */
export interface AxeAuditResult {
  a11yScore?: number;
  summary?: IA11ySummary;
  /** Every violation the scan found, trimmed for storage (REV-102); absent when the scan failed */
  violations?: IAxeViolation[];
  errors: IMeasurementError[];
}

/** Storage limits for the violations kept on the audit: a large page must not overflow the document */
export const AXE_STORAGE_LIMITS = {
  nodesPerViolation: 20,
  targetChars: 300,
  htmlChars: 300,
  failureSummaryChars: 500,
} as const;

const AXE_IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const;

export interface AxeViolationItem {
  id?: string;
  impact?: string | null;
  description?: string;
  help?: string;
  helpUrl?: string;
  tags?: string[];
  nodes?: Array<{ target?: unknown; html?: string; failureSummary?: string }>;
}

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** An axe node target (a selector, or a path of selectors through iframes and shadow roots) as one string */
const targetSelector = (target: unknown): string =>
  Array.isArray(target)
    ? target.map((part) => (Array.isArray(part) ? part.join(' ') : String(part))).join(' ')
    : String(target || '');

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
   * The violations as axe reported them, for the audit (REV-102). Selectors, node HTML and failure
   * summaries are truncated and at most `nodesPerViolation` nodes are kept per rule; `nodeCount` keeps
   * the full count
   */
  static toStoredViolations(violations: AxeViolationItem[]): IAxeViolation[] {
    return violations.map((v) => {
      const nodes = v.nodes ?? [];
      const impact = AXE_IMPACTS.find((level) => level === v.impact);
      return {
        id: v.id ?? 'unknown',
        ...(impact ? { impact } : {}),
        description: v.description ?? '',
        help: v.help ?? '',
        helpUrl: v.helpUrl ?? '',
        tags: v.tags ?? [],
        nodeCount: nodes.length,
        nodes: nodes.slice(0, AXE_STORAGE_LIMITS.nodesPerViolation).map((node) => ({
          target: truncate(targetSelector(node.target), AXE_STORAGE_LIMITS.targetChars),
          html: truncate(node.html ?? '', AXE_STORAGE_LIMITS.htmlChars),
          ...(node.failureSummary
            ? {
                failureSummary: truncate(
                  node.failureSummary,
                  AXE_STORAGE_LIMITS.failureSummaryChars,
                ),
              }
            : {}),
        })),
      };
    });
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
        violations: AxeService.toStoredViolations(violations),
        errors: [],
      };
    } catch (error) {
      console.warn('[AxeService] Warning: Failed to complete Axe-core scan on page:', error);
      // The page closed early or blocked script injection: the scan is reported as not run
      return {
        errors: [{ measurement: 'accessibility', message: sanitizeAuditError(error) }],
      };
    }
  }
}

export const axeService = new AxeService();
