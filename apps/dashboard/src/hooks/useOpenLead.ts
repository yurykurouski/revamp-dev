import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { leadPath, LeadLocationState } from '../routes/paths.js';

/** Opens a lead at `/leads/:id` (REV-76); closing it returns to the page it was opened from */
export const useOpenLead = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (leadId: string) => navigate(leadPath(leadId), { state: { from: pathname } satisfies LeadLocationState }),
    [navigate, pathname],
  );
};
