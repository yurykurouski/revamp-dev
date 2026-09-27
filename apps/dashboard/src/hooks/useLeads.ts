import { useQuery, useMutation, useQueryClient, useIsMutating, keepPreviousData } from '@tanstack/react-query';
import { apiClient, ILeadItem, IEmailDraft, IMvpProjectDetail } from '../api/client.js';
import { QuickAddLeadInput, mvpGenerationMode } from '@revamp/validation';
import { ILeadStats, LeadStatus, LlmProviderId } from '@revamp/shared-types';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';

export const LEADS_QUERY_KEY = ['leads'];

/**
 * Every lead matching the search, niche and site-type filters. The bucket filter (REV-76) is applied by
 * the page, so the bucket counts and the lead inspector see the whole filtered list.
 */
export const useLeadsQuery = () => {
  const { searchQuery, selectedNiche, selectedComplexity } = useLeadFilterStore();

  return useQuery<{ leads: ILeadItem[]; total: number }>({
    queryKey: [...LEADS_QUERY_KEY, searchQuery, selectedNiche, selectedComplexity],
    queryFn: () =>
      apiClient.getLeads({
        search: searchQuery,
        niche: selectedNiche,
        complexity: selectedComplexity,
      }),
    refetchInterval: 10000, // Background poll every 10 seconds for live worker updates
    // Search runs on the server now (REV-43); keep the board on screen while the next result loads
    placeholderData: keepPreviousData,
  });
};

/** Under LEADS_QUERY_KEY, so every mutation that refreshes the leads refreshes the counts too */
export const LEAD_STATS_QUERY_KEY = [...LEADS_QUERY_KEY, 'stats'];

/** Pipeline-wide counts by status (REV-43), for the rail's Needs-you badge (REV-76) */
export const useLeadStatsQuery = () =>
  useQuery<ILeadStats>({
    queryKey: LEAD_STATS_QUERY_KEY,
    queryFn: () => apiClient.getLeadStats(),
    refetchInterval: 10000,
  });

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
      emailData: IEmailDraft;
    }) => apiClient.approveOutreach(leadId, emailData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    },
  });
};

export const useSendTestEmailMutation = () => {
  return useMutation({
    mutationFn: ({ leadId, testEmail, draft }: { leadId: string; testEmail: string; draft: IEmailDraft }) =>
      apiClient.sendTestEmail(leadId, testEmail, draft),
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

/** The MVP record's own id, which PATCH /mvp/:id/tokens expects; never the lead id (REV-65) */
export const mvpRecordId = (mvp?: Pick<IMvpProjectDetail, 'id' | '_id'> | null): string | undefined =>
  mvp?.id || mvp?._id || undefined;

export const useUpdateMvpTokensMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      mvpId,
      tokens,
    }: {
      mvpId: string;
      leadId: string;
      tokens: { primaryColor?: string; secondaryColor?: string; accentColor?: string };
    }) => apiClient.updateMvpTokens(mvpId, tokens),
    // The saved MVP comes back from the server; keep the lead's cached MVP in step with it
    onSuccess: (saved, { leadId }) => {
      queryClient.setQueryData(['mvp', leadId], saved);
    },
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

export const GENERATE_MVP_MUTATION_KEY = ['generate-mvp'];

export const useGenerateMvpMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: GENERATE_MVP_MUTATION_KEY,
    mutationFn: generateMvpRequest,
    // Returned so the mutation stays pending until the lead shows GENERATING, leaving no gap in
    // the inspector's regeneration overlay (REV-53)
    onSuccess: (_data, { leadId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY }),
        leadId ? queryClient.invalidateQueries({ queryKey: ['mvp', leadId] }) : undefined,
      ]),
  });
};

/** Whether a generate/regenerate request for this lead is in flight (REV-53) */
export const useIsMvpGenerationPending = (leadId: string | null | undefined): boolean =>
  useIsMutating({
    mutationKey: GENERATE_MVP_MUTATION_KEY,
    predicate: (mutation) =>
      Boolean(leadId) && (mutation.state.variables as GenerateMvpVariables | undefined)?.leadId === leadId,
  }) > 0;

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
