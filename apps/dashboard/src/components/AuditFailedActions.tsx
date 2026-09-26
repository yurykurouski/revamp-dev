import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Snackbar,
  Tooltip,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import BlockIcon from '@mui/icons-material/Block';
import { useTranslation } from 'react-i18next';
import { ILeadItem } from '../api/client.js';
import { useRejectLeadMutation, useRetryAuditMutation } from '../hooks/useLeads.js';
import { auditFailureRejectReason } from '../utils/auditFailure.js';

interface AuditFailedActionsProps {
  lead: Pick<ILeadItem, 'id' | 'businessName' | 'auditError'>;
}

/**
 * Retry / Reject for a lead whose audit failed (REV-44). Retrying re-queues the audit; rejecting
 * archives the lead as REJECTED. Nothing is sent from here.
 */
export const AuditFailedActions: React.FC<AuditFailedActionsProps> = ({ lead }) => {
  const { t } = useTranslation();
  const retryAuditMutation = useRetryAuditMutation();
  const rejectLeadMutation = useRejectLeadMutation();
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending =
    (retryAuditMutation.isPending && retryAuditMutation.variables?.leadId === lead.id) ||
    (rejectLeadMutation.isPending && rejectLeadMutation.variables?.leadId === lead.id);
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  return (
    <>
      <Button
        variant="outlined"
        color="primary"
        size="small"
        disabled={isPending}
        startIcon={<ReplayIcon sx={{ fontSize: 14 }} />}
        onClick={(event) => {
          // Kanban cards open the inspector on click; keep this action separate
          event.stopPropagation();
          retryAuditMutation.mutate({ leadId: lead.id }, { onError });
        }}
        sx={{ fontSize: '0.72rem', fontWeight: 700, py: 0.4, px: 1.2 }}
      >
        {t('auditFailure.retry')}
      </Button>

      <Tooltip title={t('auditFailure.reject')}>
        <span>
          <IconButton
            size="small"
            color="error"
            aria-label={t('auditFailure.reject')}
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              setConfirmRejectOpen(true);
            }}
            sx={{ p: 0.5 }}
          >
            <BlockIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>

      <Dialog open={confirmRejectOpen} onClose={() => setConfirmRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('auditFailure.rejectTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('auditFailure.rejectBody', { name: lead.businessName })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRejectOpen(false)}>{t('auditFailure.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setConfirmRejectOpen(false);
              rejectLeadMutation.mutate(
                { leadId: lead.id, reason: auditFailureRejectReason(lead.auditError) },
                { onError },
              );
            }}
          >
            {t('auditFailure.confirmReject')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 2 }}>
          {t('auditFailure.failed', { message: error ?? '' })}
        </Alert>
      </Snackbar>
    </>
  );
};
