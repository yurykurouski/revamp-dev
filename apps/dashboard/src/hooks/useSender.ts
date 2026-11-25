import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IStudioSender } from '@revamp/shared-types';
import { apiClient, senderApi } from '../api/client.js';

export const SENDER_QUERY_KEY = ['sender'] as const;

/** The studio's sender (REV-221); every role reads it, approval and test sends need one */
export function useSenderQuery() {
  return useQuery({ queryKey: SENDER_QUERY_KEY, queryFn: () => senderApi.get() });
}

/** Saves the sender (owner only) and writes the answer into the cache, so the review unblocks at once */
export function useSaveSenderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sender: IStudioSender) => senderApi.save(sender),
    onSuccess: (view) => queryClient.setQueryData(SENDER_QUERY_KEY, view),
  });
}

/** The simulated email of a lead; fetched only while the dialog that shows it is open */
export function useOutboxQuery(leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['outbox', leadId],
    queryFn: () => apiClient.getOutbox(leadId),
    enabled,
    retry: false,
  });
}
