import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, ILeadItem, KpiMetrics } from '../api/client.js';
import { QuickAddLeadInput } from '@revamp/validation';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';

export const LEADS_QUERY_KEY = ['leads'];

export const useLeadsQuery = () => {
  const { searchQuery, selectedStatus, selectedNiche } = useLeadFilterStore();

  return useQuery<{ leads: ILeadItem[]; kpi: KpiMetrics }>({
    queryKey: [...LEADS_QUERY_KEY, searchQuery, selectedStatus, selectedNiche],
    queryFn: () =>
      apiClient.getLeads({
        search: searchQuery,
        status: selectedStatus,
        niche: selectedNiche,
      }),
    refetchInterval: 10000, // Background poll every 10 seconds for live worker updates
  });
};

export const useCreateLeadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: QuickAddLeadInput) => apiClient.createLead(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    },
  });
};
