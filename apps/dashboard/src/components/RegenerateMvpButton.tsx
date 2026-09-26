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
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { ILeadItem } from '../api/client.js';
import { canRegenerateMvp, useGenerateMvpMutation } from '../hooks/useLeads.js';

interface RegenerateMvpButtonProps {
  lead: Pick<ILeadItem, 'id' | 'auditId' | 'status' | 'businessName'>;
  /** `icon` for the compact Kanban card, `button` for the inspector toolbar */
  variant?: 'icon' | 'button';
}

/**
 * "Regenerate MVP" with a confirmation step (REV-31). Re-runs copy generation and deploy for a lead
 * that already has an MVP; the lead returns to review, and no outreach is ever sent from here.
 */
export const RegenerateMvpButton: React.FC<RegenerateMvpButtonProps> = ({ lead, variant = 'icon' }) => {
  const { t } = useTranslation();
  const generateMvpMutation = useGenerateMvpMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRegenerateMvp(lead.status)) return null;

  const isPending = generateMvpMutation.isPending && generateMvpMutation.variables?.leadId === lead.id;

  const handleConfirm = () => {
    setConfirmOpen(false);
    generateMvpMutation.mutate(
      { auditId: lead.auditId || lead.id, leadId: lead.id, forceRegenerate: true },
      { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
    );
  };

  const openConfirm = (event: React.MouseEvent) => {
    // Kanban cards open the inspector on click; keep this action separate
    event.stopPropagation();
    setConfirmOpen(true);
  };

  return (
    <>
      {variant === 'icon' ? (
        <Tooltip title={t('regenerate.action')}>
          <span>
            <IconButton
              size="small"
              aria-label={t('regenerate.action')}
              disabled={isPending}
              onClick={openConfirm}
              sx={{ p: 0.5 }}
            >
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
          disabled={isPending}
          onClick={openConfirm}
          sx={{ fontWeight: 600 }}
        >
          {t('regenerate.action')}
        </Button>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onClick={(event) => event.stopPropagation()}
        maxWidth="xs"
      >
        <DialogTitle sx={{ fontWeight: 700 }}>{t('regenerate.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('regenerate.confirmBody', { name: lead.businessName })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">
            {t('regenerate.cancel')}
          </Button>
          <Button onClick={handleConfirm} variant="contained" startIcon={<RefreshIcon />}>
            {t('regenerate.confirm')}
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
          {t('regenerate.failed', { message: error ?? '' })}
        </Alert>
      </Snackbar>
    </>
  );
};
