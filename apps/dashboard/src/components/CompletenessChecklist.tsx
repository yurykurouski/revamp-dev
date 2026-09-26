import React from 'react';
import {
  Alert,
  Box,
  Card,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import type { IMvpCompletenessReport } from '@revamp/shared-types';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { formatDate } from '../i18n/languages.js';
import { COMPLETENESS_STATUS_COLOR, criticalIssueFields, sortCompletenessChecks } from '../utils/completeness.js';

interface CompletenessChecklistProps {
  report?: IMvpCompletenessReport | null;
}

/**
 * The MVP compared with the original site's key business data (REV-36):
 * field → original value → MVP value → status.
 */
export const CompletenessChecklist: React.FC<CompletenessChecklistProps> = ({ report }) => {
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.language);

  const header = (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {t('completeness.title')}
      </Typography>
      {report?.status === 'verified' && report.score !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          {t('completeness.score', { score: report.score })}
        </Typography>
      )}
    </Box>
  );

  if (!report) {
    return (
      <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        {header}
        <Typography variant="caption" color="text.secondary">
          {t('completeness.notChecked')}
        </Typography>
      </Card>
    );
  }

  if (report.status === 'unverified') {
    return (
      <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        {header}
        <Alert severity="warning" variant="outlined">
          <strong>{t('completeness.unverified')}</strong>. {t('completeness.unverifiedBody')}
        </Alert>
      </Card>
    );
  }

  const criticalFields = criticalIssueFields(report);
  const fieldLabel = (field: string) => t(`completeness.fields.${field}` as 'completeness.fields.phone');

  return (
    <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, flexShrink: 0 }}>
      {header}

      {criticalFields.length > 0 ? (
        <Alert severity="error">
          {t('completeness.criticalWarning', { fields: criticalFields.map(fieldLabel).join(', ') })}
        </Alert>
      ) : (
        <Alert severity="success" variant="outlined">
          {t('completeness.allCriticalPresent')}
        </Alert>
      )}

      <Table size="small" sx={{ '& td, & th': { px: 1, py: 0.6, fontSize: '0.75rem' } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>{t('completeness.field')}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t('completeness.original')}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t('completeness.mvp')}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t('completeness.status')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortCompletenessChecks(report.checks).map((check, idx) => (
            <TableRow key={`${check.field}-${check.status}-${idx}`}>
              <TableCell>
                <Box sx={{ fontWeight: 600 }}>{fieldLabel(check.field)}</Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                  {t(`completeness.tiers.${check.tier}`)}
                </Typography>
              </TableCell>
              <TableCell sx={{ wordBreak: 'break-word', maxWidth: 160 }}>{check.originalValue || '—'}</TableCell>
              <TableCell sx={{ wordBreak: 'break-word', maxWidth: 160 }}>{check.mvpValue || '—'}</TableCell>
              <TableCell>
                <Tooltip title={check.note || ''}>
                  <Chip
                    label={t(`completeness.statuses.${check.status}`)}
                    color={COMPLETENESS_STATUS_COLOR[check.status]}
                    size="small"
                    variant={check.status === 'present' ? 'outlined' : 'filled'}
                    sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }}
                  />
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Typography variant="caption" color="text.secondary">
        {t('completeness.checkedAt', {
          date: formatDate(report.checkedAt, language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        })}
      </Typography>
    </Card>
  );
};
