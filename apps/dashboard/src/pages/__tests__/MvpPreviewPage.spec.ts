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
};

const mvp: IMvpProjectDetail = {
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  layout: { variant: 'bento', reasons: ['rule:default'] },
  colorPalette: { primary: '#059669', secondary: '#b8c4fe', accent: '#059669' },
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
  const colorInput = () => container.querySelector<HTMLInputElement>('#brand-color-picker-input')!;
  const layoutButton = (variant: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="mvp-layout-picker"] button')).find(
      (el) => el.value === variant,
    )!;
  const pick = (hex: string) =>
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(colorInput(), hex);
      colorInput().dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('shows the MVP full-window in the sandboxed iframe with the Design tools over it', async () => {
    await render([lead]);
    const frame = viewport().querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('src')).toBe('about:blank#mvp');
    expect(panel().parentElement).toBe(viewport());
    expect(panel().contains(frame)).toBe(false);
    expect(panel().querySelector('[data-testid="mvp-layout-picker"]')).not.toBeNull();
    // Starts from the palette saved on the MVP
    expect(colorInput().value).toBe('#059669');
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

  it('applies a color live and saves it on the MVP', async () => {
    await render([lead]);
    const save = vi.spyOn(apiClient, 'updateMvpTokens').mockResolvedValue({ ...mvp, colorPalette: { primary: '#e11d48', secondary: '#b8c4fe', accent: '#e11d48' } });
    pick('#e11d48');
    expect(posted).toContainEqual({ type: 'REVAMP_UPDATE_THEME', palette: { primary: '#e11d48', accent: '#e11d48' } });
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('mvp-1', { primaryColor: '#e11d48', accentColor: '#e11d48' }));
  });

  it('switches the layout live and saves it', async () => {
    await render([lead]);
    const save = vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue({ ...mvp, layout: { variant: 'split', reasons: ['rule:manual'] } });
    act(() => layoutButton('split').click());
    expect(posted).toContainEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: true });
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('mvp-1', 'split'));
  });

  it('reports a failed palette save', async () => {
    await render([lead]);
    vi.spyOn(apiClient, 'updateMvpTokens').mockRejectedValue(
      new ApiError('The MVP palette cannot be changed while the lead is SCHEDULED', 409, 'MVP_PALETTE_CHANGE_NOT_ALLOWED'),
    );
    pick('#e11d48');
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        en.colorPicker.saveFailed.replace('{{message}}', 'The MVP palette cannot be changed while the lead is SCHEDULED'),
      ),
    );
  });

  it.each(['SCHEDULED', 'SENT', 'GENERATING'] as const)('locks both pickers while the lead is %s', async (status) => {
    await render([{ ...lead, status }]);
    expect(colorInput().disabled).toBe(true);
    expect(layoutButton('split').disabled).toBe(true);
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
