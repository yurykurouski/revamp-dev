import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { useTranslation } from 'react-i18next';
import { IMvpProjectDetail } from '../api/client.js';
import { summarizeMvpSource } from '../utils/llmChoice.js';

/**
 * Which provider and model wrote the MVP copy, and the operator's pick when it fell back (REV-32)
 */
export const MvpSourceChip: React.FC<{ mvp: IMvpProjectDetail | null | undefined }> = ({ mvp }) => {
  const { t } = useTranslation();
  const summary = summarizeMvpSource(mvp);
  if (!summary) return null;

  const actual = summary.actual === 'deterministic' ? t('llm.deterministic') : summary.actual;
  const tooltip = [t('llm.generatedBy', { name: actual }), summary.requested && t('llm.requested', { name: summary.requested })]
    .filter(Boolean)
    .join(' · ');

  return (
    <Tooltip title={tooltip}>
      <Chip
        icon={<PsychologyIcon sx={{ fontSize: 14 }} />}
        label={actual}
        size="small"
        color={summary.requested ? 'warning' : 'default'}
        variant="outlined"
        sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600, maxWidth: 240 }}
      />
    </Tooltip>
  );
};
