import React from 'react';
import { Box, Chip, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { LeadStatus } from '@revamp/shared-types';
import { ILeadItem } from '../api/client.js';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useTranslation } from 'react-i18next';
import type { Translation } from '../i18n/locales/en.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { formatDate } from '../i18n/languages.js';
import { NICHE_EMOJI, isDashboardNiche } from '../i18n/niches.js';

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

const STATUS_COLORS: Record<keyof Translation['statuses'], ChipColor> = {
  QUEUED: 'default',
  AUDITING: 'info',
  AUDITED: 'info',
  GENERATING: 'primary',
  NEEDS_APPROVAL: 'warning',
  APPROVED: 'primary',
  SCHEDULED: 'primary',
  DISPATCHED: 'info',
  SENT: 'info',
  OPENED: 'secondary',
  CLICKED: 'success',
  ENGAGED: 'secondary',
  REPLIED: 'success',
  REJECTED: 'error',
};

function isLabelledStatus(status: LeadStatus): status is keyof typeof STATUS_COLORS {
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
          sx={{ fontWeight: 500, fontSize: '0.75rem' }}
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
        return (
          <Chip
            label={conf.label}
            size="small"
            color={conf.color}
            sx={{ fontWeight: 600, fontSize: '0.75rem' }}
          />
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
        return (
          <Chip
            label={`${score}/100`}
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: '0.75rem',
              backgroundColor:
                score >= 70 ? 'success.light' : score >= 40 ? 'warning.light' : 'error.light',
              color: score >= 70 ? 'success.main' : score >= 40 ? 'warning.main' : 'error.main',
            }}
          />
        );
      },
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
            {isNeedsApproval ? (
              <Button
                variant="contained"
                color="warning"
                size="small"
                startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                onClick={() => openModal(params.row.id, params.row.auditId || `audit-${params.row.id}`)}
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  py: 0.4,
                  px: 1.2,
                  color: '#000000',
                }}
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
                sx={{ fontSize: '0.75rem', py: 0.4, px: 1.2 }}
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
    <Box
      sx={{
        width: '100%',
        backgroundColor: 'background.paper',
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}
    >
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
        sx={{
          border: 'none',
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: 'background.default',
            borderBottom: '1px solid',
            borderColor: 'divider',
            fontWeight: 700,
            fontSize: '0.85rem',
          },
          '& .MuiDataGrid-row': {
            borderBottom: '1px solid',
            borderColor: 'divider',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          },
          '& .MuiDataGrid-cell': {
            display: 'flex',
            alignItems: 'center',
          },
        }}
      />
    </Box>
  );
};
