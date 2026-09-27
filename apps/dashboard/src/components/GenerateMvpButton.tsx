import React, { useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { ILeadItem } from '../api/client.js';
import { useGenerateMvpMutation } from '../hooks/useLeads.js';
import { MvpGenerationChoice, MvpGenerationDialog } from './MvpGenerationDialog.js';

interface GenerateMvpButtonProps {
  lead: Pick<ILeadItem, 'id' | 'auditId' | 'businessName'>;
}

/**
 * "Generate MVP" for an audited lead, with the provider/model picker (REV-32). The generated MVP
 * waits for operator review; nothing is sent from here.
 */
export const GenerateMvpButton: React.FC<GenerateMvpButtonProps> = ({ lead }) => {
  const { t } = useTranslation();
  const generateMvpMutation = useGenerateMvpMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = generateMvpMutation.isPending && generateMvpMutation.variables?.leadId === lead.id;

  const handleConfirm = (choice: MvpGenerationChoice) => {
    setDialogOpen(false);
    generateMvpMutation.mutate(
      { auditId: lead.auditId || lead.id, leadId: lead.id, ...choice },
      { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
    );
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        size="small"
        disabled={isPending}
        startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
        onClick={(event) => {
          // Kanban cards open the inspector on click; keep this action separate
          event.stopPropagation();
          setDialogOpen(true);
        }}
      >
        {t('kanban.generateMvp')}
      </Button>

      <MvpGenerationDialog
        open={dialogOpen}
        title={t('generate.confirmTitle')}
        body={t('generate.confirmBody', { name: lead.businessName })}
        confirmLabel={t('generate.confirm')}
        confirmIcon={<AutoAwesomeIcon />}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {t('generate.failed', { message: error ?? '' })}
        </Alert>
      </Snackbar>
    </>
  );
};
