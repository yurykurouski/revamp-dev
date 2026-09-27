import { useEffect } from 'react';
import { useLeadsQuery } from './useLeads.js';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';

/** Whether the list is narrowed by a filter that could hide the requested lead */
const hasListFilters = (s: { searchQuery: string; selectedNiche: string; selectedComplexity: string }) =>
  Boolean(s.searchQuery) || s.selectedNiche !== 'ALL' || s.selectedComplexity !== 'ALL';

/**
 * The lead with the given id from the polled leads list, for the pages that open one lead by URL
 * (`/leads/:id`, REV-76, and its full-window preview, REV-91). A lead hidden by the search or a filter
 * clears them. `missing` is set once the list has loaded (or failed) without the lead.
 */
export function useListedLead(id: string | undefined) {
  const { data, isLoading, isError } = useLeadsQuery();
  const filtersActive = useLeadFilterStore(hasListFilters);
  const resetFilters = useLeadFilterStore((s) => s.resetFilters);

  const lead = data?.leads.find((l) => l.id === id);

  const hiddenByFilters = Boolean(data) && !lead && filtersActive;
  useEffect(() => {
    if (hiddenByFilters) resetFilters();
  }, [hiddenByFilters, resetFilters]);

  const missing = !lead && !isLoading && !hiddenByFilters && Boolean(data || isError);
  return { lead, missing, isError };
}
