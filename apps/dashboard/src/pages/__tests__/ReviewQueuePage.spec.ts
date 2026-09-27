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
import { LEADS_QUERY_KEY } from '../../hooks/useLeads.js';
import { AppRoutes } from '../../routes/AppRoutes.js';
import type { ReviewDecision } from '../../components/leadReview/LeadReview.js';

// The review has its own tests; here it only shows which lead it holds and reports a decision
vi.mock('../../components/leadReview/LeadReview.js', () => ({
  LeadReview: ({ lead, onDecision }: { lead: { id: string }; onDecision?: (d: ReviewDecision) => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'review', 'data-lead': lead.id },
      React.createElement('button', { 'data-testid': 'decide-approve', onClick: () => onDecision?.('approved') }, 'approve'),
    ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead = (id: string, status: ILeadItem['status'], createdAt: string, businessName = `Lead ${id}`): ILeadItem => ({
  id,
  businessName,
  domain: `${id}.example`,
  originalUrl: `https://${id}.example`,
  niche: 'dental',
  city: 'Vilnius',
  status,
  totalScore: 42,
  auditId: `audit-${id}`,
  createdAt,
});

// Needs you, oldest first: n1, n2 (audit failed), n3
const LEADS = [
  lead('n3', 'NEEDS_APPROVAL', '2026-09-27T09:00:00.000Z', 'Linden Physio'),
  lead('n1', 'NEEDS_APPROVAL', '2026-09-25T09:00:00.000Z', 'Harbor Dental'),
  lead('n2', 'AUDIT_FAILED', '2026-09-26T09:00:00.000Z', 'Northside Auto'),
  lead('p1', 'AUDITING', '2026-09-27T08:00:00.000Z', 'Cedar Vet'),
  lead('o1', 'SENT', '2026-09-20T09:00:00.000Z', 'Bright Smile'),
  lead('o2', 'OPENED', '2026-09-22T09:00:00.000Z', 'Oak Bistro'),
];

/** Shows the router's current location, so tests can follow navigation and the query */
const LocationProbe: React.FC = () => {
  const { pathname, search } = useLocation();
  return React.createElement('output', { 'data-testid': 'location' }, `${pathname}${search}`);
};

describe('review queue home (REV-79)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.spyOn(apiClient, 'getLeads').mockResolvedValue({ leads: LEADS, total: LEADS.length });
    vi.spyOn(apiClient, 'getLeadStats').mockResolvedValue({
      total: 6,
      byStatus: { NEEDS_APPROVAL: 2, AUDIT_FAILED: 1, AUDITING: 1, SENT: 1, OPENED: 1 },
    });
    vi.spyOn(apiClient, 'getLlmProviders').mockResolvedValue({ workersOnline: false, providers: [] });
    useLeadFilterStore.getState().resetFilters();
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

  const mount = async (entry = '/') => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
              { initialEntries: [entry] },
              React.createElement(AppRoutes),
              React.createElement(LocationProbe),
            ),
          ),
        ),
      );
    });
    await flush();
    await flush();
  };

  const location = () => document.querySelector('[data-testid="location"]')!.textContent!;
  const query = () => new URLSearchParams(location().split('?')[1] ?? '');
  const tab = (bucket: string) => document.querySelector<HTMLElement>(`[data-bucket="${bucket}"]`)!;
  const listed = () => [...document.querySelectorAll<HTMLElement>('[data-queue-item]')].map((el) => el.dataset.queueItem);
  const selected = () => document.querySelector<HTMLElement>('[data-queue-item].Mui-selected')?.dataset.queueItem ?? null;
  const reviewed = () => document.querySelector('[data-testid="review"]')?.getAttribute('data-lead') ?? null;
  const key = (k: string, target: EventTarget = document.body) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });
  /** The API's next answer, as a worker or an approval would leave it, and the refetch after a mutation */
  const refetchWith = async (leads: ILeadItem[]) => {
    vi.mocked(apiClient.getLeads).mockResolvedValue({ leads, total: leads.length });
    await act(async () => queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY }));
    await flush();
    await flush();
  };

  it('shows the four buckets with their counts and opens on Needs you, oldest first', async () => {
    await mount();

    expect(document.querySelector('h1')?.textContent).toBe(en.queue.title);
    expect(tab('needs_you').textContent).toBe(`${en.buckets.needs_you}3`);
    expect(tab('in_progress').textContent).toBe(`${en.buckets.in_progress}1`);
    expect(tab('outreach').textContent).toBe(`${en.buckets.outreach}2`);
    expect(tab('closed').textContent).toBe(`${en.buckets.closed}0`);
    expect(tab('needs_you').getAttribute('aria-selected')).toBe('true');

    expect(listed()).toEqual(['n1', 'n2', 'n3']);
    expect(document.body.textContent).toContain(en.queue.listCaption.needs_you);
    expect(document.body.textContent).toContain(en.queue.keyboardHint);
  });

  it('selects the first lead and shows its review next to the list', async () => {
    await mount();
    expect(selected()).toBe('n1');
    expect(reviewed()).toBe('n1');
    expect(query().get('bucket')).toBe('needs_you');
    expect(query().get('lead')).toBe('n1');
  });

  it('badges the rail with the Needs-you count', async () => {
    await mount();
    const rail = document.querySelector<HTMLElement>('[data-rail="queue"]')!;
    expect(rail.getAttribute('aria-label')).toBe(en.rail.queueWithCount.replace('{{count}}', '3'));
  });

  it('selects a lead on click', async () => {
    await mount();
    await act(async () => document.querySelector<HTMLElement>('[data-queue-item="n3"]')!.click());
    expect(selected()).toBe('n3');
    expect(reviewed()).toBe('n3');
    expect(query().get('lead')).toBe('n3');
  });

  it('switches buckets, newest first outside Needs you', async () => {
    await mount();
    await act(async () => tab('outreach').click());
    await flush();

    expect(listed()).toEqual(['o2', 'o1']);
    expect(selected()).toBe('o2');
    expect(reviewed()).toBe('o2');
    expect(query().get('bucket')).toBe('outreach');
  });

  it('shows an empty state for an empty bucket', async () => {
    await mount('/?bucket=closed');
    expect(tab('closed').getAttribute('aria-selected')).toBe('true');
    expect(listed()).toEqual([]);
    expect(document.querySelector('[data-testid="queue-empty"]')!.textContent).toBe(en.queue.empty.closed);
    expect(reviewed()).toBeNull();
    expect(query().has('lead')).toBe(false);
  });

  it('empties Needs you with its own message once every lead is handled', async () => {
    await mount();
    await refetchWith(LEADS.filter((l) => l.status !== 'NEEDS_APPROVAL' && l.status !== 'AUDIT_FAILED'));
    expect(tab('needs_you').textContent).toBe(`${en.buckets.needs_you}0`);
    expect(document.querySelector('[data-testid="queue-empty"]')!.textContent).toBe(en.queue.empty.needs_you);
  });

  it('opens the bucket of a linked lead', async () => {
    await mount('/?lead=o1');
    expect(tab('outreach').getAttribute('aria-selected')).toBe('true');
    expect(selected()).toBe('o1');
    expect(query().get('bucket')).toBe('outreach');
  });

  it('selects the next lead after an approval, stays on Needs you and confirms it', async () => {
    await mount();
    expect(reviewed()).toBe('n1');

    await act(async () => document.querySelector<HTMLElement>('[data-testid="decide-approve"]')!.click());
    // The approved lead moves on to Outreach
    await refetchWith(LEADS.map((l) => (l.id === 'n1' ? { ...l, status: 'SCHEDULED' as const } : l)));

    expect(tab('needs_you').getAttribute('aria-selected')).toBe('true');
    expect(listed()).toEqual(['n2', 'n3']);
    expect(selected()).toBe('n2');
    expect(reviewed()).toBe('n2');
    expect(query().get('lead')).toBe('n2');
    expect(tab('outreach').textContent).toBe(`${en.buckets.outreach}3`);
    expect(document.body.textContent).toContain(en.queue.approved.replace('{{name}}', 'Harbor Dental'));
  });

  it('selects the lead before when the last one is rejected', async () => {
    await mount('/?bucket=needs_you&lead=n3');
    await refetchWith(LEADS.map((l) => (l.id === 'n3' ? { ...l, status: 'REJECTED' as const } : l)));
    expect(selected()).toBe('n2');
  });

  it('moves with J / K and opens the selected lead with Enter', async () => {
    await mount();
    await key('j');
    expect(selected()).toBe('n2');
    await key('j');
    await key('j');
    expect(selected()).toBe('n3');
    await key('k');
    expect(selected()).toBe('n2');
    expect(reviewed()).toBe('n2');

    await key('Enter');
    await flush();
    expect(location()).toBe('/leads/n2');
  });

  it('opens a focused lead with Enter', async () => {
    await mount();
    const item = document.querySelector<HTMLElement>('[data-queue-item="n3"]')!;
    item.focus();
    await key('Enter', item);
    await flush();
    expect(location()).toBe('/leads/n3');
  });

  it('ignores J / K / Enter while the search field has focus', async () => {
    await mount();
    const search = document.querySelector<HTMLInputElement>(`input[aria-label="${en.topBar.searchLabel}"]`)!;
    search.focus();
    await key('j', search);
    await key('Enter', search);
    await flush();
    expect(selected()).toBe('n1');
    expect(location().startsWith('/?')).toBe(true);
  });

  it('stops listening once the operator leaves the queue', async () => {
    await mount();
    await act(async () => document.querySelector<HTMLElement>('[data-rail="settings"]')!.click());
    await flush();
    await key('j');
    await key('Enter');
    await flush();
    expect(location()).toBe('/settings');
  });

  describe('quick filters (REV-80)', () => {
    // Needs you, oldest first: n1 (42), n2 (audit failed, no score), n3 (85)
    const FILTER_LEADS = LEADS.map((l) =>
      l.id === 'n2' ? { ...l, totalScore: undefined } : l.id === 'n3' ? { ...l, totalScore: 85 } : l,
    );
    const toggle = () => document.querySelector<HTMLElement>('[data-testid="queue-filter-toggle"]')!;
    const chip = (group: string, value: string) =>
      document.querySelector<HTMLElement>(`[data-filter-group="${group}"] [data-filter="${value}"]`)!;
    const caption = () => document.querySelector('[data-testid="queue-caption"]')!.textContent;
    const click = async (el: HTMLElement) => {
      await act(async () => el.click());
      await flush();
    };
    const mountFiltered = async (entry?: string) => {
      vi.mocked(apiClient.getLeads).mockResolvedValue({ leads: FILTER_LEADS, total: FILTER_LEADS.length });
      await mount(entry);
      await click(toggle());
    };

    it('starts closed and unfiltered, with the Filter button next to the caption', async () => {
      await mount();
      expect(toggle().textContent).toBe(en.queue.filters.button);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector('[data-filter-group]')).toBeNull();
      expect(caption()).toBe(en.queue.listCaption.needs_you);
    });

    it('offers the bucket statuses and score bands with their counts', async () => {
      await mountFiltered();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(chip('status', 'AUDIT_FAILED').textContent).toBe(`${en.statuses.AUDIT_FAILED}1`);
      expect(chip('status', 'NEEDS_APPROVAL').textContent).toBe(`${en.statuses.NEEDS_APPROVAL}2`);
      expect(chip('score', 'low').textContent).toBe(`${en.queue.filters.bands.low}0`);
      expect(chip('score', 'medium').textContent).toBe(`${en.queue.filters.bands.medium}1`);
      expect(chip('score', 'high').textContent).toBe(`${en.queue.filters.bands.high}1`);
      expect(chip('status', 'AUDIT_FAILED').getAttribute('aria-pressed')).toBe('false');
    });

    it('narrows the list by status, counts it in the caption and moves the selection along', async () => {
      await mountFiltered();
      expect(selected()).toBe('n1');
      await click(chip('status', 'AUDIT_FAILED'));

      expect(chip('status', 'AUDIT_FAILED').getAttribute('aria-pressed')).toBe('true');
      expect(listed()).toEqual(['n2']);
      expect(selected()).toBe('n2');
      expect(reviewed()).toBe('n2');
      expect(query().get('lead')).toBe('n2');
      expect(caption()).toBe(`${en.queue.listCaption.needs_you} · 1 of 3`);
      expect(toggle().textContent).toBe(en.queue.filters.buttonActive.replace('{{count}}', '1'));
    });

    it('hides unscored leads only while a score band is picked', async () => {
      await mountFiltered();
      await click(chip('score', 'medium'));
      await click(chip('score', 'high'));
      expect(listed()).toEqual(['n1', 'n3']);

      await click(chip('score', 'medium'));
      await click(chip('score', 'high'));
      expect(listed()).toEqual(['n1', 'n2', 'n3']);
      expect(caption()).toBe(en.queue.listCaption.needs_you);
    });

    it('moves J / K through the filtered list only', async () => {
      await mountFiltered();
      await click(chip('score', 'medium'));
      await click(chip('score', 'high'));
      (document.activeElement as HTMLElement | null)?.blur();
      await key('j');
      expect(selected()).toBe('n3');
      await key('j');
      expect(selected()).toBe('n3');
      await key('k');
      expect(selected()).toBe('n1');
    });

    it('says when the filters match nothing, apart from an empty bucket, and clears them', async () => {
      await mountFiltered();
      await click(chip('score', 'low'));

      expect(listed()).toEqual([]);
      expect(document.querySelector('[data-testid="queue-empty"]')).toBeNull();
      const empty = document.querySelector<HTMLElement>('[data-testid="queue-filtered-empty"]')!;
      expect(empty.textContent).toContain(en.queue.filters.noMatch);
      expect(caption()).toBe(`${en.queue.listCaption.needs_you} · 0 of 3`);
      expect(reviewed()).toBeNull();
      expect(query().has('lead')).toBe(false);

      await click(empty.querySelector('button')!);
      expect(listed()).toEqual(['n1', 'n2', 'n3']);
      expect(document.querySelector('[data-testid="queue-filtered-empty"]')).toBeNull();
      expect(selected()).toBe('n1');
    });

    it('resets the filters when the bucket changes, and when coming back', async () => {
      await mountFiltered();
      await click(chip('status', 'AUDIT_FAILED'));
      expect(listed()).toEqual(['n2']);

      await click(tab('outreach'));
      expect(listed()).toEqual(['o2', 'o1']);
      expect(chip('status', 'SENT').getAttribute('aria-pressed')).toBe('false');
      expect(caption()).toBe(en.queue.listCaption.outreach);
      expect(query().get('bucket')).toBe('outreach');
      expect([...query().keys()].sort()).toEqual(['bucket', 'lead']);

      await click(tab('needs_you'));
      expect(listed()).toEqual(['n1', 'n2', 'n3']);
      expect(toggle().textContent).toBe(en.queue.filters.button);
    });

    it('hides the status filter in a bucket whose leads share one status', async () => {
      await mountFiltered('/?bucket=in_progress');
      expect(document.querySelector('[data-filter-group="status"]')).toBeNull();
      expect(document.querySelector('[data-filter-group="score"]')).not.toBeNull();
    });
  });

  it('offers Retry for a lead whose audit failed', async () => {
    await mount('/?lead=n2');
    expect(document.body.textContent).toContain(en.queue.auditFailedHint);
    const retry = [...document.querySelectorAll('button')].find((b) => b.textContent === en.auditFailure.retry);
    expect(retry).toBeDefined();
  });
});
