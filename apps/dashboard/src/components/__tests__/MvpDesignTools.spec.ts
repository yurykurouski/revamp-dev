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
import { ApiError, apiClient, IAuditDetail, ILeadItem, IMvpPageResult, IMvpProjectDetail } from '../../api/client.js';
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
  mvpGeneratedAt: '2026-10-10T10:00:00.000Z',
  createdAt: '2026-10-10T09:00:00.000Z',
};

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: [],
  colorPalette: { primary: '#0a5c8a', secondary: '#ffffff', accent: '#f2a900' },
  measurementErrors: [],
  designCritiqueFallback: false,
};

const theme = {
  primary: '#0a5c8a',
  accent: '#f2a900',
  bg: '#ffffff',
  surface: '#ffffff',
  text: '#111111',
  fontHeading: '"DM Serif Display", serif',
  fontBody: 'Inter, sans-serif',
};

const mvp: IMvpProjectDetail = {
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  generatedAt: '2026-10-10T10:00:00.000Z',
  theme,
  versions: [
    { n: 1, kind: 'generate', storagePath: 'v/s/versions/1.html', createdAt: '2026-10-10T10:00:00.000Z' },
    { n: 2, kind: 'change', instruction: 'Shorter heading', storagePath: 'v/s/versions/2.html', createdAt: '2026-10-10T11:00:00.000Z' },
  ],
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

describe('Design tools for a model-designed page (REV-140)', () => {
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
    for (const id of ['lead-1', 'lead-2']) queryClient.setQueryData(['mvp', id], { ...current, leadId: id });
    vi.spyOn(apiClient, 'getMvp').mockImplementation(async (id) => queryClient.getQueryData(['mvp', id]) ?? null);
    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, { theme: getTheme('light') }, React.createElement(Harness, { lead: { ...lead, ...leadOverrides } })),
        ),
      );
    });
  };

  const panel = () => container.querySelector<HTMLElement>('[data-testid="mvp-tools-panel"]')!;
  const prompt = () => container.querySelector<HTMLElement>('[data-testid="mvp-edit-prompt"]')!;
  const textarea = () => prompt().querySelector<HTMLTextAreaElement>('textarea#mvp-edit-instruction')!;
  const applyButton = () => prompt().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const outcome = () => container.querySelector<HTMLElement>('[data-testid="mvp-page-outcome"]');
  const error = () => container.querySelector<HTMLElement>('[data-testid="mvp-page-error"]');
  const iframeSrc = () => container.querySelector('iframe')!.getAttribute('src');
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value);
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const fontSelect = () => container.querySelector<HTMLSelectElement>('[data-testid="mvp-font-control"] select')!;
  /** Every control of the four tools; the panel's own handle and MUI's hidden autosize textarea are not tools */
  const controls = () =>
    ['mvp-edit-prompt', 'mvp-color-controls', 'mvp-font-control', 'mvp-version-list'].flatMap((testId) =>
      Array.from(
        panel().querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          `[data-testid="${testId}"] :is(button, input, textarea, select):not([aria-hidden="true"])`,
        ),
      ),
    );

  it('holds the change, colors, fonts, versions and Regenerate', () => {
    render();
    const tools = panel();
    expect(tools.contains(prompt())).toBe(true);
    expect(tools.querySelector('[data-testid="mvp-color-controls"]')).not.toBeNull();
    expect(tools.querySelector('[data-testid="mvp-font-control"]')).not.toBeNull();
    expect(tools.querySelectorAll('[data-testid="mvp-version"]')).toHaveLength(2);
    expect(tools.textContent).toContain(en.mvpPage.versions.title);
    expect(tools.querySelector('[data-testid="mvp-layout-picker"]')).toBeNull();
    expect(tools.textContent).not.toContain('Reset custom design');
  });

  it('applies a change and reloads the preview', async () => {
    render();
    const pending = deferred<IMvpPageResult>();
    const edit = vi.spyOn(apiClient, 'editMvp').mockReturnValue(pending.promise);
    const srcBefore = iframeSrc();

    type('  Make the headline shorter  ');
    act(() => applyButton().click());
    await vi.waitFor(() => expect(edit).toHaveBeenCalledWith('mvp-1', 'Make the headline shorter'));
    await vi.waitFor(() => expect(applyButton().textContent).toContain(en.mvpEdit.applying));

    const saved = { ...mvp, editedAt: '2026-10-10T12:00:00.000Z' };
    await act(async () => pending.resolve({ applied: true, version: 3, mvp: saved }));

    expect(outcome()!.textContent).toContain('Published as version 3.');
    expect(textarea().value).toBe('');
    expect(iframeSrc()).not.toBe(srcBefore);
    expect(iframeSrc()).toContain(`v=${Date.parse(saved.editedAt)}`);
  });

  it('says why a change was refused, and keeps the instruction', async () => {
    render();
    vi.spyOn(apiClient, 'editMvp').mockResolvedValue({ applied: false, reason: 'invalid_page', message: 'page:h1', mvp });
    type('Make the headline shorter');
    await act(async () => applyButton().click());
    await vi.waitFor(() => expect(outcome()!.textContent).toContain('did not pass the checks'));
    expect(outcome()!.textContent).toContain('page:h1');
    expect(textarea().value).toBe('Make the headline shorter');
  });

  it('publishes colors and fonts', async () => {
    render();
    const tokens = vi.spyOn(apiClient, 'updateMvpTokens').mockResolvedValue({ applied: true, mvp });
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mvp-color-role-accent"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mvp-brand-color-0"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mvp-colors-apply"]')!.click());
    expect(tokens).toHaveBeenCalledWith('mvp-1', { colors: { ...{ primary: theme.primary, bg: theme.bg, surface: theme.surface, text: theme.text }, accent: '#0a5c8a' } });
    await vi.waitFor(() => expect(outcome()!.textContent).toContain('Colors and fonts published.'));

    await act(async () => {
      fontSelect().value = 'editorial';
      fontSelect().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(tokens).toHaveBeenLastCalledWith('mvp-1', { fonts: { heading: 'Lora', body: 'Lato' } });
  });

  it('restores a version', async () => {
    render();
    const restore = vi.spyOn(apiClient, 'restoreMvpVersion').mockResolvedValue({ applied: true, version: 3, mvp });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mvp-version-restore-1"]')!.click());
    expect(restore).toHaveBeenCalledWith('mvp-1', 1);
    await vi.waitFor(() => expect(outcome()!.textContent).toContain('Restored and published as version 3.'));
  });

  it('disables every control while an action runs', async () => {
    render();
    vi.spyOn(apiClient, 'restoreMvpVersion').mockReturnValue(deferred<IMvpPageResult>().promise);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mvp-version-restore-1"]')!.click());
    await vi.waitFor(() => expect(textarea().disabled).toBe(true));
    expect(controls().length).toBeGreaterThan(10);
    const enabled = controls().filter((el) => !el.disabled);
    expect(enabled.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });

  it('locks the tools outside NEEDS_APPROVAL', () => {
    render({ status: 'SCHEDULED' });
    expect(textarea().disabled).toBe(true);
    expect(fontSelect().disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="mvp-version-restore-1"]')!.disabled).toBe(true);
  });

  it('keeps an answer with the lead it was asked for', async () => {
    render();
    const pending = deferred<IMvpPageResult>();
    vi.spyOn(apiClient, 'restoreMvpVersion').mockReturnValue(pending.promise);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mvp-version-restore-1"]')!.click());

    render({ id: 'lead-2', businessName: 'Other' });
    await act(async () => pending.resolve({ applied: true, version: 3, mvp }));
    expect(outcome()).toBeNull();
    expect(textarea().disabled).toBe(false);
  });

  it("shows the API's message on a 504", async () => {
    render();
    vi.spyOn(apiClient, 'editMvp').mockRejectedValue(new ApiError('The change is taking longer than expected and may still be published.', 504, 'MVP_EDIT_TIMEOUT'));
    type('Make the headline shorter');
    await act(async () => applyButton().click());
    await vi.waitFor(() => expect(error()!.textContent).toContain('may still be published'));
    // The API says it may still publish; the panel must not wrap it in "could not apply"
    expect(error()!.textContent).not.toContain('Could not apply');
  });

  it('lists the facts to check under the preview, and Show in preview posts the fact to the frame', () => {
    render({}, { ...mvp, grounding: [{ kind: 'number', text: '15', context: 'Ponad 15 lat doświadczenia' }] });
    const flags = container.querySelector<HTMLElement>('[data-testid="mvp-grounding-flags"]')!;
    expect(flags.textContent).toContain('Check these facts (1)');
    const frame = container.querySelector('iframe')!;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => flags.querySelector('button')!.click());
    expect(post).toHaveBeenCalledWith({ type: 'REVAMP_SHOW_TEXT', text: '15' }, '*');
  });

  it('offers only Regenerate on an MVP from the previous generator', () => {
    // As the previous generator stored it: fields the types no longer declare, and no theme
    const previous = {
      id: 'mvp-1',
      leadId: 'lead-1',
      fullPreviewUrl: 'about:blank#mvp',
      generatedAt: '2026-09-27T10:00:00.000Z',
      colorPalette: { primary: '#4F46E5', secondary: '#B8C4FE', accent: '#4F46E5' },
      layout: { variant: 'bento', reasons: ['rule:default'] },
    } as IMvpProjectDetail;
    render({}, previous);
    expect(panel().textContent).toContain(en.mvpPage.previousGenerator);
    expect(panel().querySelector('[data-testid="mvp-regenerate"]')).not.toBeNull();
    for (const testId of ['mvp-edit-prompt', 'mvp-color-controls', 'mvp-font-control', 'mvp-version-list']) {
      expect(panel().querySelector(`[data-testid="${testId}"]`), testId).toBeNull();
    }
  });
});
