/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { apiClient, IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { CHANGE_SUMMARY_PEEK, PrototypeStep } from '../leadReview/PrototypeStep.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead: ILeadItem = {
  id: 'lead-1',
  businessName: 'Harbor Dental',
  domain: 'harbor.example',
  originalUrl: 'https://harbor.example',
  niche: 'dental',
  city: 'Vilnius',
  status: 'NEEDS_APPROVAL',
  auditId: 'audit-1',
  // happy-dom loads iframe sources, so the preview points nowhere
  previewUrl: 'about:blank#mvp',
  createdAt: '2026-09-27T10:00:00.000Z',
};

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: ['Pin a call bar to the bottom of the mobile screen'],
  colorPalette: { primary: '#123456' },
  measurementErrors: [],
};

const mvp: IMvpProjectDetail = {
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  layout: { variant: 'editorial', reasons: ['operator'] },
};

describe('Prototype step layout (REV-96)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(apiClient, 'getLlmProviders').mockResolvedValue({ defaultProvider: 'claude', providers: [] } as never);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const render = (currentMvp: IMvpProjectDetail | null) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('dark') },
            React.createElement(PrototypeStep, { lead, audit, mvp: currentMvp }),
          ),
        ),
      );
    });
  };

  const card = () => container.querySelector<HTMLElement>('[data-testid="prototype-card"]')!;
  const stage = () => container.querySelector<HTMLElement>('[data-testid="prototype-stage"]')!;

  it('keeps the toolbar and preview together in a stage that fills the card less the summary peek', () => {
    render(mvp);
    expect(stage().querySelector('[data-testid="prototype-viewport"]')).not.toBeNull();
    expect(stage().textContent).toContain('Interactive MVP');

    const style = window.getComputedStyle(stage());
    expect(style.height).toBe(`calc(100% - ${CHANGE_SUMMARY_PEEK}px)`);
    // Never shrunk by a long summary; grows over the peek when there is none
    expect(style.flexShrink).toBe('0');
    expect(style.flexGrow).toBe('1');
  });

  it('puts the "What changed" summary after the stage and lets the card scroll to it', () => {
    render(mvp);
    const summary = container.querySelector('section[aria-labelledby="mvp-changes-title"]');
    expect(summary).not.toBeNull();
    expect(stage().contains(summary)).toBe(false);
    expect(stage().compareDocumentPosition(summary!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(window.getComputedStyle(card()).overflowY).toBe('auto');
  });

  it('renders only the stage while the MVP is still being built', () => {
    render(null);
    expect(stage()).not.toBeNull();
    expect(container.querySelector('section[aria-labelledby="mvp-changes-title"]')).toBeNull();
  });
});
