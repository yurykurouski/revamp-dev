/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router-dom';
import { IDiscoveryCandidate, IDiscoveryJobStatus } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { apiClient } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useDiscoveryStore } from '../../store/useDiscoveryStore.js';
import { DiscoveryDrawer } from '../DiscoveryDrawer.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const params = { provider: 'osm' as const, niche: 'dental' as const, location: 'Vilnius', keyword: 'orthodontist', limit: 10 };

const candidate = (externalId: string, status: IDiscoveryCandidate['status']): IDiscoveryCandidate => ({
  provider: 'osm',
  externalId,
  name: `Business ${externalId}`,
  status,
  website: `https://${externalId}.example`,
  domain: `${externalId}.example`,
  city: 'Vilnius',
});

const jobStatus = (
  state: IDiscoveryJobStatus['state'],
  result: IDiscoveryJobStatus['result'] = null,
  error: string | null = null,
): IDiscoveryJobStatus => ({
  jobId: 'disc-1',
  state,
  params,
  result,
  error,
  attemptsMade: 1,
  createdAt: '2026-09-27T10:00:00.000Z',
  finishedAt: null,
});

const completed = (candidates: IDiscoveryCandidate[]) =>
  jobStatus('completed', { candidates, counts: { new: 0, existing_lead: 0, duplicate: 0, no_website: 0, invalid: 0 } } as never);

describe('DiscoveryDrawer (REV-78)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    useDiscoveryStore.setState({ isOpen: true, activeJobId: null, resultsSeen: false, notifiedJobId: null, importResult: null });
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

  const flush = () =>
    act(async () => {
      // react-query hands results to observers on a zero-delay timer
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  const mount = async () => {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('dark', 'en') },
            React.createElement(MemoryRouter, null, React.createElement(DiscoveryDrawer)),
          ),
        ),
      );
    });
    await flush();
  };

  /** Mounts the drawer on the Review step of a job reporting `status` */
  const mountWithJob = async (status: IDiscoveryJobStatus | Error) => {
    const spy = vi.spyOn(apiClient, 'getDiscoveryStatus');
    if (status instanceof Error) spy.mockRejectedValue(status);
    else spy.mockResolvedValue(status);
    useDiscoveryStore.setState({ activeJobId: 'disc-1' });
    await mount();
  };

  const page = () => document.body.textContent ?? '';
  const currentStep = () => document.body.querySelector('[aria-current="step"] .MuiStepLabel-label')?.textContent;
  const button = (label: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const click = async (el: HTMLElement | undefined) => {
    expect(el).toBeDefined();
    await act(async () => el!.click());
    await flush();
  };
  const locationInput = () =>
    [...document.body.querySelectorAll<HTMLInputElement>('input')].find((i) => i.placeholder === en.discovery.locationPlaceholder);

  it('opens as a labelled dialog on the Where step with the three steps', async () => {
    await mount();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('discovery-drawer-title');
    expect(page()).toContain(en.discovery.title);
    expect(page()).toContain(en.discovery.steps.where);
    expect(page()).toContain(en.discovery.steps.review);
    expect(page()).toContain(en.discovery.steps.import);
    expect(currentStep()).toBe(en.discovery.steps.where);
    expect(locationInput()).toBeDefined();
    // Nothing runs yet, so there is nothing to send to the background
    expect(button(en.discovery.runInBackground)).toBeUndefined();
  });

  it('shows a validation error instead of starting an invalid search', async () => {
    const start = vi.spyOn(apiClient, 'startDiscovery');
    await mount();
    const form = document.body.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(start).not.toHaveBeenCalled();
    expect(page()).toContain(en.discovery.errors.location);
    expect(currentStep()).toBe(en.discovery.steps.where);
  });

  it('starts a search, moves to Review and runs it in the background', async () => {
    const start = vi.spyOn(apiClient, 'startDiscovery').mockResolvedValue({ jobId: 'disc-1' } as never);
    vi.spyOn(apiClient, 'getDiscoveryStatus').mockResolvedValue(jobStatus('active'));
    await mount();

    const input = locationInput()!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'Vilnius');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(en.discovery.start));

    expect(start).toHaveBeenCalledWith(expect.objectContaining({ location: 'Vilnius', provider: 'osm', niche: 'dental', limit: 20 }));
    expect(useDiscoveryStore.getState().activeJobId).toBe('disc-1');
    expect(currentStep()).toBe(en.discovery.steps.review);
    expect(page()).toContain(en.discovery.states.running);
    expect(page()).toContain(en.discovery.runningHint);

    await click(button(en.discovery.runInBackground));
    expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, activeJobId: 'disc-1' });
  });

  it('reopens on the Review step while the search still runs', async () => {
    await mountWithJob(jobStatus('waiting'));
    act(() => useDiscoveryStore.getState().close());
    act(() => useDiscoveryStore.getState().open());
    await flush();
    expect(currentStep()).toBe(en.discovery.steps.review);
    expect(page()).toContain(en.discovery.states.queued);
    expect(button(en.discovery.runInBackground)).toBeDefined();
  });

  it('lists the candidates and imports the selection into the Import step', async () => {
    await mountWithJob(completed([candidate('a', 'new'), candidate('b', 'new'), candidate('c', 'existing_lead')]));
    const importSpy = vi.spyOn(apiClient, 'importDiscoveryCandidates').mockResolvedValue({
      imported: 1,
      results: [{ externalId: 'a', outcome: 'imported', leadId: 'lead-a' }],
    });

    expect(currentStep()).toBe(en.discovery.steps.review);
    expect(page()).toContain('Business a');
    // Existing leads stay hidden until their toggle is on (REV-35)
    expect(page()).not.toContain('Business c');
    expect(useDiscoveryStore.getState().resultsSeen).toBe(true);

    // Deselect b, import a
    const bBox = document.body.querySelector<HTMLInputElement>('input[aria-label="Business b"]')!;
    await click(bBox);
    await click(button(en.discovery.import.replace('{{selected}}', '1')));

    expect(importSpy).toHaveBeenCalledWith('disc-1', ['a']);
    expect(useDiscoveryStore.getState().importResult).toMatchObject({ imported: 1 });
    expect(currentStep()).toBe(en.discovery.steps.import);
    expect(page()).toContain(en.discovery.importDone.replace('{{imported}}', '1'));
    expect(page()).toContain(en.discovery.importNextHint);

    // b is still new, so the operator can go back for it
    await click(button(en.discovery.reviewRemaining.replace('{{count}}', '2')));
    expect(currentStep()).toBe(en.discovery.steps.review);
  });

  it('closes from the Import step with Done and reopens on it', async () => {
    await mountWithJob(completed([candidate('a', 'existing_lead')]));
    act(() => useDiscoveryStore.getState().setImportResult('disc-1', { imported: 0, results: [] }));
    await flush();
    expect(currentStep()).toBe(en.discovery.steps.import);
    // Nothing left to import, so there is no way back to Review
    expect(button(en.discovery.reviewRemaining.replace('{{count}}', '0'))).toBeUndefined();

    await click(button(en.discovery.done));
    expect(useDiscoveryStore.getState().isOpen).toBe(false);
    act(() => useDiscoveryStore.getState().open());
    await flush();
    expect(currentStep()).toBe(en.discovery.steps.import);
  });

  it('tells the operator when a search found nothing new', async () => {
    await mountWithJob(completed([candidate('a', 'existing_lead')]));
    expect(page()).toContain(en.discovery.nothingNewHint);
  });

  it('shows a failed search on the Review step and changes it with the old parameters', async () => {
    await mountWithJob(jobStatus('failed', null, 'Overpass timed out'));
    expect(currentStep()).toBe(en.discovery.steps.review);
    expect(page()).toContain(en.discovery.states.failed);
    expect(page()).toContain('Overpass timed out');
    expect(button(en.discovery.runInBackground)).toBeUndefined();

    await click(button(en.discovery.changeSearch));
    expect(useDiscoveryStore.getState().activeJobId).toBeNull();
    expect(currentStep()).toBe(en.discovery.steps.where);
    expect(locationInput()?.value).toBe('Vilnius');
    expect(page()).toContain(en.discovery.keywordLabel);
    const keyword = [...document.body.querySelectorAll<HTMLInputElement>('input')].find((i) => i.value === 'orthodontist');
    expect(keyword).toBeDefined();
  });

  it('shows a legacy search that imported automatically', async () => {
    await mountWithJob(jobStatus('completed', { created: 3 } as never));
    expect(page()).toContain(en.discovery.legacyResult);
    expect(button(en.discovery.changeSearch)).toBeDefined();
  });

  it('shows a status request error with a way back to the form', async () => {
    await mountWithJob(new Error('network down'));
    expect(page()).toContain('network down');
    await click(button(en.discovery.changeSearch));
    expect(currentStep()).toBe(en.discovery.steps.where);
  });
});
