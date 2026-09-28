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
import { useLeadFilterStore } from '../../store/useLeadFilterStore.js';
import { useDiscoveryStore } from '../../store/useDiscoveryStore.js';
import { AppRoutes } from '../AppRoutes.js';

// The review itself has its own tests; here only which lead it shows and its close callback matter
vi.mock('../../components/leadReview/LeadReview.js', () => ({
  LeadReview: ({ lead, onClose }: { lead: { id: string }; onClose?: () => void }) =>
    React.createElement('button', { 'data-testid': 'close-review', 'data-lead': lead.id, onClick: onClose }, 'close'),
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
  /** The id of the lead whose review is open, or null */
  const reviewedLead = () => document.querySelector('[data-testid="close-review"]')?.getAttribute('data-lead') ?? null;
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

  it('opens a lead review from a deep link and replaces it with All leads when it closes', async () => {
    await mount('/leads/l3');

    expect(reviewedLead()).toBe('l3');
    // The review is a page of its own, not an overlay on the list
    expect(heading()).toBeUndefined();
    expect(railEntry('leads').getAttribute('aria-current')).toBe('page');

    await act(async () => document.querySelector<HTMLElement>('[data-testid="close-review"]')!.click());
    await flush();

    expect(path()).toBe('/leads');
    expect(reviewedLead()).toBeNull();
  });

  it('steps back to the page a lead was opened from, so Back does not reopen it', async () => {
    await mountHistory(['/settings', '/', { pathname: '/leads/l1', state: { from: '/' } }]);
    await act(async () => document.querySelector<HTMLElement>('[data-testid="close-review"]')!.click());
    await flush();
    expect(path()).toBe('/');
    // Back on the queue, not on the lead's own page
    expect(heading()).toBe(en.queue.title);
  });

  it('opens a lead from the queue with the queue as the page to return to', async () => {
    await mount('/');
    const item = document.querySelector<HTMLElement>('[data-queue-item="l1"]')!;
    await act(async () => {
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await flush();
    expect(path()).toBe('/leads/l1');
    expect(reviewedLead()).toBe('l1');

    await act(async () => document.querySelector<HTMLElement>('[data-testid="close-review"]')!.click());
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
    expect(reviewedLead()).toBe('l4');
  });

  it('says so when the linked lead does not exist', async () => {
    await mount('/leads/missing');
    expect(document.body.textContent).toContain(en.leadRoute.notFound);
    expect(reviewedLead()).toBeNull();
  });

  it('closes the review when the operator leaves its route from the rail', async () => {
    await mount('/leads/l1');
    expect(reviewedLead()).toBe('l1');

    await act(async () => railEntry('settings').click());
    await flush();

    expect(path()).toBe('/settings');
    expect(reviewedLead()).toBeNull();
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

  describe('keyboard shortcuts (REV-47)', () => {
    const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
      act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
      });
    const shortcutsDialog = () => document.querySelector('[role="dialog"][aria-labelledby="shortcuts-dialog-title"]');
    const search = () => document.querySelector<HTMLInputElement>(`input[aria-label="${en.topBar.searchLabel}"]`)!;

    afterEach(() => {
      useLeadFilterStore.getState().closeAddModal();
      useDiscoveryStore.getState().close();
    });

    it('moves between the sections with 1, 2 and 3', async () => {
      await mount('/');
      await press('2');
      expect(path()).toBe('/leads');
      await press('3');
      expect(path()).toBe('/settings');
      await press('1');
      expect(path()).toBe('/');
    });

    it('opens discovery with D and Add lead with N', async () => {
      await mount('/leads');
      await press('d');
      expect(useDiscoveryStore.getState().isOpen).toBe(true);
      await act(async () => useDiscoveryStore.getState().close());
      await press('n');
      expect(useLeadFilterStore.getState().isAddModalOpen).toBe(true);
    });

    it('focuses the lead search with /', async () => {
      await mount('/leads');
      await press('/');
      expect(document.activeElement).toBe(search());
    });

    it('ignores shortcuts while typing in the search field', async () => {
      await mount('/leads');
      await press('/');
      await press('1', search());
      await press('?', search());
      expect(path()).toBe('/leads');
      expect(shortcutsDialog()).toBeNull();
    });

    it('ignores a key held with a modifier, leaving browser shortcuts alone', async () => {
      await mount('/leads');
      await press('1', document.body, { metaKey: true });
      await press('1', document.body, { ctrlKey: true });
      expect(path()).toBe('/leads');
    });

    it('shows the / hint on the empty search until it is focused or filled (REV-97)', async () => {
      await mount('/leads');
      const hint = () => document.querySelector('header [data-key-caps="focusSearch"]');
      expect(search().getAttribute('aria-keyshortcuts')).toBe('/');
      expect(hint()?.textContent).toBe('/');

      await press('/');
      expect(hint()).toBeNull();
      await act(async () => search().blur());
      expect(hint()).not.toBeNull();

      await act(async () => useLeadFilterStore.getState().setSearchQuery('dental'));
      expect(hint()).toBeNull();
    });

    it('shows the key in the Add lead tooltip (REV-97)', async () => {
      await mount('/leads');
      const addLead = buttonNamed(en.topBar.addLead)!;
      expect(addLead.getAttribute('aria-keyshortcuts')).toBe('N');

      await act(async () => {
        addLead.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      await act(async () => new Promise((r) => setTimeout(r, 200)));
      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip?.textContent).toContain(en.topBar.addLead);
      expect(tooltip?.querySelector('[data-key-caps="addLead"]')?.textContent).toBe('N');
    });

    it('lists every shortcut in the help overlay, from ? or the rail, and closes it on Esc', async () => {
      await mount('/');
      await press('?');
      const dialog = shortcutsDialog()!;
      expect(dialog.textContent).toContain(en.shortcuts.title);
      for (const text of [en.shortcuts.actions.goQueue, en.shortcuts.actions.next, en.shortcuts.actions.approve, en.shortcuts.actions.closeDialog]) {
        expect(dialog.textContent).toContain(text);
      }
      // Keys pressed inside the overlay belong to it
      await press('2', dialog.querySelector('button')!);
      expect(path()).toBe('/');

      await press('Escape', dialog.querySelector('button')!);
      // The dialog stays mounted for its exit transition
      await act(async () => new Promise((r) => setTimeout(r, 400)));
      expect(shortcutsDialog()).toBeNull();

      await act(async () => railEntry('shortcuts').click());
      expect(shortcutsDialog()).not.toBeNull();
    });
  });
});
