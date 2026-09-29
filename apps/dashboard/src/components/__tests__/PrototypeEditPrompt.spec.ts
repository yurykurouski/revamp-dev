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
import { ApiError, apiClient, IAuditDetail, ILeadItem, IMvpEditResult, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { PrototypeStep } from '../leadReview/PrototypeStep.js';
import { useMvpQuery } from '../../hooks/useLeads.js';

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
  mvpGeneratedAt: '2026-09-27T10:00:00.000Z',
  createdAt: '2026-09-27T09:00:00.000Z',
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
  generatedAt: '2026-09-27T10:00:00.000Z',
  colorPalette: { primary: '#4F46E5', secondary: '#B8C4FE', accent: '#4F46E5' },
  layout: { variant: 'bento', reasons: ['rule:default'] },
};

/** Resolves on demand, to hold a request in flight */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const Harness: React.FC<{ lead: ILeadItem }> = ({ lead: current }) => {
  const { data } = useMvpQuery(current.id);
  return React.createElement(PrototypeStep, { lead: current, audit, mvp: data });
};

describe('Prototype step free-text change (REV-85)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  const render = (leadOverrides: Partial<ILeadItem> = {}, current: IMvpProjectDetail = mvp) => {
    queryClient.setQueryData(['mvp', 'lead-1'], current);
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

  const prompt = () => container.querySelector<HTMLElement>('[data-testid="mvp-edit-prompt"]')!;
  const textarea = () => prompt().querySelector<HTMLTextAreaElement>('textarea#mvp-edit-instruction')!;
  const applyButton = () => prompt().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value);
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const pressKey = (key: string, init: KeyboardEventInit = {}) =>
    act(() => {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });
  const layoutButtons = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="mvp-layout-picker"] button'));
  const iframeSrc = () => container.querySelector('iframe')!.getAttribute('src');

  it('sits in the Design tools panel and needs a few characters before it sends', () => {
    render();
    expect(container.querySelector('[data-testid="mvp-tools-panel"]')!.contains(prompt())).toBe(true);
    expect(prompt().textContent).toContain(en.mvpEdit.label);
    expect(textarea().getAttribute('placeholder')).toBe(en.mvpEdit.placeholder);
    expect(applyButton().disabled).toBe(true);

    type('ab ');
    expect(applyButton().disabled).toBe(true);
    type('Make the headline punchier');
    expect(applyButton().disabled).toBe(false);
  });

  it('applies the change, reloads the re-published preview and reports what changed', async () => {
    render();
    const pending = deferred<IMvpEditResult>();
    const edit = vi.spyOn(apiClient, 'editMvp').mockReturnValue(pending.promise);
    const srcBefore = iframeSrc();

    type('  Make the headline punchier and use the split layout  ');
    act(() => applyButton().click());

    await vi.waitFor(() => expect(edit).toHaveBeenCalledWith('mvp-1', 'Make the headline punchier and use the split layout'));
    // While the model works, the prompt and the pickers wait for it
    await vi.waitFor(() => expect(applyButton().textContent).toContain(en.mvpEdit.applying));
    expect(textarea().disabled).toBe(true);
    expect(layoutButtons().every((button) => button.disabled)).toBe(true);
    expect(apiClient.generateMvp).not.toHaveBeenCalled();

    const saved = {
      ...mvp,
      layout: { variant: 'split' as const, reasons: ['rule:manual'] },
      editedAt: '2026-09-28T07:00:00.000Z',
    };
    await act(async () => {
      pending.resolve({ applied: true, summary: 'Punchier headline, split layout', changes: ['content', 'layout'], mvp: saved });
    });

    const outcome = prompt().querySelector('[data-testid="mvp-edit-outcome"]')!;
    expect(outcome.textContent).toContain('Applied: Punchier headline, split layout');
    expect(outcome.className).toContain('Success');
    expect(textarea().value).toBe('');
    expect(queryClient.getQueryData(['mvp', 'lead-1'])).toEqual(saved);
    // The page was re-published at the same URL, so the preview reloads the new version
    expect(iframeSrc()).not.toBe(srcBefore);
    expect(iframeSrc()).toContain(`v=${Date.parse(saved.editedAt)}`);
    expect(layoutButtons().find((button) => button.getAttribute('aria-pressed') === 'true')!.value).toBe('split');
  });

  it('keeps the text and explains when the model changed nothing', async () => {
    render();
    vi.spyOn(apiClient, 'editMvp').mockResolvedValue({
      applied: false,
      summary: 'The site lists no prices, so none were added.',
      changes: [],
      mvp,
    });

    type('Add prices to every service');
    act(() => applyButton().click());

    await vi.waitFor(() => expect(prompt().querySelector('[data-testid="mvp-edit-outcome"]')).not.toBeNull());
    const outcome = prompt().querySelector('[data-testid="mvp-edit-outcome"]')!;
    expect(outcome.textContent).toContain('Nothing changed: The site lists no prices, so none were added.');
    expect(outcome.className).toContain('Info');
    expect(textarea().value).toBe('Add prices to every service');
    expect(iframeSrc()).toContain(`v=${Date.parse(mvp.generatedAt as string)}`);
  });

  it('shows the error and keeps the text when the change fails, e.g. with no LLM configured', async () => {
    render();
    vi.spyOn(apiClient, 'editMvp').mockRejectedValue(
      new ApiError('The change was not applied: No LLM provider is configured', 502, 'MVP_EDIT_FAILED'),
    );

    type('Use a warmer color');
    act(() => applyButton().click());

    await vi.waitFor(() => expect(prompt().querySelector('[data-testid="mvp-edit-error"]')).not.toBeNull());
    expect(prompt().querySelector('[data-testid="mvp-edit-error"]')!.textContent).toContain(
      'Could not apply the change: The change was not applied: No LLM provider is configured',
    );
    expect(textarea().value).toBe('Use a warmer color');
    expect(textarea().disabled).toBe(false);
    expect(queryClient.getQueryData(['mvp', 'lead-1'])).toEqual(mvp);
  });

  it('sends on Enter and adds a line on Shift+Enter', async () => {
    render();
    const edit = vi.spyOn(apiClient, 'editMvp').mockResolvedValue({ applied: false, summary: 'ok', changes: [], mvp });

    type('Warmer color');
    pressKey('Enter', { shiftKey: true });
    expect(edit).not.toHaveBeenCalled();

    pressKey('Enter');
    await vi.waitFor(() => expect(edit).toHaveBeenCalledWith('mvp-1', 'Warmer color'));
  });

  describe('custom design reset (REV-92)', () => {
    const designed: IMvpProjectDetail = { ...mvp, design: { hidden: ['gallery'], theme: { corners: 'sharp' } } };
    const resetButton = () =>
      Array.from(prompt().querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === en.mvpEdit.resetDesign,
      );

    it('offers a reset only when the MVP has a custom design', () => {
      render();
      expect(resetButton()).toBeUndefined();
      act(() => root.unmount());
      root = createRoot(container);
      render({}, designed);
      expect(resetButton()).toBeDefined();
      expect(resetButton()!.disabled).toBe(false);
    });

    it('drops the design, reloads the re-published preview and says so', async () => {
      render({}, designed);
      const saved = { ...mvp, editedAt: '2026-09-28T19:00:00.000Z' };
      const reset = vi
        .spyOn(apiClient, 'resetMvpDesign')
        .mockResolvedValue({ applied: true, summary: 'The custom design was removed.', changes: ['design'], mvp: saved });

      act(() => resetButton()!.click());

      await vi.waitFor(() => expect(prompt().querySelector('[data-testid="mvp-edit-outcome"]')).not.toBeNull());
      expect(reset).toHaveBeenCalledWith('mvp-1');
      expect(prompt().querySelector('[data-testid="mvp-edit-outcome"]')!.textContent).toContain(en.mvpEdit.designReset);
      expect(queryClient.getQueryData(['mvp', 'lead-1'])).toEqual(saved);
      expect(iframeSrc()).toContain(`v=${Date.parse(saved.editedAt)}`);
      // The saved MVP has no design any more, so the reset is gone
      expect(resetButton()).toBeUndefined();
      expect(apiClient.generateMvp).not.toHaveBeenCalled();
    });

    it('shows a failed reset', async () => {
      render({}, designed);
      vi.spyOn(apiClient, 'resetMvpDesign').mockRejectedValue(new ApiError('The change was not applied: boom', 502, 'MVP_EDIT_FAILED'));
      act(() => resetButton()!.click());
      await vi.waitFor(() => expect(prompt().querySelector('[data-testid="mvp-edit-error"]')).not.toBeNull());
      expect(queryClient.getQueryData(['mvp', 'lead-1'])).toEqual(designed);
    });

    it('is locked with the rest of the prompt once the lead leaves review', () => {
      render({ status: 'SCHEDULED' }, designed);
      expect(resetButton()!.disabled).toBe(true);
    });
  });

  it.each(['GENERATING', 'SCHEDULED', 'SENT'] as const)('is locked while the lead is %s', (status) => {
    render({ status });
    expect(textarea().disabled).toBe(true);
    expect(applyButton().disabled).toBe(true);
    expect(prompt().getAttribute('aria-disabled')).toBe('true');
  });
});
