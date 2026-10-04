import React from 'react';
import { Box, Card, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveIcon from '@mui/icons-material/Remove';
import { useTranslation } from 'react-i18next';
import type { IAuditDetail, IMvpProjectDetail } from '../api/client.js';
import { CheckState, seoStandardsView } from '../utils/seoStandards.js';

interface SeoStandardsCardProps {
  audit?: Pick<IAuditDetail, 'standardsChecks'> | null;
  mvp?: Pick<IMvpProjectDetail, 'standards'> | null;
}

const STATE_ICON: Record<CheckState, { icon: React.ReactElement; label: 'seo.passed' | 'seo.failed' | 'seo.unknown' | 'seo.hostingDependent' }> = {
  passed: { icon: <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />, label: 'seo.passed' },
  // Ready, but served over HTTPS only where the MVP is deployed
  hosting: { icon: <CheckCircleIcon sx={{ fontSize: 18, color: 'warning.main' }} />, label: 'seo.hostingDependent' },
  failed: { icon: <CancelIcon sx={{ fontSize: 18, color: 'error.main' }} />, label: 'seo.failed' },
  unknown: { icon: <RemoveIcon sx={{ fontSize: 18, color: 'text.disabled' }} />, label: 'seo.unknown' },
};

const StateCell: React.FC<{ state?: CheckState; testId: string }> = ({ state, testId }) => {
  const { t } = useTranslation();
  const shown = STATE_ICON[state ?? 'unknown'];
  return (
    <TableCell align="center" sx={{ py: 0.5 }} data-testid={testId} data-state={state ?? 'unknown'}>
      <Tooltip title={t(shown.label)}>
        <Box component="span" role="img" aria-label={t(shown.label)} sx={{ display: 'inline-flex' }}>
          {shown.icon}
        </Box>
      </Tooltip>
    </TableCell>
  );
};

/**
 * The original site's SEO and web standards checks next to the published MVP's (REV-118): one row per check with its
 * points and what it does for the site, and the two scores when both pages were read in full. Everything shown was
 * read by code from the pages; a check the audit did not read shows as not checked.
 */
export const SeoStandardsCard: React.FC<SeoStandardsCardProps> = ({ audit, mvp }) => {
  const { t } = useTranslation();
  const view = seoStandardsView(audit, mvp);
  const checkLabel = (check: string) => t(`seo.checks.${check}` as 'seo.checks.https');

  return (
    <Card data-testid="seo-standards" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25, flexShrink: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t('seo.title')}
        </Typography>
        {view && (view.originalScore !== undefined || view.mvpScore !== undefined) && (
          <Box data-testid="seo-scores" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }} data-testid="seo-original-score">
              {view.originalScore !== undefined ? t('seo.score', { score: view.originalScore }) : '—'}
            </Typography>
            {view.mvpScore !== undefined && (
              <>
                <ArrowForwardIcon aria-hidden sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" color="primary.main" sx={{ fontWeight: 800 }} data-testid="seo-mvp-score">
                  {t('seo.score', { score: view.mvpScore })}
                </Typography>
              </>
            )}
          </Box>
        )}
      </Box>

      {!view ? (
        <Typography variant="caption" color="text.secondary">
          {t('seo.notMeasured')}
        </Typography>
      ) : (
        <>
          <Table size="small" aria-label={t('seo.title')}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ py: 0.5 }}>{t('seo.check')}</TableCell>
                <TableCell align="center" sx={{ py: 0.5 }}>
                  {t('seo.original')}
                </TableCell>
                {view.mvpScore !== undefined && (
                  <TableCell align="center" sx={{ py: 0.5 }}>
                    {t('seo.mvp')}
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {view.rows.map((row) => (
                <TableRow key={row.check} data-testid={`seo-row-${row.check}`}>
                  <TableCell sx={{ py: 0.5 }}>
                    <Tooltip title={t(`seo.hints.${row.check}` as 'seo.hints.https')} placement="left">
                      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          {checkLabel(row.check)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                          {t('seo.points', { points: row.points })}
                        </Typography>
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <StateCell state={row.original} testId={`seo-original-${row.check}`} />
                  {view.mvpScore !== undefined && <StateCell state={row.mvp} testId={`seo-mvp-${row.check}`} />}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!view.originalMeasured && (
            <Typography variant="caption" color="text.secondary">
              {t('seo.notMeasured')}
            </Typography>
          )}
          {view.originalMeasured && view.originalScore === undefined && (
            <Typography variant="caption" color="text.secondary" data-testid="seo-older-audit">
              {t('seo.olderAudit')}
            </Typography>
          )}
          {view.mvpScore === undefined ? (
            <Typography variant="caption" color="text.secondary">
              {t('seo.noMvp')}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t('seo.httpsNote')}
            </Typography>
          )}
        </>
      )}
    </Card>
  );
};
