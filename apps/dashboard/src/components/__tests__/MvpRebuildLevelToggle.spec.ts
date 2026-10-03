/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { MvpLayoutVariant, RebuildLevel } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { apiClient, IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { PrototypeStep } from '../leadReview/PrototypeStep.js';
import { useMvpQuery } from '../../hooks/useLeads.js';
import { LEVEL_RERENDER_WAIT_MS } from '../../hooks/useLiveMvpLayout.js';

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

const mvpWith = (
  variant: MvpLayoutVariant,
  opts: { reasons?: string[]; layoutLevel?: RebuildLevel; renderedLevel?: RebuildLevel; editedAt?: string } = {},
): IMvpProjectDetail => ({
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  layout: {
    variant,
    reasons: opts.reasons ?? ['rule:default'],
    ...(opts.layoutLevel ? { rebuildLevel: opts.layoutLevel } : {}),
  },
  ...(variant === 'original'
    ? { rebuild: { coverage: 0.97, sections: 9, omitted: [], tuning: [], ...(opts.renderedLevel ? { level: opts.renderedLevel } : {}) } }
    : {}),
  ...(opts.editedAt ? { editedAt: opts.editedAt } : {}),
});

const Harness: React.FC<{ lead: ILeadItem }> = ({ lead: current }) => {
  const { data: mvp } = useMvpQuery(current.id);
  return React.createElement(PrototypeStep, { lead: current, audit, mvp });
};

describe('Faithful / Modernized toggle in the Design tools (REV-114)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(apiClient, 'generateMvp');
    vi.spyOn(apiClient, 'getLlmProviders').mockResolvedValue({ defaultProvider: 'claude', providers: [] } as never);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const render = (mvp: IMvpProjectDetail | null, leadOverrides: Partial<ILeadItem> = {}) => {
    queryClient.setQueryData(['mvp', 'lead-1'], mvp);
    vi.spyOn(apiClient, 'getMvp').mockImplementation(async () => queryClient.getQueryData(['mvp', 'lead-1']) ?? null);
    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('light') },
            React.createElement(Harness, { lead: { ...lead, ...leadOverrides } }),
          ),
        ),
      );
    });
  };

  const group = () => container.querySelector<HTMLElement>('[data-testid="mvp-rebuild-level"]');
  const levelButton = (level: RebuildLevel) =>
    Array.from(group()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((el) => el.value === level)!;
  const pressed = () =>
    Array.from(group()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .filter((el) => el.getAttribute('aria-pressed') === 'true')
      .map((el) => el.value);
  const text = (s: string) => document.body.textContent?.includes(s) ?? false;
  const rerendering = () => text(en.mvpLayout.rerendering);
  const tick = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

  it('shows the toggle when the live layout is the original and hides it for a template', () => {
    render(mvpWith('original', { renderedLevel: 'faithful' }));
    expect(group()).not.toBeNull();
    expect(levelButton('faithful').textContent).toBe(en.mvpLayout.level.faithful);
    expect(levelButton('modern').textContent).toBe(en.mvpLayout.level.modern);
    expect(pressed()).toEqual(['faithful']);
    act(() => root.unmount());
    root = createRoot(container);
    render(mvpWith('bento'));
    expect(group()).toBeNull();
  });

  it('has an accessible group label', () => {
    render(mvpWith('original'));
    expect(group()!.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe(en.mvpLayout.level.label);
  });

  it('selects the saved level', () => {
    render(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'modern' }));
    expect(pressed()).toEqual(['modern']);
  });

  it('saves a click on Modernized as the original layout at the modern level', async () => {
    render(mvpWith('original', { renderedLevel: 'faithful' }));
    const save = vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'faithful' }));
    act(() => levelButton('modern').click());
    expect(pressed()).toEqual(['modern']);
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('mvp-1', 'original', 'modern'));
  });

  it('is disabled while the MVP is locked', () => {
    render(mvpWith('original'), { status: 'SENT' });
    expect(levelButton('modern').disabled).toBe(true);
  });

  it('is disabled while a free-text change is pending', async () => {
    render(mvpWith('original'));
    expect(levelButton('modern').disabled).toBe(false);
    const edit = new Promise<never>(() => undefined);
    vi.spyOn(apiClient, 'editMvp').mockReturnValue(edit);
    const textbox = container.querySelector<HTMLTextAreaElement>('textarea, input[type="text"]')!;
    expect(textbox).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textbox), 'value')!.set!;
    act(() => {
      setter.call(textbox, 'make it calmer');
      textbox.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = Array.from(container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))[0];
    act(() => submit.click());
    await vi.waitFor(() => expect(levelButton('modern').disabled).toBe(true));
  });

  it('says the modern look is suggested when the site looks dated', () => {
    render(mvpWith('original', { reasons: ['rule:derived', 'modernize:dated'], layoutLevel: 'modern', renderedLevel: 'modern' }));
    expect(text(en.mvpLayout.level.suggested)).toBe(true);
    expect(text(en.mvpLayout.level.defaultDesign)).toBe(false);
  });

  it('says the default design was used when the AI choice was not available', () => {
    render(mvpWith('original', { reasons: ['modernize:dated', 'modernize:default'], layoutLevel: 'modern', renderedLevel: 'modern' }));
    expect(text(en.mvpLayout.level.defaultDesign)).toBe(true);
    expect(text(en.mvpLayout.level.suggested)).toBe(false);
  });

  it('shows no caption without a modernize reason', () => {
    render(mvpWith('original', { renderedLevel: 'faithful' }));
    expect(text(en.mvpLayout.level.suggested)).toBe(false);
    expect(text(en.mvpLayout.level.defaultDesign)).toBe(false);
  });

  it('shows Re-rendering until the polled MVP has been rendered at the picked level', async () => {
    render(mvpWith('original', { renderedLevel: 'faithful' }));
    // The save's answer carries the new level on the layout, but the page is rendered after it
    vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(
      mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'faithful' }),
    );
    act(() => levelButton('modern').click());
    await vi.waitFor(() => expect(rerendering()).toBe(true));

    await tick(2000);
    expect(rerendering()).toBe(true);

    vi.mocked(apiClient.getMvp).mockResolvedValue(
      mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'modern', editedAt: '2026-10-03T12:00:00.000Z' }),
    );
    await tick(2000);
    await vi.waitFor(() => expect(rerendering()).toBe(false));
    expect(pressed()).toEqual(['modern']);
  });

  it('keeps waiting for a level pick past 90 s, as the model may be asked twice, until the page is at the picked level', async () => {
    expect(LEVEL_RERENDER_WAIT_MS).toBeGreaterThanOrEqual(2 * 90_000 + 30_000);
    render(mvpWith('original', { renderedLevel: 'faithful' }));
    vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'faithful' }));
    act(() => levelButton('modern').click());
    await vi.waitFor(() => expect(rerendering()).toBe(true));
    vi.mocked(apiClient.getMvp).mockResolvedValue(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'faithful' }));

    await tick(120_000);
    expect(rerendering()).toBe(true);

    vi.mocked(apiClient.getMvp).mockResolvedValue(
      mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'modern', editedAt: '2026-10-03T12:00:00.000Z' }),
    );
    await tick(2000);
    await vi.waitFor(() => expect(rerendering()).toBe(false));
    expect(pressed()).toEqual(['modern']);
  });

  it('stops waiting for a level pick that never arrives after LEVEL_RERENDER_WAIT_MS', async () => {
    render(mvpWith('original', { renderedLevel: 'faithful' }));
    vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'faithful' }));
    act(() => levelButton('modern').click());
    await vi.waitFor(() => expect(rerendering()).toBe(true));
    vi.mocked(apiClient.getMvp).mockResolvedValue(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'faithful' }));
    await tick(LEVEL_RERENDER_WAIT_MS - 10_000);
    expect(rerendering()).toBe(true);
    await tick(14_000);
    await vi.waitFor(() => expect(rerendering()).toBe(false));
  });

  it('counts an older MVP without a rendered level as faithful', async () => {
    render(mvpWith('original', { layoutLevel: 'modern', renderedLevel: 'modern' }));
    vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('original', { layoutLevel: 'faithful', renderedLevel: 'modern' }));
    act(() => levelButton('faithful').click());
    await vi.waitFor(() => expect(rerendering()).toBe(true));
    vi.mocked(apiClient.getMvp).mockResolvedValue(
      mvpWith('original', { layoutLevel: 'faithful', editedAt: '2026-10-03T12:00:00.000Z' }),
    );
    await tick(2000);
    await vi.waitFor(() => expect(rerendering()).toBe(false));
  });
});
