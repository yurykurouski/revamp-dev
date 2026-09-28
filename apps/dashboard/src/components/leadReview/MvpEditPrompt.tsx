import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Tooltip, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { MVP_EDIT_INSTRUCTION_MAX } from '@revamp/validation';
import type { MvpEditState } from './MvpDesignTools.js';

/** The API's minimum, so the button only sends what it accepts */
const MIN_INSTRUCTION_LENGTH = 3;

interface MvpEditPromptProps {
  edit: MvpEditState;
  disabled: boolean;
  /** Why the prompt is disabled, shown as its tooltip */
  disabledReason: string;
}

/**
 * A free-text change to the MVP in the operator's own words (REV-85), part of the Design tools panel.
 * The workers' LLM applies it to the copy, palette and/or layout without inventing facts; the answer
 * tells the operator what changed, or why nothing did.
 */
export const MvpEditPrompt: React.FC<MvpEditPromptProps> = ({ edit, disabled, disabledReason }) => {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState('');
  const trimmed = instruction.trim();
  const canSubmit = !disabled && !edit.isPending && trimmed.length >= MIN_INSTRUCTION_LENGTH;

  const submit = () => {
    if (!canSubmit) return;
    edit.submit(trimmed, () => setInstruction(''));
  };

  const form = (
    <Box
      component="form"
      data-testid="mvp-edit-prompt"
      aria-disabled={disabled || undefined}
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        submit();
      }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        // As wide as the pickers make the panel, never wider: a long answer wraps instead of widening it
        width: 0,
        minWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <AutoAwesomeIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography component="label" htmlFor="mvp-edit-instruction" variant="caption" sx={{ fontWeight: 700 }}>
          {t('mvpEdit.label')}
        </Typography>
      </Box>
      <TextField
        id="mvp-edit-instruction"
        size="small"
        multiline
        minRows={2}
        maxRows={5}
        fullWidth
        value={instruction}
        disabled={disabled || edit.isPending}
        placeholder={t('mvpEdit.placeholder')}
        onChange={(event) => setInstruction(event.target.value.slice(0, MVP_EDIT_INSTRUCTION_MAX))}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter starts a new line
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        helperText={t('mvpEdit.hint', { count: instruction.length, max: MVP_EDIT_INSTRUCTION_MAX })}
        inputProps={{ maxLength: MVP_EDIT_INSTRUCTION_MAX }}
      />
      <Typography variant="caption" color="text.secondary">
        {t('mvpEdit.grounding')}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="submit"
          size="small"
          variant="contained"
          disabled={!canSubmit}
          startIcon={edit.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeIcon sx={{ fontSize: 16 }} />}
        >
          {edit.isPending ? t('mvpEdit.applying') : t('mvpEdit.apply')}
        </Button>
      </Box>
      {edit.outcome && (
        <Alert
          severity={edit.outcome.applied ? 'success' : 'info'}
          onClose={edit.clearOutcome}
          data-testid="mvp-edit-outcome"
          sx={{ py: 0 }}
        >
          {edit.outcome.applied ? t('mvpEdit.applied', { summary: edit.outcome.summary }) : t('mvpEdit.unchanged', { summary: edit.outcome.summary })}
        </Alert>
      )}
      {edit.error && (
        <Alert severity="error" onClose={edit.clearError} data-testid="mvp-edit-error" sx={{ py: 0 }}>
          {t('mvpEdit.failed', { message: edit.error })}
        </Alert>
      )}
    </Box>
  );

  return disabled ? (
    <Tooltip title={disabledReason}>
      <span style={{ display: 'block' }}>{form}</span>
    </Tooltip>
  ) : (
    form
  );
};
