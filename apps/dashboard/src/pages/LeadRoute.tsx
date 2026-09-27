import React from 'react';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useListedLead } from '../hooks/useListedLead.js';
import { LeadReview } from '../components/leadReview/LeadReview.js';
import { MAIN_FILL_HEIGHT } from '../components/Layout.js';
import { openedInApp, ROUTES } from '../routes/paths.js';

/**
 * `/leads/:id` (REV-76): the review of the lead in the URL (REV-77), so a lead can be linked to and
 * survives a reload. Closing it steps back to the page the lead was opened from, or replaces a direct
 * link with All leads, so the back button never reopens a closed lead.
 */
export const LeadRoute: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  // The review reads the lead from the list; a lead hidden by the search or a filter needs them cleared
  const { lead, missing, isError } = useListedLead(id);

  if (missing) {
    return (
      <Box sx={{ mb: 2 }}>
        <Alert
          severity={isError ? 'error' : 'info'}
          action={
            <Button component={RouterLink} to={ROUTES.leads} color="inherit" size="small">
              {t('leadRoute.close')}
            </Button>
          }
        >
          {isError ? t('leadsPage.loadFailed') : t('leadRoute.notFound')}
        </Alert>
      </Box>
    );
  }

  const handleClose = () => {
    if (openedInApp(location.state)) navigate(-1);
    else navigate(ROUTES.leads, { replace: true });
  };

  if (!lead) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ height: { lg: MAIN_FILL_HEIGHT }, minHeight: { lg: 560 } }}>
      <LeadReview key={lead.id} lead={lead} onClose={handleClose} />
    </Box>
  );
};
