import React from 'react';
import { Navigate, RouteObject, useRoutes } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { ReviewQueuePage } from '../pages/ReviewQueuePage.js';
import { AllLeadsPage } from '../pages/AllLeadsPage.js';
import { LeadRoute } from '../pages/LeadRoute.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { ROUTES } from './paths.js';

/** The dashboard's routes (REV-76); a lead's review (REV-77) is a page of its own under All leads */
export const APP_ROUTES: RouteObject[] = [
  {
    path: ROUTES.queue,
    element: <Layout />,
    children: [
      { index: true, element: <ReviewQueuePage /> },
      { path: ROUTES.leads, element: <AllLeadsPage /> },
      { path: ROUTES.lead, element: <LeadRoute /> },
      { path: ROUTES.settings, element: <SettingsPage /> },
      { path: '*', element: <Navigate to={ROUTES.queue} replace /> },
    ],
  },
];

export const AppRoutes: React.FC = () => useRoutes(APP_ROUTES);
