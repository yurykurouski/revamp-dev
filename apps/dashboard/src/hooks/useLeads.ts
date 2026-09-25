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

export const useAuditQuery = (auditId: string | null) => {
  return useQuery({
    queryKey: ['audit', auditId],
    queryFn: () => (auditId ? apiClient.getAudit(auditId) : null),
    enabled: Boolean(auditId),
    staleTime: 60000,
  });
};

export const useMvpQuery = (leadId: string | null) => {
  return useQuery({
    queryKey: ['mvp', leadId],
    queryFn: () => (leadId ? apiClient.getMvp(leadId) : null),
    enabled: Boolean(leadId),
    staleTime: 30000,
  });
};

export const useApproveOutreachMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      leadId,
      emailData,
    }: {
      leadId: string;
      emailData?: { subject: string; preheader: string; body: string };
    }) => apiClient.approveOutreach(leadId, emailData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    },
  });
};

export const useSendTestEmailMutation = () => {
  return useMutation({
    mutationFn: ({ leadId, testEmail }: { leadId: string; testEmail: string }) =>
      apiClient.sendTestEmail(leadId, testEmail),
  });
};

export const useRejectLeadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId, reason }: { leadId: string; reason: string }) =>
      apiClient.rejectLead(leadId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    },
  });
};

export const useUpdateMvpTokensMutation = () => {
  return useMutation({
    mutationFn: ({
      mvpId,
      tokens,
    }: {
      mvpId: string;
      tokens: { primaryColor?: string; secondaryColor?: string; accentColor?: string };
    }) => apiClient.updateMvpTokens(mvpId, tokens),
  });
};

export const useGenerateMvpMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ auditId, leadId }: { auditId: string; leadId?: string }) =>
      apiClient.generateMvp(auditId, leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    },
  });
};
