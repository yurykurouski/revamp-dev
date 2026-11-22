import React, { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { refreshSessionContext } from '../api/client.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { ROUTES, type LeadLocationState } from './paths.js';

/**
 * The app's pages need a session (REV-206). A visitor without one goes to the sign-in page and comes back to the
 * page they asked for; the same redirect catches a session that ends while the app is open.
 */
export const RequireAuth: React.FC = () => {
  const session = useAuthStore((s) => s.session);
  const token = session?.token;
  // The stored role can be out of date (REV-207): a role changed, or the member was removed. Ask once per sign-in
  useEffect(() => {
    if (token) void refreshSessionContext();
  }, [token]);
  const { pathname, search } = useLocation();
  if (!session) {
    const state: LeadLocationState = { from: `${pathname}${search}` };
    return <Navigate to={ROUTES.login} state={state} replace />;
  }
  return <Outlet />;
};
