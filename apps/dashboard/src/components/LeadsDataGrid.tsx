import React from 'react';
import { Box, Chip, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { LeadStatus } from '@revamp/shared-types';
import { ILeadItem } from '../api/client.js';
import { SiteComplexityChip } from './SiteComplexityChip.js';
import { ScoreChip } from './ScoreChip.js';
import { AuditFailedActions } from './AuditFailedActions.js';
import { isAuditFailed } from '../utils/auditFailure.js';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { formatDate } from '../i18n/languages.js';
import { NICHE_EMOJI, isDashboardNiche } from '../i18n/niches.js';

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

// Every status in the shared list has a chip color and a translated label (REV-62)
const STATUS_COLORS: Record<LeadStatus, ChipColor> = {
  QUEUED: 'default',
  AUDITING: 'info',
  AUDIT_FAILED: 'error',
  AUDITED: 'info',
  GENERATING: 'primary',
  NEEDS_APPROVAL: 'warning',
  SCHEDULED: 'primary',
  SENT: 'info',
  OPENED: 'secondary',
  CLICKED: 'success',
  ENGAGED: 'secondary',
  REJECTED: 'error',
  UNSUBSCRIBED: 'error',
};

// A status the dashboard does not know (e.g. from a newer API) is shown as is
function isLabelledStatus(status: string): status is LeadStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, status);
}

interface LeadsDataGridProps {
  leads: ILeadItem[];
  isLoading?: boolean;
}

export const LeadsDataGrid: React.FC<LeadsDataGridProps> = ({ leads, isLoading }) => {
  const { openModal } = useHitlModalStore();
  const { page, pageSize, setPage, setPageSize } = useLeadFilterStore();
  const { t } = useTranslation();
  const { language } = useLanguageStore();

  const columns: GridColDef<ILeadItem>[] = [
    {
      field: 'businessName',
      headerName: t('grid.company'),
      flex: 1.5,
      minWidth: 240,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}>
            {params.row.businessName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {params.row.domain}
            </Typography>
            <Tooltip title={t('grid.openOriginal')}>
              <IconButton
                size="small"
                href={params.row.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ p: 0.2 }}
              >
                <OpenInNewIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      ),
    },
    {
      field: 'niche',
      headerName: t('grid.niche'),
      width: 160,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => (
        <Chip
          label={
            isDashboardNiche(params.row.niche)
              ? `${NICHE_EMOJI[params.row.niche]} ${t(`niches.${params.row.niche}`)}`
              : params.row.niche
          }
          size="small"
          variant="outlined"
          sx={{ fontWeight: 500 }}
        />
      ),
    },
    {
      field: 'status',
      headerName: t('grid.status'),
      width: 170,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => {
        const status = params.row.status;
        const conf = isLabelledStatus(status)
          ? { label: t(`statuses.${status}`), color: STATUS_COLORS[status] }
          : { label: status, color: 'default' as const };
        const chip = (
          <Chip label={conf.label} size="small" color={conf.color} />
        );
        // REV-44: the reason a failed audit failed is in the tooltip
        return isAuditFailed(params.row) && params.row.auditError ? (
          <Tooltip title={params.row.auditError}>{chip}</Tooltip>
        ) : (
          chip
        );
      },
    },
    {
      field: 'totalScore',
      headerName: t('grid.score'),
      width: 110,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => {
        const score = params.row.totalScore;
        if (score === undefined) {
          return (
            <Typography variant="caption" color="text.secondary">
              —
            </Typography>
          );
        }
        return <ScoreChip score={score} />;
      },
    },
    {
      field: 'siteComplexity',
      headerName: t('siteComplexity.label'),
      width: 160,
      renderCell: (params: GridRenderCellParams<ILeadItem>) =>
        params.row.siteComplexity && params.row.siteComplexity !== 'UNKNOWN' ? (
          <SiteComplexityChip complexity={params.row.siteComplexity} />
        ) : (
          <Typography variant="caption" color="text.secondary">
            —
          </Typography>
        ),
    },
    {
      field: 'city',
      headerName: t('grid.city'),
      width: 140,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => (
        <Typography variant="body2" color="text.secondary">
          {params.row.city || '—'}
        </Typography>
      ),
    },
    {
      field: 'createdAt',
      headerName: t('grid.dateAdded'),
      width: 140,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => (
        <Typography variant="body2" color="text.secondary">
          {formatDate(params.row.createdAt, language, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: t('grid.actions'),
      width: 180,
      sortable: false,
      renderCell: (params: GridRenderCellParams<ILeadItem>) => {
        const isNeedsApproval = params.row.status === 'NEEDS_APPROVAL';
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isAuditFailed(params.row) ? (
              <AuditFailedActions lead={params.row} />
            ) : isNeedsApproval ? (
              <Button
                variant="contained"
                color="warning"
                size="small"
                startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                onClick={() => openModal(params.row.id, params.row.auditId || `audit-${params.row.id}`)}
              >
                {t('grid.hitlReview')}
              </Button>
            ) : params.row.previewUrl ? (
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<VisibilityIcon sx={{ fontSize: 14 }} />}
                href={params.row.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('grid.mvpDemo')}
              </Button>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t('grid.processing')}
              </Typography>
            )}
          </Box>
        );
      },
    },
  ];

  return (
    <Box sx={{ width: '100%' }}>
      <DataGrid
        rows={leads}
        columns={columns}
        loading={isLoading}
        paginationModel={{ page, pageSize }}
        onPaginationModelChange={(model) => {
          setPage(model.page);
          setPageSize(model.pageSize);
        }}
        pageSizeOptions={[5, 10, 25]}
        disableRowSelectionOnClick
        autoHeight
      />
    </Box>
  );
};
