/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { ApiError, apiClient, IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { ROUTES } from '../../routes/paths.js';
import { MvpPreviewPage } from '../MvpPreviewPage.js';

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
  quickWins: [],
  colorPalette: { primary: '#123456' },
  measurementErrors: [],
  designCritiqueFallback: false,
};

const mvp: IMvpProjectDetail = {
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  theme: {
    primary: '#059669',
    accent: '#f2a900',
    bg: '#ffffff',
    surface: '#ffffff',
    text: '#111111',
    fontHeading: 'Lora, serif',
    fontBody: 'Lato, sans-serif',
  },
  versions: [
    { n: 1, kind: 'generate', storagePath: 'v/s/versions/1.html', createdAt: '2026-10-10T10:00:00.000Z' },
    { n: 2, kind: 'change', instruction: 'Shorter heading', storagePath: 'v/s/versions/2.html', createdAt: '2026-10-10T11:00:00.000Z' },
  ],
};

describe('MvpPreviewPage (REV-91)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let posted: unknown[];

  beforeEach(() => {
    window.sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    posted = [];
    vi.spyOn(apiClient, 'getAudit').mockResolvedValue(audit);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const render = async (
    leads: ILeadItem[] | Error,
    mvpDoc: IMvpProjectDetail | null = mvp,
    path = '/leads/lead-1/preview',
  ) => {
    if (leads instanceof Error) vi.spyOn(apiClient, 'getLeads').mockRejectedValue(leads);
    else vi.spyOn(apiClient, 'getLeads').mockResolvedValue({ leads, total: leads.length });
    vi.spyOn(apiClient, 'getMvp').mockResolvedValue(mvpDoc);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('light') },
            React.createElement(
              MemoryRouter,
              { initialEntries: [path] },
              React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: ROUTES.leadPreview, element: React.createElement(MvpPreviewPage) }),
              ),
            ),
          ),
        ),
      );
    });
    await vi.waitFor(() =>
      expect(container.querySelector('iframe, [role="alert"]')).not.toBeNull(),
    );
    // Flush the audit and MVP queries
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const frame = container.querySelector('iframe');
    if (frame?.contentWindow) {
      vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation((message: unknown) => {
        posted.push(message);
      });
    }
  };

  const viewport = () => container.querySelector<HTMLElement>('[data-testid="mvp-preview-viewport"]')!;
  const panel = () => container.querySelector<HTMLElement>('[data-testid="mvp-tools-panel"]')!;
  const hex = () => container.querySelector<HTMLInputElement>('[data-testid="mvp-color-hex"] input')!;
  const restore = (n: number) => container.querySelector<HTMLButtonElement>(`[data-testid="mvp-version-restore-${n}"]`)!;

  it('shows the MVP full-window in the sandboxed iframe with the Design tools over it', async () => {
    await render([lead]);
    const frame = viewport().querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('src')).toBe('about:blank#mvp');
    expect(panel().parentElement).toBe(viewport());
    expect(panel().contains(frame)).toBe(false);
    // The same Design tools as the Prototype step (REV-140), starting from the page's own colors
    for (const testId of ['mvp-edit-prompt', 'mvp-color-controls', 'mvp-font-control', 'mvp-version-list']) {
      expect(panel().querySelector(`[data-testid="${testId}"]`), testId).not.toBeNull();
    }
    expect(hex().value).toBe('#059669');
  });

  it('links back to the review and to the page the lead receives', async () => {
    await render([lead]);
    expect(container.querySelector('h1')!.textContent).toBe('Harbor Dental');
    const back = Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find((a) =>
      a.textContent?.includes(en.mvpPreviewPage.backToReview),
    )!;
    expect(back.getAttribute('href')).toBe('/leads/lead-1');
    const published = container.querySelector<HTMLAnchorElement>(`a[aria-label="${en.mvpPreviewPage.openPublished}"]`)!;
    expect(published.getAttribute('href')).toBe('about:blank#mvp');
    expect(published.getAttribute('target')).toBe('_blank');
  });

  it('restores a version from the full-window preview (REV-140)', async () => {
    await render([lead]);
    const save = vi.spyOn(apiClient, 'restoreMvpVersion').mockResolvedValue({ applied: true, version: 3, mvp });
    await act(async () => restore(1).click());
    expect(save).toHaveBeenCalledWith('mvp-1', 1);
  });

  it('reports a failed change', async () => {
    await render([lead]);
    vi.spyOn(apiClient, 'restoreMvpVersion').mockRejectedValue(
      new ApiError('The MVP cannot be changed while the lead is SCHEDULED', 409, 'MVP_EDIT_NOT_ALLOWED'),
    );
    await act(async () => restore(1).click());
    await vi.waitFor(() => expect(document.body.textContent).toContain('The MVP cannot be changed while the lead is SCHEDULED'));
  });

  it.each(['SCHEDULED', 'SENT', 'GENERATING'] as const)('locks the tools while the lead is %s', async (status) => {
    await render([{ ...lead, status }]);
    expect(hex().disabled).toBe(true);
    expect(restore(1).disabled).toBe(true);
  });

  it('says so when the lead has no MVP yet', async () => {
    await render([{ ...lead, previewUrl: undefined }], null);
    await vi.waitFor(() => expect(document.body.textContent).toContain(en.mvpPreviewPage.noMvp));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('says so when the lead does not exist', async () => {
    await render([lead], mvp, '/leads/unknown/preview');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(en.leadRoute.notFound);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('reports a leads list that failed to load', async () => {
    await render(new Error('API unreachable'));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')!.textContent).toContain(en.leadsPage.loadFailed));
    expect(container.querySelector('iframe')).toBeNull();
  });
});
