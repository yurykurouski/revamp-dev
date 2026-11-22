import React from 'react';
import { Navigate, RouteObject, useRoutes } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { ReviewQueuePage } from '../pages/ReviewQueuePage.js';
import { AllLeadsPage } from '../pages/AllLeadsPage.js';
import { LeadRoute } from '../pages/LeadRoute.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { MvpPreviewPage } from '../pages/MvpPreviewPage.js';
import { AuthPage } from '../pages/AuthPage.js';
import { InvitePage } from '../pages/InvitePage.js';
import { TeamPage } from '../pages/TeamPage.js';
import { RequireOwner } from './RequireOwner.js';
import { RequireAuth } from './RequireAuth.js';
import { ROUTES } from './paths.js';

/**
 * The dashboard's routes (REV-76); a lead's review (REV-77) is a page of its own under All leads. A lead's
 * full-window MVP preview (REV-91) sits outside the app shell.
 */
export const APP_ROUTES: RouteObject[] = [
  { path: ROUTES.login, element: <AuthPage mode="login" /> },
  { path: ROUTES.register, element: <AuthPage mode="register" /> },
  // The join page of an invitation link is public, and also open to a signed-in user (REV-207)
  { path: ROUTES.invite, element: <InvitePage /> },
  {
    // Everything else needs a session (REV-206)
    element: <RequireAuth />,
    children: [
      { path: ROUTES.leadPreview, element: <MvpPreviewPage /> },
      {
        path: ROUTES.queue,
        element: <Layout />,
        children: [
          { index: true, element: <ReviewQueuePage /> },
          { path: ROUTES.leads, element: <AllLeadsPage /> },
          { path: ROUTES.lead, element: <LeadRoute /> },
          { path: ROUTES.settings, element: <SettingsPage /> },
          // Members and invitations are for owners (REV-207)
          { element: <RequireOwner />, children: [{ path: ROUTES.team, element: <TeamPage /> }] },
          { path: '*', element: <Navigate to={ROUTES.queue} replace /> },
        ],
      },
    ],
  },
];

export const AppRoutes: React.FC = () => useRoutes(APP_ROUTES);
