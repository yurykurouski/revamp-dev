import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions.js';
import { ROUTES } from './paths.js';

/** Pages for roles that manage members (REV-207): anyone else goes to the queue; the API answers 403 to them anyway */
export const RequireOwner: React.FC = () => {
  const { canManageMembers } = usePermissions();
  return canManageMembers ? <Outlet /> : <Navigate to={ROUTES.queue} replace />;
};
