import { beforeEach, expect } from 'vitest';

/**
 * REV-207: dashboard components read the signed-in role from the auth store, and a component without a session can do
 * nothing. Most dashboard tests are about something else, so each of them starts as a signed-in owner; a test about
 * roles or sign-in sets its own session (or null) in its own `beforeEach`/test, which runs after this one.
 */
beforeEach(async () => {
  if (!(expect.getState().testPath ?? '').includes('/apps/dashboard/')) return;
  const { useAuthStore } = await import('./apps/dashboard/src/store/useAuthStore.js');
  useAuthStore.setState({
    session: {
      token: 'test-token',
      user: { id: 'test-user', email: 'owner@test.example' },
      organization: { id: 'test-org', name: 'Test Studio' },
      role: 'owner',
    },
  });
});
