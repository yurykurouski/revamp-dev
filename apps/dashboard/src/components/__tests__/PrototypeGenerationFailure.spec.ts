/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { apiClient, IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { PrototypeStep } from '../leadReview/PrototypeStep.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audited: ILeadItem = {
  id: 'lead-1',
  businessName: 'Harbor Dental',
  domain: 'harbor.example',
  originalUrl: 'https://harbor.example',
  niche: 'dental',
  status: 'AUDITED',
  auditId: 'audit-1',
  generationError: 'MVP deploy failed: MVP_REBUILD_UNAVAILABLE: grouping:not_configured',
  generationFailure: { code: 'MVP_REBUILD_UNAVAILABLE', reason: 'grouping:not_configured', level: 'faithful', at: '2026-10-04T12:00:00.000Z' },
  createdAt: '2026-09-27T10:00:00.000Z',
};

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: [],
  colorPalette: { primary: '#123456' },
  measurementErrors: [],
  designCritiqueFallback: false,
};

describe('Prototype step: a generation a rebuild model could not make (REV-132)', () => {
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

  const render = (lead: ILeadItem, mvp: IMvpProjectDetail | null = null) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, { theme: getTheme('light') }, React.createElement(PrototypeStep, { lead, audit, mvp })),
        ),
      );
    });
  };
  const panel = () => container.querySelector<HTMLElement>('[data-testid="mvp-generation-failure"]');
  const templateButton = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === en.mvpFailure.useTemplate);

  it('says why in the interface language instead of a spinner, and offers a template layout', () => {
    render(audited);
    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toContain(en.mvpFailure.title);
    expect(panel()!.textContent).toContain(en.mvpLayout.rebuildRefused.grouping.not_configured);
    expect(container.textContent).not.toContain(en.inspector.generatingTitle);
    expect(templateButton()).toBeDefined();
  });

  it('names a modernize failure too', () => {
    render({ ...audited, generationFailure: { code: 'MVP_MODERNIZE_UNAVAILABLE', reason: 'invalid_answer', level: 'modern', at: '2026-10-04T12:00:00.000Z' } });
    expect(panel()!.textContent).toContain(en.mvpLayout.level.unavailable.invalid_answer);
  });

  it('generates with the Bento template when the operator asks', async () => {
    const generate = vi.spyOn(apiClient, 'generateMvp').mockResolvedValue({ success: true, status: 'GENERATING' });
    render(audited);
    act(() => templateButton()!.click());
    await vi.waitFor(() => expect(generate).toHaveBeenCalledWith('audit-1', { forceRegenerate: false, layout: 'bento' }));
  });

  it('regenerates over an MVP the lead already has, which stays published', async () => {
    const generate = vi.spyOn(apiClient, 'generateMvp').mockResolvedValue({ success: true, status: 'GENERATING' });
    const mvp: IMvpProjectDetail = { id: 'mvp-1', leadId: 'lead-1', fullPreviewUrl: 'about:blank#mvp', layout: { variant: 'original', reasons: [] } };
    render({ ...audited, status: 'NEEDS_APPROVAL', previewUrl: 'about:blank#mvp' }, mvp);
    expect(panel()).not.toBeNull();
    expect(container.querySelector('iframe')).not.toBeNull();
    act(() => templateButton()!.click());
    await vi.waitFor(() => expect(generate).toHaveBeenCalledWith('audit-1', { forceRegenerate: true, layout: 'bento' }));
  });

  it('shows nothing while a generation runs, or without a recorded failure', () => {
    render({ ...audited, status: 'GENERATING' });
    expect(panel()).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    render({ ...audited, generationFailure: undefined });
    expect(panel()).toBeNull();
  });
});
