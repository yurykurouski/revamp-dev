import { useQuery, useMutation, useQueryClient, useIsMutating, keepPreviousData } from '@tanstack/react-query';
import { ApiError, apiClient, ILeadItem, IEmailDraft, IMvpPageResult, IMvpProjectDetail } from '../api/client.js';
import { QuickAddLeadInput, mvpGenerationMode } from '@revamp/validation';
import { ILeadStats, IMvpControlsUpdate, LeadStatus, LlmProviderId } from '@revamp/shared-types';
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

/** One of the operator's changes to a model-designed page (REV-139, REV-140), for the lead it was asked for */
export type MvpPageAction =
  | { action: 'change'; instruction: string }
  | { action: 'controls'; controls: IMvpControlsUpdate }
  | { action: 'restore'; version: number };
export type MvpPageActionVariables = { mvpId: string; leadId: string } & MvpPageAction;

const runMvpPageAction = (variables: MvpPageActionVariables): Promise<IMvpPageResult> => {
  switch (variables.action) {
    case 'change':
      return apiClient.editMvp(variables.mvpId, variables.instruction);
    case 'controls':
      return apiClient.updateMvpTokens(variables.mvpId, variables.controls);
    case 'restore':
      return apiClient.restoreMvpVersion(variables.mvpId, variables.version);
  }
};

/**
 * A free-text change, colors and fonts, or a restore of a model-designed page (REV-140). The API answers once the
 * page is re-published, with the MVP as saved, so the preview reloads at once. A refusal is an answer, not an error.
 * A 504 on a job the worker had started may still publish, so the MVP is fetched again.
 */
export const useMvpPageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<IMvpPageResult, Error, MvpPageActionVariables>({
    mutationFn: runMvpPageAction,
    onSuccess: (result, { leadId }) => {
      queryClient.setQueryData(['mvp', leadId], result.mvp);
    },
    onError: (error, { leadId }) => {
      if (error instanceof ApiError && error.status === 504) void queryClient.invalidateQueries({ queryKey: ['mvp', leadId] });
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
 * The version of the published MVP page: its generation, or a later free-text change (REV-85) that
 * re-published it at the same URL.
 */
export const mvpPreviewVersion = (
  lead: Pick<ILeadItem, 'mvpGeneratedAt'>,
  mvp: Pick<IMvpProjectDetail, 'generatedAt' | 'editedAt'> | null | undefined,
): string | undefined => {
  const generated = lead.mvpGeneratedAt || mvp?.generatedAt;
  const edited = mvp?.editedAt;
  if (!edited) return generated;
  if (!generated) return edited;
  return Date.parse(edited) > Date.parse(generated) ? edited : generated;
};

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
