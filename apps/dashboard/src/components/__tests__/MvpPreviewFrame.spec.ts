/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { MvpPreviewFrame } from '../MvpPreviewFrame.js';
import { REGENERATION_LOAD_TIMEOUT_MS } from '../../hooks/useRegenerationOverlay.js';
import { GENERATE_MVP_MUTATION_KEY, GenerateMvpVariables, useIsMvpGenerationPending } from '../../hooks/useLeads.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const V1 = 'about:blank#v1';
const V2 = 'about:blank#v2';

describe('MvpPreviewFrame regeneration overlay (REV-53)', () => {
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
    vi.useRealTimers();
  });

  const render = (previewUrl: string, busy: boolean) =>
    act(() => {
      root.render(React.createElement(MvpPreviewFrame, { previewUrl, busy }));
    });
  const overlay = () => container.querySelector('[data-testid="mvp-regeneration-overlay"]');
  const iframe = () => container.querySelector('iframe') as HTMLIFrameElement;
  const loadIframe = () => act(() => iframe().dispatchEvent(new Event('load')));

  it('shows no overlay when nothing is regenerating', () => {
    render(V1, false);
    expect(overlay()).toBeNull();
    expect(iframe().getAttribute('src')).toBe(V1);
  });

  it('covers the preview while regenerating, then until the new version has loaded', () => {
    render(V1, false);
    render(V1, true);
    expect(overlay()).not.toBeNull();
    expect(overlay()?.getAttribute('role')).toBe('status');
    expect(overlay()?.textContent).toContain(en.inspector.regeneratingTitle);

    // New version deployed: the iframe reloads with the new URL under the overlay
    render(V2, false);
    expect(iframe().getAttribute('src')).toBe(V2);
    expect(overlay()).not.toBeNull();

    loadIframe();
    expect(overlay()).toBeNull();
  });

  it('hides right away when the new version loaded before the run was reported finished', () => {
    render(V1, true);
    render(V2, true);
    loadIframe();
    expect(overlay()).not.toBeNull();

    render(V2, false);
    expect(overlay()).toBeNull();
  });

  it('hides when the run ends without a new version (failed regeneration)', () => {
    render(V1, true);
    expect(overlay()).not.toBeNull();

    render(V1, false);
    expect(overlay()).toBeNull();
  });

  it('gives up waiting when the new version never loads', () => {
    vi.useFakeTimers();
    render(V1, true);
    render(V2, false);
    expect(overlay()).not.toBeNull();

    act(() => vi.advanceTimersByTime(REGENERATION_LOAD_TIMEOUT_MS - 1));
    expect(overlay()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(overlay()).toBeNull();
  });

  it('keeps the iframe sandbox unchanged while the overlay is shown', () => {
    render(V1, true);
    expect(overlay()).not.toBeNull();
    expect(iframe().getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(overlay()?.contains(iframe())).toBe(false);
  });
});

describe('useIsMvpGenerationPending (REV-53)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let resolveRequest: () => void;
  const seen: Record<string, boolean> = {};
  let mutate: (vars: GenerateMvpVariables) => void;

  const Probe: React.FC = () => {
    seen.l1 = useIsMvpGenerationPending('l1');
    seen.l2 = useIsMvpGenerationPending('l2');
    seen.none = useIsMvpGenerationPending(null);
    const mutation = useMutation({
      mutationKey: GENERATE_MVP_MUTATION_KEY,
      mutationFn: (_vars: GenerateMvpVariables) => new Promise<void>((resolve) => (resolveRequest = resolve)),
    });
    mutate = mutation.mutate;
    return null;
  };

  beforeEach(async () => {
    client = new QueryClient();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
  });

  // react-query batches cache notifications on a macrotask
  const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  it('is true only for the lead whose request is in flight', async () => {
    expect(seen).toEqual({ l1: false, l2: false, none: false });

    await act(async () => mutate({ auditId: 'a1', leadId: 'l1', forceRegenerate: true }));
    await settle();
    expect(seen).toEqual({ l1: true, l2: false, none: false });

    await act(async () => resolveRequest());
    await settle();
    expect(seen).toEqual({ l1: false, l2: false, none: false });
  });
});
