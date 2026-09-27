import React from 'react';
import {
  Box,
  Card,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SendIcon from '@mui/icons-material/Send';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import BlockIcon from '@mui/icons-material/Block';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import { ILeadItem } from '../api/client.js';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { withPreviewVersion } from '../hooks/useLeads.js';
import { RegenerateMvpButton } from './RegenerateMvpButton.js';
import { GenerateMvpButton } from './GenerateMvpButton.js';
import { SiteComplexityChip } from './SiteComplexityChip.js';
import { ScoreChip } from './ScoreChip.js';
import { RADIUS, type Stage } from '../theme/theme.js';
import { leadStage } from '../utils/leadStages.js';
import { AuditFailedActions } from './AuditFailedActions.js';
import { isAuditFailed } from '../utils/auditFailure.js';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { formatDate } from '../i18n/languages.js';
import { isDashboardNiche } from '../i18n/niches.js';
import { criticalIssueFields } from '../utils/completeness.js';

interface KanbanColumnConfig {
  id: Stage;
  icon: React.ReactNode;
}

// One column per pipeline stage; the statuses in each come from LEAD_STATUS_STAGE (REV-62)
const COLUMNS: KanbanColumnConfig[] = [
  { id: 'queued', icon: <PendingActionsIcon sx={{ fontSize: 18 }} /> },
  { id: 'needs_approval', icon: <AutoAwesomeIcon sx={{ fontSize: 18 }} /> },
  { id: 'scheduled', icon: <ScheduleIcon sx={{ fontSize: 18 }} /> },
  { id: 'sent', icon: <SendIcon sx={{ fontSize: 18 }} /> },
  { id: 'opened', icon: <MarkEmailReadIcon sx={{ fontSize: 18 }} /> },
  { id: 'clicked', icon: <TouchAppIcon sx={{ fontSize: 18 }} /> },
  { id: 'engaged', icon: <WhatshotIcon sx={{ fontSize: 18 }} /> },
  { id: 'rejected', icon: <BlockIcon sx={{ fontSize: 18 }} /> },
];

interface KanbanBoardProps {
  leads: ILeadItem[];
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ leads }) => {
  const { openModal } = useHitlModalStore();
  const { t } = useTranslation();
  const { language } = useLanguageStore();

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        overflowX: 'auto',
        pb: 3,
        pt: 1,
        minHeight: 'calc(100vh - 280px)',
        alignItems: 'flex-start',
      }}
    >
      {COLUMNS.map((col) => {
        const columnLeads = leads.filter((l) =>
          leadStage(l.status) === col.id,
        );

        return (
          <Box
            key={col.id}
            sx={{
              width: 300,
              minWidth: 300,
              backgroundColor: 'surface.sunken',
              borderRadius: `${RADIUS.lg}px`,
              p: 1.25,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              border: '1px solid',
              borderColor: 'divider',
              // The stage color runs along the top edge of the column
              borderTop: '2px solid',
              borderTopColor: `stage.${col.id}`,
            }}
          >
            {/* Column Header */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 0.5,
                pt: 0.25,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ color: `stage.${col.id}`, display: 'flex', alignItems: 'center' }}>
                  {col.icon}
                </Box>
                <Typography variant="subtitle2">
                  {t(`kanban.columns.${col.id}`)}
                </Typography>
              </Box>
              <Chip
                label={columnLeads.length}
                size="small"
                sx={(theme) => ({
                  minWidth: 28,
                  backgroundColor: alpha(theme.palette.stage[col.id], theme.palette.mode === 'dark' ? 0.14 : 0.1),
                  color: theme.palette.stage[col.id],
                })}
              />
            </Box>

            {/* Column Cards */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {columnLeads.length === 0 ? (
                <Box
                  sx={{
                    py: 4,
                    textAlign: 'center',
                    color: 'text.secondary',
                    fontSize: '0.8125rem',
                    border: '1px dashed',
                    borderColor: 'border.strong',
                    borderRadius: 1,
                  }}
                >
                  {t('kanban.empty')}
                </Box>
              ) : (
                columnLeads.map((lead) => (
                  <Card
                    key={lead.id}
                    sx={{
                      p: 1.5,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.25,
                      transition: 'border-color 0.15s ease',
                      '&:hover': { borderColor: 'border.strong' },
                      ...((col.id === 'needs_approval' || col.id === 'rejected') && {
                        boxShadow: (theme) => `inset 2px 0 0 ${theme.palette.stage[col.id]}`,
                      }),
                    }}
                  >
                    {/* Card Title & Score */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box sx={{ pr: 1 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{ lineHeight: 1.3, color: 'text.primary' }}
                        >
                          {lead.businessName}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', wordBreak: 'break-all' }}
                          >
                            {lead.domain}
                          </Typography>
                          <Tooltip title={t('kanban.openWebsite')}>
                            <IconButton
                              size="small"
                              href={lead.originalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ p: 0.2 }}
                            >
                              <OpenInNewIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>

                      {lead.totalScore !== undefined && (
                        <ScoreChip score={lead.totalScore} />
                      )}
                    </Box>

                    {/* Metadata chips */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        label={isDashboardNiche(lead.niche) ? t(`niches.${lead.niche}`) : lead.niche}
                        size="small"
                        variant="outlined"
                      />
                      <SiteComplexityChip complexity={lead.siteComplexity} />
                      {lead.city && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, color: 'text.secondary' }}>
                          <LocationOnOutlinedIcon sx={{ fontSize: 14 }} />
                          <Typography variant="caption">{lead.city}</Typography>
                        </Box>
                      )}
                    </Box>

                    {/* Banner Thumbnail (if generated) */}
                    {lead.comparisonBannerUrl && (
                      <Box
                        component="img"
                        src={withPreviewVersion(lead.comparisonBannerUrl, lead.mvpGeneratedAt)}
                        alt={t('kanban.comparisonBanner')}
                        sx={{
                          width: '100%',
                          height: 70,
                          objectFit: 'cover',
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                    )}

                    {/* Last MVP generation failure (REV-31); the operator can retry */}
                    {lead.generationError && lead.status !== 'GENERATING' && (
                      <Tooltip title={lead.generationError}>
                        <Chip
                          icon={<ErrorOutlineIcon sx={{ fontSize: 14 }} />}
                          label={t('kanban.generationFailed')}
                          size="small"
                          color="error"
                          variant="outlined"
                          sx={{ alignSelf: 'flex-start' }}
                        />
                      </Tooltip>
                    )}

                    {/* The site could not be audited (REV-44); the reason is in the tooltip */}
                    {isAuditFailed(lead) && (
                      <Tooltip title={lead.auditError ?? ''}>
                        <Chip
                          icon={<ErrorOutlineIcon sx={{ fontSize: 14 }} />}
                          label={t('auditFailure.chip')}
                          size="small"
                          color="error"
                          variant="outlined"
                          sx={{ alignSelf: 'flex-start' }}
                        />
                      </Tooltip>
                    )}

                    {/* Critical business data the MVP lost or changed (REV-36) */}
                    {lead.status !== 'GENERATING' && criticalIssueFields(null, lead.completeness).length > 0 && (
                      <Tooltip
                        title={t('completeness.kanbanTooltip', {
                          fields: criticalIssueFields(null, lead.completeness)
                            .map((field) => t(`completeness.fields.${field}`))
                            .join(', '),
                        })}
                      >
                        <Chip
                          icon={<ReportProblemOutlinedIcon sx={{ fontSize: 14 }} />}
                          label={t('completeness.kanbanChip')}
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{ alignSelf: 'flex-start' }}
                        />
                      </Tooltip>
                    )}

                    {/* Action Footer */}
                    <Box
                      sx={{
                        pt: 1,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
                        {formatDate(lead.createdAt, language, {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </Typography>

                      {leadStage(lead.status) === 'needs_approval' && (
                        <Button
                          variant="contained"
                          color="warning"
                          size="small"
                          startIcon={<AutoAwesomeIcon sx={{ fontSize: 15 }} />}
                          onClick={() => openModal(lead.id, lead.auditId || `audit-${lead.id}`)}
                        >
                          {t('kanban.hitlReview')}
                        </Button>
                      )}

                      {lead.status === 'QUEUED' && (
                        <Chip
                          label={t('kanban.queued')}
                          size="small"
                        />
                      )}

                      {lead.status === 'AUDITING' && (
                        <Chip
                          label={t('kanban.auditing')}
                          size="small"
                          color="info"
                          variant="outlined"
                        />
                      )}

                      {isAuditFailed(lead) && <AuditFailedActions lead={lead} />}

                      {lead.status === 'AUDITED' && <GenerateMvpButton lead={lead} />}

                      {lead.status === 'GENERATING' && (
                        <Chip
                          label={t('kanban.generating')}
                          size="small"
                          color="warning"
                          variant="outlined"
                        />
                      )}

                      {leadStage(lead.status) === 'rejected' && (
                        <Chip
                          label={t('kanban.rejected')}
                          size="small"
                          color="error"
                          variant="outlined"
                        />
                      )}

                      {lead.previewUrl && leadStage(lead.status) !== 'needs_approval' && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          href={withPreviewVersion(lead.previewUrl, lead.mvpGeneratedAt)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('kanban.openMvp')}
                        </Button>
                      )}

                      <RegenerateMvpButton lead={lead} />
                    </Box>
                  </Card>
                ))
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
