/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { ICompletenessCheck } from '@revamp/shared-types';
import '../../i18n/index.js';
import type { IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { en } from '../../i18n/locales/en.js';
import { MvpChangeSummary } from '../leadReview/MvpChangeSummary.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mvpWith = (checks: ICompletenessCheck[]): IMvpProjectDetail => ({
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  completenessReport: { status: 'verified', hasCriticalIssues: true, checkedAt: '2026-10-03T00:00:00Z', checks },
});

const PHONE = en.completeness.fields.phone;
const MISSING = `${PHONE}: ${en.completeness.statuses.missing}`;
const UNSOURCED = `${PHONE}: ${en.completeness.statuses.unsourced}`;

/** The business-data chips as the operator reads them */
const chips = (container: HTMLElement) =>
  [...container.querySelectorAll('.MuiChip-label')].map((chip) => chip.textContent).filter((text) => text?.startsWith(`${PHONE}: `));

const duplicateKeyWarnings = (spy: MockInstance<typeof console.error>) =>
  spy.mock.calls.filter((args: unknown[]) => args.some((arg) => String(arg).includes('same key')));

describe('MvpChangeSummary business-data chip keys (REV-115)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: MockInstance<typeof console.error>;
  const client = new QueryClient();

  const render = (mvp: IMvpProjectDetail) =>
    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(ThemeProvider, { theme: getTheme('dark') }, React.createElement(MvpChangeSummary, { mvp, audit: null })),
        ),
      );
    });

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  it('shows two issues for the same field without a duplicate-key warning', () => {
    render(
      mvpWith([
        { field: 'phone', tier: 'critical', status: 'missing' },
        { field: 'phone', tier: 'critical', status: 'unsourced', mvpValue: '+370 600 00000' },
        { field: 'email', tier: 'critical', status: 'present' },
      ]),
    );
    expect(chips(container)).toEqual([UNSOURCED, MISSING]);
    expect(duplicateKeyWarnings(consoleError)).toEqual([]);
  });

  it('keeps the chips apart when the same field and status repeat, across re-renders', () => {
    const unsourced = (mvpValue: string): ICompletenessCheck => ({ field: 'phone', tier: 'critical', status: 'unsourced', mvpValue });
    render(mvpWith([unsourced('+370 600 00001'), unsourced('+370 600 00002')]));
    render(mvpWith([{ field: 'phone', tier: 'critical', status: 'missing' }, unsourced('+370 600 00001'), unsourced('+370 600 00002')]));
    expect(chips(container)).toEqual([UNSOURCED, UNSOURCED, MISSING]);
    expect(duplicateKeyWarnings(consoleError)).toEqual([]);
  });
});
