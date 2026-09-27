import React from 'react';
import { Link } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { leadPath, LeadLocationState } from '../routes/paths.js';

interface LeadLinkProps {
  leadId: string;
  children: React.ReactNode;
}

/** A lead's name as a link to `/leads/:id` (REV-76), so the lead opens by keyboard and in a new tab */
export const LeadLink: React.FC<LeadLinkProps> = ({ leadId, children }) => {
  const { pathname } = useLocation();
  return (
    <Link
      component={RouterLink}
      to={leadPath(leadId)}
      state={{ from: pathname } satisfies LeadLocationState}
      color="inherit"
      underline="hover"
    >
      {children}
    </Link>
  );
};
