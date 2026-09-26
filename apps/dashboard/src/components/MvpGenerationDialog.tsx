import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LlmProviderId } from '@revamp/shared-types';
import { LlmModelSelect } from './LlmModelSelect.js';
import { useLlmProvidersQuery } from '../hooks/useLeads.js';
import { useLlmChoiceStore } from '../store/useLlmChoiceStore.js';
import { effectiveLlmChoice } from '../utils/llmChoice.js';

export interface MvpGenerationChoice {
  provider?: LlmProviderId;
  model?: string;
}

interface MvpGenerationDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmIcon: React.ReactNode;
  onClose: () => void;
  onConfirm: (choice: MvpGenerationChoice) => void;
}

/**
 * Confirmation for Generate / Regenerate MVP with the provider/model picker (REV-32)
 */
export const MvpGenerationDialog: React.FC<MvpGenerationDialogProps> = ({
  open,
  title,
  body,
  confirmLabel,
  confirmIcon,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const choice = useLlmChoiceStore();
  const { data } = useLlmProvidersQuery(open);

  return (
    // Kanban cards open the inspector on click; keep clicks inside the dialog from reaching them
    <Dialog open={open} onClose={onClose} onClick={(event) => event.stopPropagation()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{body}</DialogContentText>
        {open && <LlmModelSelect />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          {t('regenerate.cancel')}
        </Button>
        <Button onClick={() => onConfirm(effectiveLlmChoice(choice, data))} variant="contained" startIcon={confirmIcon}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
