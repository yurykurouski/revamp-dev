/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IDiscoveryCandidate, IDiscoveryJobStatus } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { apiClient } from '../../api/client.js';
import { useDiscoveryStore } from '../../store/useDiscoveryStore.js';
import { DiscoveryFinishWatcher } from '../DiscoveryFinishWatcher.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const candidate = (externalId: string, status: IDiscoveryCandidate['status']) => ({ externalId, status }) as IDiscoveryCandidate;
const jobStatus = (state: IDiscoveryJobStatus['state'], candidates: IDiscoveryCandidate[] = []) =>
  ({ jobId: 'disc-1', state, result: { candidates } }) as unknown as IDiscoveryJobStatus;

describe('DiscoveryFinishWatcher (REV-41)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    useDiscoveryStore.setState({ isOpen: false, activeJobId: 'disc-1', resultsSeen: false, notifiedJobId: null });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
  });

  /** Mounts the watcher with the job reporting `status` and lets the status query settle */
  async function mount(status: IDiscoveryJobStatus | Error) {
    const spy = vi.spyOn(apiClient, 'getDiscoveryStatus');
    if (status instanceof Error) spy.mockRejectedValue(status);
    else spy.mockResolvedValue(status);

    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client }, React.createElement(DiscoveryFinishWatcher)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(client.getQueryState(['discovery', 'disc-1'])?.status).not.toBe('pending'));
      // react-query hands results to observers on a zero-delay timer
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const page = () => document.body.textContent ?? '';

  const notice = () => document.body.querySelector<HTMLElement>('[data-testid="discovery-finish-notice"]');
  const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);

  it('announces new businesses without opening the modal', async () => {
    await mount(jobStatus('completed', [candidate('a', 'new'), candidate('b', 'new'), candidate('c', 'existing_lead')]));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, notifiedJobId: 'disc-1' });
    expect(page()).toContain(en.discovery.backgroundReady.replace('{{count}}', '2'));
    expect(notice()?.className).toContain('MuiAlert-filledSuccess');
    expect(button(en.discovery.backgroundReview)).toBeDefined();
  });

  it('opens the modal when the operator clicks the notification', async () => {
    await mount(jobStatus('completed', [candidate('a', 'new')]));
    act(() => notice()!.click());
    expect(useDiscoveryStore.getState().isOpen).toBe(true);
  });

  it('opens the modal from the Review button', async () => {
    await mount(jobStatus('completed', [candidate('a', 'new')]));
    act(() => button(en.discovery.backgroundReview)!.click());
    expect(useDiscoveryStore.getState().isOpen).toBe(true);
  });

  it('dismisses the notification without opening the modal', async () => {
    await mount(jobStatus('completed', [candidate('a', 'new')]));
    const close = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${en.discovery.backgroundDismiss}"]`);
    act(() => close!.click());
    expect(useDiscoveryStore.getState().isOpen).toBe(false);
  });

  it('announces a job only once', async () => {
    await mount(jobStatus('completed', [candidate('a', 'new')]));
    act(() => notice()!.click());
    act(() => useDiscoveryStore.getState().close());
    await act(async () => {
      await client.refetchQueries({ queryKey: ['discovery', 'disc-1'] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useDiscoveryStore.getState().isOpen).toBe(false);
    expect(useDiscoveryStore.getState().notifiedJobId).toBe('disc-1');
  });

  it('shows a notice when nothing new was found', async () => {
    await mount(jobStatus('completed', [candidate('a', 'existing_lead')]));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, notifiedJobId: 'disc-1' });
    expect(page()).toContain(en.discovery.backgroundNothingNew);
    act(() => button(en.discovery.backgroundDetails)!.click());
    expect(useDiscoveryStore.getState().isOpen).toBe(true);
  });

  it('shows a failure notice when the job fails', async () => {
    await mount(jobStatus('failed'));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, notifiedJobId: 'disc-1' });
    expect(page()).toContain(en.discovery.backgroundFailed);
    expect(notice()?.className).toContain('MuiAlert-filledError');
  });

  it('shows a failure notice when the status request fails', async () => {
    await mount(new Error('network down'));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, notifiedJobId: 'disc-1' });
    expect(page()).toContain(en.discovery.backgroundFailed);
  });

  it('stays quiet when the modal is already open', async () => {
    useDiscoveryStore.setState({ isOpen: true });
    await mount(jobStatus('completed', [candidate('a', 'new')]));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: true, notifiedJobId: null });
    expect(notice()).toBeNull();
  });

  it('stays quiet while the job is still running', async () => {
    await mount(jobStatus('active'));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, notifiedJobId: null });
    expect(notice()).toBeNull();
  });
});
