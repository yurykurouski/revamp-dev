/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { apiClient, ILeadItem } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useHitlModalStore } from '../../store/useHitlModalStore.js';
import { useLeadFilterStore } from '../../store/useLeadFilterStore.js';
import { AppRoutes } from '../AppRoutes.js';

// The inspector itself is REV-77's; here only its open state and its close callback matter
vi.mock('../../components/SideBySideInspectorModal.js', () => ({
  SideBySideInspectorModal: ({ onClose }: { onClose?: () => void }) =>
    React.createElement('button', { 'data-testid': 'close-inspector', onClick: onClose }, 'close'),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead = (id: string, status: ILeadItem['status'], businessName = `Lead ${id}`): ILeadItem => ({
  id,
  businessName,
  domain: `${id}.example`,
  originalUrl: `https://${id}.example`,
  niche: 'dental',
  status,
  auditId: `audit-${id}`,
  createdAt: '2026-09-27T10:00:00.000Z',
});

const LEADS = [
  lead('l1', 'NEEDS_APPROVAL', 'Harbor Dental'),
  lead('l2', 'AUDIT_FAILED', 'Northside Auto'),
  lead('l3', 'QUEUED', 'Cedar Vet'),
  lead('l4', 'SENT', 'Bright Smile'),
];

/** Shows the router's current path, so tests can follow navigation */
const PathProbe: React.FC = () => {
  const { pathname } = useLocation();
  return React.createElement('output', { 'data-testid': 'path' }, pathname);
};

describe('app shell and routes (REV-76)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(apiClient, 'getLeads').mockResolvedValue({ leads: LEADS, total: LEADS.length });
    vi.spyOn(apiClient, 'getLeadStats').mockResolvedValue({ total: 4, byStatus: { NEEDS_APPROVAL: 1, AUDIT_FAILED: 1, QUEUED: 1, SENT: 1 } });
    vi.spyOn(apiClient, 'getLlmProviders').mockResolvedValue({ workersOnline: false, providers: [] });
    useLeadFilterStore.getState().resetFilters();
    useLeadFilterStore.getState().setViewMode('kanban');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    useHitlModalStore.getState().closeModal();
    vi.restoreAllMocks();
  });

  const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

  /** Mounts the app with this history; the last entry is the current one */
  const mountHistory = async (entries: Array<string | { pathname: string; state?: unknown }>) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            ThemeProvider,
            { theme: getTheme('dark', 'en') },
            React.createElement(
              MemoryRouter,
              { initialEntries: entries, initialIndex: entries.length - 1 },
              React.createElement(AppRoutes),
              React.createElement(PathProbe),
            ),
          ),
        ),
      );
    });
    await flush();
    await flush();
  };
  const mount = (path: string) => mountHistory([path]);

  const path = () => document.querySelector('[data-testid="path"]')!.textContent;
  const railEntry = (key: string) => document.querySelector<HTMLElement>(`[data-rail="${key}"]`)!;
  const heading = () => document.querySelector('h1')?.textContent;
  const buttonNamed = (text: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text));

  it('opens on the review queue with the Needs-you leads and the rail badge', async () => {
    await mount('/');

    expect(heading()).toBe(en.queue.title);
    expect(railEntry('queue').getAttribute('aria-current')).toBe('page');
    expect(railEntry('queue').getAttribute('aria-label')).toBe(en.rail.queueWithCount.replace('{{count}}', '2'));

    const main = document.querySelector('main')!.textContent!;
    expect(main).toContain('Harbor Dental');
    expect(main).toContain('Northside Auto');
    expect(main).not.toContain('Cedar Vet');
    expect(main).not.toContain('Bright Smile');
  });

  it('loads Settings from a deep link', async () => {
    await mount('/settings');
    expect(heading()).toBe(en.settings.title);
    expect(railEntry('settings').getAttribute('aria-current')).toBe('page');
    expect(railEntry('queue').hasAttribute('aria-current')).toBe(false);
  });

  it('keeps only search, Find businesses and Add lead in the top bar', async () => {
    await mount('/leads');
    const topBar = document.querySelector('header')!;

    expect(topBar.querySelector(`input[aria-label="${en.topBar.searchLabel}"]`)).not.toBeNull();
    expect(topBar.textContent).toContain(en.header.findBusinesses);
    expect(topBar.textContent).toContain(en.topBar.addLead);
    // Language and theme moved to Settings
    expect(topBar.querySelector('[role="combobox"]')).toBeNull();
    expect(topBar.querySelectorAll('button')).toHaveLength(2);
  });

  it('opens a lead from a deep link and replaces it with All leads when it closes', async () => {
    await mount('/leads/l3');

    expect(useHitlModalStore.getState()).toMatchObject({ isOpen: true, selectedLeadId: 'l3', selectedAuditId: 'audit-l3' });
    expect(heading()).toBe(en.allLeads.title);
    expect(railEntry('leads').getAttribute('aria-current')).toBe('page');

    await act(async () => document.querySelector<HTMLElement>('[data-testid="close-inspector"]')!.click());
    await flush();

    expect(path()).toBe('/leads');
    expect(useHitlModalStore.getState().isOpen).toBe(false);
  });

  it('steps back to the page a lead was opened from, so Back does not reopen it', async () => {
    await mountHistory(['/settings', '/', { pathname: '/leads/l1', state: { from: '/' } }]);
    await act(async () => document.querySelector<HTMLElement>('[data-testid="close-inspector"]')!.click());
    await flush();
    expect(path()).toBe('/');
    expect(useHitlModalStore.getState().isOpen).toBe(false);
  });

  it('opens a lead from its name on the queue with the queue as the page to return to', async () => {
    await mount('/');
    const link = [...document.querySelectorAll('main a')].find((a) => a.textContent?.includes('Harbor Dental'))!;
    await act(async () => (link as HTMLElement).click());
    await flush();
    expect(path()).toBe('/leads/l1');
    expect(useHitlModalStore.getState()).toMatchObject({ isOpen: true, selectedLeadId: 'l1' });

    await act(async () => document.querySelector<HTMLElement>('[data-testid="close-inspector"]')!.click());
    await flush();
    expect(path()).toBe('/');
  });

  it('clears the search when it hides the linked lead', async () => {
    const getLeads = vi.mocked(apiClient.getLeads);
    getLeads.mockImplementation(async (filters) =>
      filters?.search ? { leads: [], total: 0 } : { leads: LEADS, total: LEADS.length },
    );
    useLeadFilterStore.getState().setSearchQuery('nothing matches');

    await mount('/leads/l4');
    await flush();

    expect(useLeadFilterStore.getState().searchQuery).toBe('');
    expect(useHitlModalStore.getState()).toMatchObject({ isOpen: true, selectedLeadId: 'l4' });
  });

  it('says so when the linked lead does not exist', async () => {
    await mount('/leads/missing');
    expect(document.body.textContent).toContain(en.leadRoute.notFound);
    expect(useHitlModalStore.getState().isOpen).toBe(false);
  });

  it('closes the lead when the operator leaves its route from the rail', async () => {
    await mount('/leads/l1');
    expect(useHitlModalStore.getState().isOpen).toBe(true);

    await act(async () => railEntry('settings').click());
    await flush();

    expect(path()).toBe('/settings');
    expect(useHitlModalStore.getState().isOpen).toBe(false);
  });

  it('moves the active rail entry as the operator navigates', async () => {
    await mount('/');
    await act(async () => railEntry('leads').click());
    await flush();

    expect(path()).toBe('/leads');
    expect(railEntry('leads').getAttribute('aria-current')).toBe('page');
    expect(railEntry('queue').hasAttribute('aria-current')).toBe(false);
  });

  it('sends unknown paths to the review queue', async () => {
    await mount('/does-not-exist');
    expect(path()).toBe('/');
    expect(heading()).toBe(en.queue.title);
  });

  it('filters All leads by bucket and shows the count of each bucket', async () => {
    await mount('/leads');
    const main = () => document.querySelector('main')!.textContent!;

    expect(buttonNamed(en.buckets.ALL)!.textContent).toBe(`${en.buckets.ALL}4`);
    expect(buttonNamed(en.buckets.needs_you)!.textContent).toBe(`${en.buckets.needs_you}2`);
    expect(buttonNamed(en.buckets.outreach)!.textContent).toBe(`${en.buckets.outreach}1`);
    expect(main()).toContain('Cedar Vet');

    await act(async () => buttonNamed(en.buckets.needs_you)!.click());

    expect(useLeadFilterStore.getState().selectedBucket).toBe('needs_you');
    expect(main()).toContain('Harbor Dental');
    expect(main()).toContain('Northside Auto');
    expect(main()).not.toContain('Cedar Vet');
    expect(main()).not.toContain('Bright Smile');
  });

  it('switches All leads between the board and the table', async () => {
    await mount('/leads');
    await act(async () => buttonNamed(en.allLeads.table)!.click());
    expect(useLeadFilterStore.getState().viewMode).toBe('table');
    expect(document.querySelector('.MuiDataGrid-root')).not.toBeNull();

    await act(async () => buttonNamed(en.allLeads.board)!.click());
    expect(useLeadFilterStore.getState().viewMode).toBe('kanban');
    expect(document.querySelector('.MuiDataGrid-root')).toBeNull();
  });

  it('links each lead name to its route', async () => {
    await mount('/leads');
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Bright Smile');
    expect(link?.getAttribute('href')).toBe('/leads/l4');
  });
});
