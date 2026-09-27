import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient, ILeadItem, KpiMetrics } from '../api/client.js';
import { QuickAddLeadInput, mvpGenerationMode } from '@revamp/validation';
import { LeadStatus, LlmProviderId } from '@revamp/shared-types';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';

export const LEADS_QUERY_KEY = ['leads'];

export const useLeadsQuery = () => {
  const { searchQuery, selectedStatus, selectedNiche, selectedComplexity } = useLeadFilterStore();

  return useQuery<{ leads: ILeadItem[]; kpi: KpiMetrics; total: number }>({
    queryKey: [...LEADS_QUERY_KEY, searchQuery, selectedStatus, selectedNiche, selectedComplexity],
    queryFn: () =>
      apiClient.getLeads({
        search: searchQuery,
        status: selectedStatus,
        niche: selectedNiche,
        complexity: selectedComplexity,
      }),
    refetchInterval: 10000, // Background poll every 10 seconds for live worker updates
    // Search runs on the server now (REV-43); keep the board on screen while the next result loads
    placeholderData: keepPreviousData,
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

/** Re-queues a failed audit (REV-44) */
export const useRetryAuditMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId }: { leadId: string }) => apiClient.retryAudit(leadId),
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

export interface GenerateMvpVariables {
  auditId: string;
  leadId?: string;
  /** Replace an existing MVP (REV-31) */
  forceRegenerate?: boolean;
  /** Provider/model for this run; the server default applies when absent (REV-32) */
  provider?: LlmProviderId;
  model?: string;
}

/** Sends a generate or regenerate request (REV-31); exported for tests */
export const generateMvpRequest = ({ auditId, forceRegenerate, provider, model }: GenerateMvpVariables) =>
  apiClient.generateMvp(auditId, {
    forceRegenerate: forceRegenerate ?? false,
    ...(provider ? { provider, ...(model ? { model } : {}) } : {}),
  });

export const LLM_PROVIDERS_QUERY_KEY = ['llm-providers'] as const;

/** Provider/model options for MVP generation (REV-32); refreshed as the workers report in */
export const useLlmProvidersQuery = (enabled = true) =>
  useQuery({
    queryKey: LLM_PROVIDERS_QUERY_KEY,
    queryFn: () => apiClient.getLlmProviders(),
    enabled,
    staleTime: 30000,
  });

export const useGenerateMvpMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateMvpRequest,
    onSuccess: (_data, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      if (leadId) queryClient.invalidateQueries({ queryKey: ['mvp', leadId] });
    },
  });
};

/** Whether the dashboard offers "Regenerate MVP" for a lead (REV-31) */
export const canRegenerateMvp = (status: LeadStatus | undefined): boolean =>
  mvpGenerationMode(status) === 'regenerate';

/**
 * Appends the MVP generation time as a `v` query parameter, so the preview iframe and the banner
 * reload after a regeneration that overwrote the same URL (REV-31).
 */
export const withPreviewVersion = (url: string | undefined, version: string | undefined): string => {
  if (!url) return '';
  if (!version) return url;
  const stamp = Date.parse(version);
  if (Number.isNaN(stamp)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('v', String(stamp));
    return parsed.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}v=${stamp}`;
  }
};
