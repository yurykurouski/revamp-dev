import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationRole } from '@revamp/shared-types';
import { organizationApi } from '../api/client.js';

export const MEMBERS_QUERY_KEY = ['organization', 'members'] as const;

/** The members and pending invitations of the signed-in owner's organization (REV-207) */
export function useMembersQuery() {
  return useQuery({ queryKey: MEMBERS_QUERY_KEY, queryFn: () => organizationApi.getMembers() });
}

/** Every change reloads the list, so the screen shows what the server has, not what was asked for */
function useMembersMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY }),
  });
}

export const useCreateInvitationMutation = () =>
  useMembersMutation((body: { email: string; role: OrganizationRole }) => organizationApi.createInvitation(body));

export const useRevokeInvitationMutation = () => useMembersMutation((id: string) => organizationApi.revokeInvitation(id));

export const useChangeMemberRoleMutation = () =>
  useMembersMutation(({ userId, role }: { userId: string; role: OrganizationRole }) => organizationApi.changeMemberRole(userId, role));

export const useRemoveMemberMutation = () => useMembersMutation((userId: string) => organizationApi.removeMember(userId));
