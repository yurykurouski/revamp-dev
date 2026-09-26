import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscoveryJobState, IDiscoveryJobStatus } from '@revamp/shared-types';
import { StartDiscoveryDto, StartDiscoveryInput, StartDiscoverySchema } from '@revamp/validation';
import { apiClient } from '../api/client.js';
import { LEADS_QUERY_KEY } from './useLeads.js';

export const DISCOVERY_POLL_INTERVAL_MS = 2000;

const FINISHED_STATES: DiscoveryJobState[] = ['completed', 'failed'];

export function isDiscoveryFinished(status?: Pick<IDiscoveryJobStatus, 'state'> | null): boolean {
  return Boolean(status && FINISHED_STATES.includes(status.state));
}

/** Poll interval for react-query: keep polling until the job has finished */
export function discoveryRefetchInterval(status?: Pick<IDiscoveryJobStatus, 'state'> | null): number | false {
  return isDiscoveryFinished(status) ? false : DISCOVERY_POLL_INTERVAL_MS;
}

export type DiscoveryStateBucket = 'queued' | 'running' | 'completed' | 'failed';

/** Collapses BullMQ job states into the four the operator sees */
export function discoveryStateBucket(state: DiscoveryJobState): DiscoveryStateBucket {
  if (state === 'active') return 'running';
  if (state === 'completed' || state === 'failed') return state;
  return 'queued';
}

export type DiscoveryFormErrorKey =
  | 'discovery.errors.location'
  | 'discovery.errors.keyword'
  | 'discovery.errors.limit'
  | 'discovery.errors.invalid';

/** Validates the form with the API's schema and maps the first issue to a translation key */
export function validateDiscoveryForm(
  input: StartDiscoveryInput,
): { success: true; data: StartDiscoveryDto } | { success: false; errorKey: DiscoveryFormErrorKey } {
  const parsed = StartDiscoverySchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };

  const field = parsed.error.issues[0]?.path[0];
  const errorKey: DiscoveryFormErrorKey =
    field === 'location' || field === 'keyword' || field === 'limit'
      ? `discovery.errors.${field}`
      : 'discovery.errors.invalid';
  return { success: false, errorKey };
}

export const useStartDiscoveryMutation = () =>
  useMutation({
    mutationFn: (input: StartDiscoveryInput) => apiClient.startDiscovery(input),
  });

export const useDiscoveryStatusQuery = (jobId: string | null) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['discovery', jobId],
    queryFn: () => apiClient.getDiscoveryStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => discoveryRefetchInterval(q.state.data),
  });

  // New leads appear once the job completes
  const completed = query.data?.state === 'completed';
  useEffect(() => {
    if (completed) {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    }
  }, [completed, queryClient]);

  return query;
};
