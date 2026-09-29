/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import type { IAuditDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { AUDIT_FINDINGS_WIDTH, AUDIT_ROW_BREAKPOINT, AuditStep, NOT_MEASURED } from '../leadReview/AuditStep.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  lcpSeconds: 4.8,
  a11yViolationsCount: 17,
  mobileFriendlinessRating: 35,
  criticalFlaws: [{ title: 'No call to action above the fold', impact: 'Visitors leave', recommendation: 'Add a booking button' }],
  quickWins: ['Compress the hero image'],
  colorPalette: { primary: '#123456' },
  measurementErrors: [],
};

const theme = getTheme('dark', 'en');

/** Emotion's CSS in the document, whitespace removed */
const cssText = () =>
  [...document.head.querySelectorAll('style')].map((style) => style.textContent ?? '').join('').replace(/\s+/g, '');

/** The declarations for a class inside the `min-width` media rule of a breakpoint */
const rulesAt = (css: string, className: string, px: number) =>
  [...css.matchAll(new RegExp(`@media\\(min-width:${px}px\\)\\{\\.${className}\\{([^}]*)\\}\\}`, 'g'))]
    .map((m) => m[1])
    .join(';');

describe('AuditStep layout (REV-83)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const mount = () =>
    act(() => {
      root.render(
        React.createElement(ThemeProvider, { theme }, React.createElement(AuditStep, { audit, mvp: null, isLoading: false })),
      );
    });

  it('puts the findings beside the screenshot only from xl, which is wider than lg', () => {
    expect(AUDIT_ROW_BREAKPOINT).toBe('xl');
    expect(AUDIT_FINDINGS_WIDTH).toBe(380);
    expect(theme.breakpoints.values[AUDIT_ROW_BREAKPOINT]).toBeGreaterThan(theme.breakpoints.values.lg);
  });

  it('stacks the findings under the screenshot below xl and sets the row from xl up', () => {
    mount();
    const css = cssText();
    const grid = [...(container.firstElementChild as HTMLElement).classList].find((c) => c.startsWith('css-'))!;
    const { values } = theme.breakpoints;
    const row = `grid-template-columns:minmax(0,1fr)${AUDIT_FINDINGS_WIDTH}px`;

    // Stacked from xs, full width
    expect(css).toContain(`.${grid}{display:grid;`);
    expect(rulesAt(css, grid, values.xs)).toBe('grid-template-columns:1fr;');
    // Side by side only from xl; nothing switches at lg (or md)
    expect(rulesAt(css, grid, values.xl)).toBe(`${row};height:100%;`);
    expect(rulesAt(css, grid, values.lg)).toBe('');
    expect(rulesAt(css, grid, values.md)).toBe('');
  });

  it('shows the findings in the stacked layout', () => {
    mount();
    expect(container.textContent).toContain('No call to action above the fold');
    expect(container.textContent).toContain('Compress the hero image');
  });
});

describe('AuditStep measurement errors (REV-100)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const render = (value: IAuditDetail) =>
    act(() => {
      root.render(
        React.createElement(ThemeProvider, { theme }, React.createElement(AuditStep, { audit: value, mvp: null, isLoading: false })),
      );
    });

  it('names each failed measurement with its reason and shows its metric as not measured', () => {
    render({
      ...audit,
      lcpSeconds: undefined,
      a11yViolationsCount: undefined,
      measurementErrors: [
        { measurement: 'performance', message: 'The page reported no largest-contentful-paint entry' },
        { measurement: 'accessibility', message: 'Target page, context or browser has been closed' },
      ],
    });

    const alert = container.querySelector('[data-testid="measurement-errors"]')!;
    expect(alert.textContent).toContain('The total score counts only the measured parts');
    const items = [...alert.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual([
      'Performance (LCP, CLS): The page reported no largest-contentful-paint entry',
      'Accessibility (axe): Target page, context or browser has been closed',
    ]);
    // The metric tiles show the not-measured mark, never a number
    expect(container.textContent).not.toContain('violations');
    expect(container.textContent).toContain(NOT_MEASURED);
  });

  it('shows no warning when every measurement was taken', () => {
    render(audit);

    expect(container.querySelector('[data-testid="measurement-errors"]')).toBeNull();
    expect(container.textContent).toContain('4.8s');
  });
});
