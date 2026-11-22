import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/useAuthStore.js';

/** Drops every cached response when the user signs out, so the next user never sees the previous one's data (REV-206) */
export function useClearCacheOnSignOut(client: QueryClient): void {
  useEffect(
    () =>
      useAuthStore.subscribe((state, previous) => {
        if (previous.session && !state.session) client.clear();
      }),
    [client],
  );
}
