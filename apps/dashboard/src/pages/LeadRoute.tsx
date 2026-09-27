import React, { useEffect } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLeadsQuery } from '../hooks/useLeads.js';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { SideBySideInspectorModal } from '../components/SideBySideInspectorModal.js';
import { openedInApp, ROUTES } from '../routes/paths.js';

/** Whether the list is narrowed by a filter that could hide the requested lead */
const hasListFilters = (s: { searchQuery: string; selectedNiche: string; selectedComplexity: string }) =>
  Boolean(s.searchQuery) || s.selectedNiche !== 'ALL' || s.selectedComplexity !== 'ALL';

/**
 * `/leads/:id` (REV-76): opens the lead inspector for the lead in the URL, so a lead can be linked to and
 * survives a reload. Closing the inspector steps back to the page the lead was opened from, or replaces a
 * direct link with All leads, so the back button never reopens a closed lead.
 */
export const LeadRoute: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useLeadsQuery();
  const filtersActive = useLeadFilterStore(hasListFilters);
  const resetFilters = useLeadFilterStore((s) => s.resetFilters);
  const openModal = useHitlModalStore((s) => s.openModal);
  const closeModal = useHitlModalStore((s) => s.closeModal);

  const lead = data?.leads.find((l) => l.id === id);
  const leadId = lead?.id;
  const auditId = lead?.auditId;

  useEffect(() => {
    if (!leadId) return;
    openModal(leadId, auditId || `audit-${leadId}`);
    // Leaving the route (back button, rail) closes the inspector
    return () => closeModal();
  }, [leadId, auditId, openModal, closeModal]);

  // The inspector reads the lead from the list; a lead hidden by the search or a filter needs them cleared
  const hiddenByFilters = Boolean(data) && !lead && filtersActive;
  useEffect(() => {
    if (hiddenByFilters) resetFilters();
  }, [hiddenByFilters, resetFilters]);

  if (!lead && !isLoading && !hiddenByFilters && (data || isError)) {
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

  return <SideBySideInspectorModal onClose={handleClose} />;
};
