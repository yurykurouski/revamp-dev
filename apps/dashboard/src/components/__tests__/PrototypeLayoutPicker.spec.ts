/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MvpLayoutVariant } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { ApiError, apiClient, IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { PrototypeStep } from '../leadReview/PrototypeStep.js';
import { savedMvpLayout } from '../../hooks/useLiveMvpLayout.js';
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

const mvpWith = (variant: MvpLayoutVariant | undefined, reasons = ['rule:default']): IMvpProjectDetail => ({
  id: 'mvp-1',
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  ...(variant ? { layout: { variant, reasons } } : {}),
});

/** Resolves on demand, to hold a save in flight */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The Prototype step fed from the MVP query, as LeadReview does */
const Harness: React.FC<{ lead: ILeadItem }> = ({ lead: current }) => {
  const { data: mvp } = useMvpQuery(current.id);
  return React.createElement(PrototypeStep, { lead: current, audit, mvp });
};

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe('Prototype step layout picker (REV-84)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let posted: unknown[];

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    posted = [];
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
    // Everything the dashboard sends to the sandboxed preview
    const frame = container.querySelector('iframe');
    if (!frame?.contentWindow) return;
    vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message);
    });
  };

  const button = (variant: MvpLayoutVariant) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="mvp-layout-picker"] button')).find(
      (el) => el.value === variant,
    )!;
  const pressed = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="mvp-layout-picker"] button'))
      .filter((el) => el.getAttribute('aria-pressed') === 'true')
      .map((el) => el.value);
  const click = (variant: MvpLayoutVariant) => act(() => button(variant).click());
  const setLayoutMessages = () =>
    posted.filter((message) => (message as { type?: string }).type === 'REVAMP_SET_LAYOUT');

  it('offers the original site first, then the four template layouts, with the saved one selected', () => {
    render(mvpWith('editorial'));
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="mvp-layout-picker"] button')).map((el) => el.value),
    ).toEqual(['original', 'bento', 'split', 'editorial', 'compact']);
    expect(button('original').getAttribute('title')).toBe(en.mvpLayout.descriptions.original);
    for (const variant of ['original', 'bento', 'split', 'editorial', 'compact'] as const) {
      expect(button(variant).textContent).toBe(en.mvpLayout.variants[variant]);
      expect(button(variant).disabled).toBe(false);
    }
    expect(pressed()).toEqual(['editorial']);
  });

  it('switches the preview live with the animation and saves the layout, without a generation', async () => {
    render(mvpWith('bento'));
    const saved = mvpWith('split', ['rule:manual']);
    const save = vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(saved);

    click('split');

    expect(setLayoutMessages()).toContainEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: true });
    expect(pressed()).toEqual(['split']);

    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('mvp-1', 'split'));
    expect(apiClient.generateMvp).not.toHaveBeenCalled();
    // The iframe is never reloaded for a layout change
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('about:blank#mvp');
    expect(pressed()).toEqual(['split']);
    // The saved MVP replaces the cached one, so the layout chip and the change summary follow it
    expect(queryClient.getQueryData(['mvp', 'lead-1'])).toEqual(saved);
  });

  it('shows the operator pick on the layout chip once saved', async () => {
    render(mvpWith('bento'));
    const saved = mvpWith('compact', ['rule:manual']);
    vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(saved);
    click('compact');

    const chips = () => Array.from(container.querySelectorAll('.MuiChip-label')).map((chip) => chip.textContent);
    await vi.waitFor(() => expect(chips()).toContain(en.mvpLayout.variants.compact));
    expect(chips()).not.toContain(en.mvpLayout.variants.bento);
    expect(pressed()).toEqual(['compact']);
  });

  it('puts the saved layout back in the preview and reports a failed save', async () => {
    render(mvpWith('bento'));
    vi.spyOn(apiClient, 'updateMvpLayout').mockRejectedValue(
      new ApiError('The MVP layout cannot be changed while the lead is SCHEDULED', 409, 'MVP_LAYOUT_CHANGE_NOT_ALLOWED'),
    );

    click('editorial');
    await vi.waitFor(() => expect(pressed()).toEqual(['bento']));

    expect(setLayoutMessages()).toContainEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'editorial', animate: true });
    expect(setLayoutMessages().at(-1)).toEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'bento', animate: true });
    expect(pressed()).toEqual(['bento']);
    expect(document.body.textContent).toContain(
      en.mvpLayout.saveFailed.replace('{{message}}', 'The MVP layout cannot be changed while the lead is SCHEDULED'),
    );
  });

  it('keeps the latest pick selected while an earlier save is still in flight', async () => {
    render(mvpWith('bento'));
    const first = deferred<IMvpProjectDetail>();
    const save = vi
      .spyOn(apiClient, 'updateMvpLayout')
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(mvpWith('compact', ['rule:manual']));

    click('split');
    click('compact');
    expect(pressed()).toEqual(['compact']);

    first.resolve(mvpWith('split', ['rule:manual']));
    await flush();
    expect(pressed()).toEqual(['compact']);

    // Saved one after the other, in the order picked
    await vi.waitFor(() => expect(save.mock.calls.map((call) => call[1])).toEqual(['split', 'compact']));
    await vi.waitFor(() =>
      expect(queryClient.getQueryData<IMvpProjectDetail>(['mvp', 'lead-1'])?.layout?.variant).toBe('compact'),
    );
    await flush();
    expect(pressed()).toEqual(['compact']);
    // The preview never went back to an older layout on the way
    expect(setLayoutMessages().map((message) => (message as { layout: string }).layout)).not.toContain('bento');
    expect(queryClient.getQueryData<IMvpProjectDetail>(['mvp', 'lead-1'])?.layout?.variant).toBe('compact');
  });

  it('drops a pick still unsaved when the MVP is regenerated', async () => {
    render({ ...mvpWith('bento'), generatedAt: '2026-09-27T10:00:00.000Z' });
    const save = deferred<IMvpProjectDetail>();
    vi.spyOn(apiClient, 'updateMvpLayout').mockImplementation(() => save.promise);
    click('split');
    expect(pressed()).toEqual(['split']);

    // A new version arrives with its own automatic layout
    act(() => {
      queryClient.setQueryData(['mvp', 'lead-1'], { ...mvpWith('editorial'), generatedAt: '2026-09-27T11:00:00.000Z' });
    });
    await vi.waitFor(() => expect(pressed()).toEqual(['editorial']));
  });

  it('brings a freshly loaded preview to the shown layout without the animation', () => {
    render(mvpWith('split', ['rule:manual']));
    act(() => container.querySelector('iframe')!.dispatchEvent(new Event('load')));
    expect(setLayoutMessages().at(-1)).toEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: false });
  });

  it('ignores a click on the layout already shown', () => {
    render(mvpWith('bento'));
    const save = vi.spyOn(apiClient, 'updateMvpLayout');
    click('bento');
    expect(save).not.toHaveBeenCalled();
    expect(pressed()).toEqual(['bento']);
  });

  it.each(['SCHEDULED', 'SENT', 'GENERATING'] as const)('locks the picker while the lead is %s', (status) => {
    render(mvpWith('bento'), { status });
    const save = vi.spyOn(apiClient, 'updateMvpLayout');
    expect(button('split').disabled).toBe(true);
    click('split');
    expect(save).not.toHaveBeenCalled();
  });

  it('has no picker before an MVP exists', () => {
    render(null, { previewUrl: undefined });
    expect(container.querySelector('[data-testid="mvp-layout-picker"]')).toBeNull();
  });

  it('treats an MVP saved without a layout as Bento', () => {
    render(mvpWith(undefined));
    expect(pressed()).toEqual(['bento']);
    expect(savedMvpLayout(mvpWith(undefined))).toBe('bento');
    expect(savedMvpLayout({ ...mvpWith(undefined), layout: { variant: 'masonry' as never, reasons: [] } })).toBe('bento');
    expect(savedMvpLayout(null)).toBeUndefined();
  });

  describe('floating over the preview (REV-88)', () => {
    const toolsPanel = () => container.querySelector<HTMLElement>('[data-testid="mvp-tools-panel"]')!;

    it('holds both pickers in a panel over the preview, outside the sandboxed iframe', () => {
      render(mvpWith('bento'));
      const viewport = container.querySelector('[data-testid="prototype-viewport"]')!;
      const frame = container.querySelector('iframe')!;
      expect(toolsPanel().parentElement).toBe(viewport);
      expect(viewport.contains(frame)).toBe(true);
      expect(toolsPanel().contains(frame)).toBe(false);
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
      expect(toolsPanel().querySelector('[data-testid="mvp-layout-picker"]')).not.toBeNull();
      expect(toolsPanel().querySelector('#brand-color-picker-input')).not.toBeNull();
      // No other copy of the pickers above the preview
      expect(container.querySelectorAll('[data-testid="mvp-layout-picker"]')).toHaveLength(1);
      expect(container.querySelectorAll('#brand-color-picker-input')).toHaveLength(1);
    });

    it('still applies a color live and saves it on the MVP', async () => {
      render(mvpWith('bento'));
      const save = vi.spyOn(apiClient, 'updateMvpTokens').mockResolvedValue(undefined as never);
      const input = toolsPanel().querySelector<HTMLInputElement>('#brand-color-picker-input')!;
      act(() => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setValue.call(input, '#e11d48');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(posted).toContainEqual({ type: 'REVAMP_UPDATE_THEME', palette: { primary: '#e11d48', accent: '#e11d48' } });
      await vi.waitFor(() =>
        expect(save).toHaveBeenCalledWith('mvp-1', { primaryColor: '#e11d48', accentColor: '#e11d48' }),
      );
    });

    it('keeps the layout picker working after the panel is collapsed and expanded', async () => {
      render(mvpWith('bento'));
      const toggle = (label: string) =>
        act(() => toolsPanel().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
      toggle(en.mvpTools.collapse);
      expect(container.querySelector('[data-testid="mvp-layout-picker"]')).toBeNull();
      toggle(en.mvpTools.expand);

      const save = vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('split', ['rule:manual']));
      click('split');
      expect(setLayoutMessages()).toContainEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: true });
      await vi.waitFor(() => expect(save).toHaveBeenCalledWith('mvp-1', 'split'));
    });

    it('shows the color picker locked before an MVP exists, without the layout picker', () => {
      render(null, { previewUrl: undefined });
      expect(toolsPanel().querySelector<HTMLInputElement>('#brand-color-picker-input')!.disabled).toBe(true);
      expect(toolsPanel().querySelector('[data-testid="mvp-layout-picker"]')).toBeNull();
    });
  });

  it('opens the full-window preview with the Design tools in a new tab (REV-91)', () => {
    render(mvpWith('bento'));
    const open = container.querySelector<HTMLAnchorElement>(`a[aria-label="${en.inspector.openPrototype}"]`)!;
    expect(open.getAttribute('href')).toBe('/leads/lead-1/preview');
    expect(open.getAttribute('target')).toBe('_blank');
  });

  describe('"What changed" summary under the preview (REV-94)', () => {
    const summary = () => container.querySelector<HTMLElement>('section[aria-labelledby="mvp-changes-title"]');
    const follows = (first: Element, second: Element) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    it.each(['bpMobile', 'bpTablet', 'bpDesktop'] as const)('renders after the preview viewport at %s', (label) => {
      render(mvpWith('bento'));
      const breakpoint = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (el) => el.textContent === en.inspector[label],
      )!;
      act(() => breakpoint.click());
      expect(breakpoint.getAttribute('aria-pressed')).toBe('true');

      const viewport = container.querySelector('[data-testid="prototype-viewport"]')!;
      const toolbar = container.querySelector('button[aria-pressed]')!;
      expect(summary()).not.toBeNull();
      expect(follows(toolbar, viewport)).toBe(true);
      expect(follows(viewport, summary()!)).toBe(true);
      expect(viewport.contains(summary()!)).toBe(false);
      // Last block of the card, below the preview
      expect(summary()!.parentElement!.lastElementChild).toBe(summary());
      expect(summary()!.textContent).toContain(en.mvpChanges.title);
    });

    it('is absent before an MVP exists', () => {
      render(null, { previewUrl: undefined });
      expect(summary()).toBeNull();
      expect(container.querySelector('[data-testid="prototype-viewport"]')).not.toBeNull();
    });
  });

  describe('palette saved on the MVP (REV-90)', () => {
    const palette = (primary: string) => ({ primary, secondary: '#b8c4fe', accent: primary });
    const colorInput = () => container.querySelector<HTMLInputElement>('#brand-color-picker-input')!;
    const pick = (hex: string) =>
      act(() => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setValue.call(colorInput(), hex);
        colorInput().dispatchEvent(new Event('input', { bubbles: true }));
      });

    it('starts from the palette saved on the MVP', () => {
      render({ ...mvpWith('bento'), colorPalette: { primary: '#059669', secondary: '#b8c4fe', accent: '#059669' } });
      expect(colorInput().value).toBe('#059669');
      // Reset still offers the audit's brand color
      expect(document.body.textContent).toContain(en.colorPicker.reset);
    });

    it("falls back to the audit's brand color", () => {
      render(mvpWith('bento'));
      expect(colorInput().value).toBe('#123456');
    });

    it('keeps the latest pick when an earlier save answers late', async () => {
      render({ ...mvpWith('bento'), colorPalette: palette('#111111') });
      const first = deferred<IMvpProjectDetail>();
      vi.spyOn(apiClient, 'updateMvpTokens')
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({ ...mvpWith('bento'), colorPalette: palette('#333333') });

      pick('#222222');
      pick('#333333');
      await flush();
      first.resolve({ ...mvpWith('bento'), colorPalette: palette('#222222') });
      await flush();
      expect(colorInput().value).toBe('#333333');
    });

    it('takes the palette of a regenerated MVP', async () => {
      render({ ...mvpWith('bento'), generatedAt: '2026-09-27T10:00:00.000Z', colorPalette: palette('#111111') });
      vi.spyOn(apiClient, 'updateMvpTokens').mockImplementation(() => new Promise(() => undefined));
      pick('#222222');
      act(() => {
        queryClient.setQueryData(['mvp', 'lead-1'], {
          ...mvpWith('bento'),
          generatedAt: '2026-09-27T11:00:00.000Z',
          colorPalette: palette('#444444'),
        });
      });
      await vi.waitFor(() => expect(colorInput().value).toBe('#444444'));
    });

    it.each(['SCHEDULED', 'SENT', 'GENERATING'] as const)('locks the color picker while the lead is %s', (status) => {
      render(mvpWith('bento'), { status });
      const save = vi.spyOn(apiClient, 'updateMvpTokens');
      expect(colorInput().disabled).toBe(true);
      expect(container.querySelector('[data-testid="color-picker-toolbar"]')!.getAttribute('aria-disabled')).toBe('true');
      const swatch = container.querySelector<HTMLElement>('[data-testid="color-picker-toolbar"] [aria-label="Rose"]');
      act(() => swatch?.click());
      expect(save).not.toHaveBeenCalled();
      expect(posted.filter((m) => (m as { type?: string }).type === 'REVAMP_UPDATE_THEME')).toEqual([]);
    });
  });

  describe('switching between the rebuilt original and the templates (REV-110)', () => {
    const rerendering = () => document.body.textContent?.includes(en.mvpLayout.rerendering) ?? false;
    /** Moves the faked clock and lets the refetches it starts settle inside act */
    const tick = (ms: number) =>
      act(async () => {
        vi.advanceTimersByTime(ms);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

    beforeEach(() => {
      // Only the polling interval and the clock are faked; React Query keeps its real timeouts
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits for the re-rendered page instead of switching the old one in place, then reloads it', async () => {
      render(mvpWith('bento'));
      const save = deferred<IMvpProjectDetail>();
      vi.spyOn(apiClient, 'updateMvpLayout').mockReturnValue(save.promise);

      click('original');
      expect(pressed()).toEqual(['original']);
      // The Bento page cannot show the rebuild, so nothing is posted to it for this pick
      expect(setLayoutMessages()).not.toContainEqual(expect.objectContaining({ layout: 'original' }));
      expect(rerendering()).toBe(false);

      save.resolve(mvpWith('original', ['rule:manual']));
      await vi.waitFor(() => expect(rerendering()).toBe(true));
      const src = container.querySelector('iframe')!.getAttribute('src');

      // The MVP is polled until the worker has re-published it
      const getMvp = vi.mocked(apiClient.getMvp);
      getMvp.mockClear();
      await tick(2000);
      await vi.waitFor(() => expect(getMvp).toHaveBeenCalled());
      expect(rerendering()).toBe(true);

      const republished = { ...mvpWith('original', ['rule:rebuild']), editedAt: '2026-09-30T12:00:00.000Z' };
      getMvp.mockResolvedValue(republished);
      await tick(2000);
      await vi.waitFor(() => expect(rerendering()).toBe(false));
      // The new page is loaded rather than switched in place
      expect(container.querySelector('iframe')!.getAttribute('src')).not.toBe(src);
      expect(pressed()).toEqual(['original']);

      // Polling stops once the page is back
      getMvp.mockClear();
      await tick(6000);
      expect(getMvp).not.toHaveBeenCalled();
    });

    it('stops waiting after a while if the page never comes back', async () => {
      render(mvpWith('split'));
      vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('original', ['rule:manual']));
      click('original');
      await vi.waitFor(() => expect(rerendering()).toBe(true));

      await tick(92_000);
      await vi.waitFor(() => expect(rerendering()).toBe(false), { timeout: 5000 });
    });

    it('also waits when going back from the rebuild to a template', async () => {
      const rebuild = { coverage: 0.97, sections: 9, omitted: [], tuning: [] };
      render({ ...mvpWith('original', ['rule:rebuild']), rebuild });
      // The save's answer still carries the rebuild summary: the page is re-rendered after it
      vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue({ ...mvpWith('compact', ['rule:manual']), rebuild });
      click('compact');
      expect(setLayoutMessages()).not.toContainEqual(expect.objectContaining({ layout: 'compact', animate: true }));
      await vi.waitFor(() => expect(rerendering()).toBe(true));

      const republished = { ...mvpWith('compact', ['rule:manual']), editedAt: '2026-09-30T12:00:00.000Z' };
      vi.mocked(apiClient.getMvp).mockResolvedValue(republished);
      await tick(2000);
      await vi.waitFor(() => expect(rerendering()).toBe(false));
    });

    it('stops waiting when the rebuild falls back to a template, which leaves the renderer as it was', async () => {
      render(mvpWith('bento'));
      vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('original', ['rule:manual']));
      click('original');
      await vi.waitFor(() => expect(rerendering()).toBe(true));

      // The worker records the fallback on the layout; the page stays a template, so no new editedAt
      vi.mocked(apiClient.getMvp).mockResolvedValue(mvpWith('split', ['rebuild:invalid', 'manual:original', 'rule:derived']));
      await tick(2000);
      await vi.waitFor(() => expect(rerendering()).toBe(false));
      expect(container.querySelector('.MuiChip-colorWarning')?.textContent).toBe(en.mvpLayout.variants.split);
      expect(pressed()).toEqual(['split']);
      // The template page switches to the fallback layout in place
      expect(setLayoutMessages().at(-1)).toEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: true });
    });

    it('stops waiting when a quick pick back to a template makes the re-render unnecessary', async () => {
      render(mvpWith('bento'));
      const save = vi
        .spyOn(apiClient, 'updateMvpLayout')
        .mockResolvedValueOnce(mvpWith('original', ['rule:manual']))
        .mockResolvedValueOnce(mvpWith('split', ['rule:manual']));
      click('original');
      await vi.waitFor(() => expect(rerendering()).toBe(true));

      click('split');
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(rerendering()).toBe(false));
      expect(pressed()).toEqual(['split']);
      // The Bento page never left, so it switches in place
      expect(setLayoutMessages().at(-1)).toEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: true });
    });

    it('never waits for a switch between two templates, which the page makes in place', async () => {
      render(mvpWith('bento'));
      const save = vi.spyOn(apiClient, 'updateMvpLayout').mockResolvedValue(mvpWith('split', ['rule:manual']));
      click('split');
      expect(setLayoutMessages()).toContainEqual({ type: 'REVAMP_SET_LAYOUT', layout: 'split', animate: true });
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
      await flush();
      expect(rerendering()).toBe(false);
    });

    it('says why the original site cannot be rebuilt when the switch is refused', async () => {
      render(mvpWith('bento'));
      vi.spyOn(apiClient, 'updateMvpLayout').mockRejectedValue(
        new ApiError('The original site cannot be rebuilt: rebuild:low_coverage', 409, 'MVP_REBUILD_UNAVAILABLE', {
          reason: 'rebuild:low_coverage',
          facts: ['coverage:0.72'],
        }),
      );
      click('original');
      await vi.waitFor(() => expect(pressed()).toEqual(['bento']));
      expect(document.body.textContent).toContain(
        en.mvpLayout.saveFailed.replace('{{message}}', en.mvpLayout.rebuildRefused.low_coverage.replace('{{percent}}', '72')),
      );
      expect(rerendering()).toBe(false);
    });

    it("shows the server's message for a refusal without a known reason", async () => {
      render(mvpWith('bento'));
      vi.spyOn(apiClient, 'updateMvpLayout').mockRejectedValue(
        new ApiError('The original site cannot be rebuilt: rebuild:other', 409, 'MVP_REBUILD_UNAVAILABLE', { reason: 'rebuild:other' }),
      );
      click('original');
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain(
          en.mvpLayout.saveFailed.replace('{{message}}', 'The original site cannot be rebuilt: rebuild:other'),
        ),
      );
    });
  });
});
