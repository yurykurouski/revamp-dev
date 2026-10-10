import React, { useRef } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SecurityIcon from '@mui/icons-material/Security';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router-dom';
import type { ILeadItem } from '../api/client.js';
import { mvpPreviewVersion, useAuditQuery, useIsMvpGenerationPending, useMvpQuery, withPreviewVersion } from '../hooks/useLeads.js';
import { useListedLead } from '../hooks/useListedLead.js';
import { MvpPreviewFrame } from '../components/MvpPreviewFrame.js';
import { MvpDesignTools, useMvpDesignTools } from '../components/leadReview/MvpDesignTools.js';
import { ROUTES, leadPath } from '../routes/paths.js';

/** A full-window page with a message, for a lead that is missing or has nothing to preview */
const Notice: React.FC<{ severity: 'error' | 'info'; message: string; to: string; action: string }> = ({
  severity,
  message,
  to,
  action,
}) => (
  <Box sx={{ minHeight: '100vh', p: 3, backgroundColor: 'background.default' }}>
    <Alert
      severity={severity}
      action={
        <Button component={RouterLink} to={to} color="inherit" size="small">
          {action}
        </Button>
      }
    >
      {message}
    </Alert>
  </Box>
);

const LeadMvpPreview: React.FC<{ lead: ILeadItem }> = ({ lead }) => {
  const { t } = useTranslation();
  const { data: audit } = useAuditQuery(lead.auditId || lead.id);
  const { data: mvp, isLoading: isMvpLoading } = useMvpQuery(lead.id);
  const isGenerationRequestPending = useIsMvpGenerationPending(lead.id);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tools = useMvpDesignTools({ lead, audit, mvp });

  // Versioned by the generation or free-text change time, as in the Prototype step (REV-31, REV-85)
  const previewUrl = withPreviewVersion(mvp?.fullPreviewUrl || lead.previewUrl || '', mvpPreviewVersion(lead, mvp));
  const isPreviewBusy = isGenerationRequestPending || lead.status === 'GENERATING';

  if (!previewUrl && !isMvpLoading) {
    return (
      <Notice severity="info" message={t('mvpPreviewPage.noMvp')} to={leadPath(lead.id)} action={t('mvpPreviewPage.backToReview')} />
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'background.default' }}>
      <Box
        component="header"
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          minWidth: 0,
        }}
      >
        <Button component={RouterLink} to={leadPath(lead.id)} size="small" startIcon={<ArrowBackIcon />}>
          {t('mvpPreviewPage.backToReview')}
        </Button>
        <Typography component="h1" variant="subtitle2" noWrap sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
          {lead.businessName}
        </Typography>
        <Chip
          icon={<SecurityIcon sx={{ fontSize: 14 }} />}
          label={t('inspector.sandbox')}
          size="small"
          color="success"
          variant="outlined"
          sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
        />
        <Tooltip title={t('mvpPreviewPage.openPublished')}>
          <span>
            <IconButton
              size="small"
              href={previewUrl}
              disabled={!previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              color="primary"
              aria-label={t('mvpPreviewPage.openPublished')}
            >
              <OpenInNewIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box
        data-testid="mvp-preview-viewport"
        sx={{
          flexGrow: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          // The MVP is a light page of its own, whatever the dashboard theme
          backgroundColor: 'common.white',
        }}
      >
        {previewUrl ? (
          <MvpPreviewFrame
            ref={iframeRef}
            previewUrl={previewUrl}
            busy={isPreviewBusy || tools.pending !== null}
          />
        ) : (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        )}
        <MvpDesignTools tools={tools} lead={lead} locked={!previewUrl || isPreviewBusy} />
      </Box>
    </Box>
  );
};

/**
 * `/leads/:id/preview` (REV-91): the lead's MVP full-window in the sandboxed iframe (AGENTS.md §3.2.3),
 * with the same Design tools as the Prototype step (REV-140), so the operator can change the page at
 * full size. Outside the app shell; the published page itself is linked from the header.
 */
export const MvpPreviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { lead, missing, isError } = useListedLead(id);

  if (missing) {
    return (
      <Notice
        severity={isError ? 'error' : 'info'}
        message={isError ? t('leadsPage.loadFailed') : t('leadRoute.notFound')}
        to={ROUTES.leads}
        action={t('leadRoute.close')}
      />
    );
  }

  if (!lead) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'background.default' }}>
        <CircularProgress />
      </Box>
    );
  }

  return <LeadMvpPreview key={lead.id} lead={lead} />;
};
