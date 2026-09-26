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
import { LeadStatus } from '@revamp/shared-types';
import { ILeadItem } from '../api/client.js';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { useGenerateMvpMutation } from '../hooks/useLeads.js';
import { useTranslation } from 'react-i18next';
import type { Translation } from '../i18n/locales/en.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { formatDate } from '../i18n/languages.js';
import { isDashboardNiche } from '../i18n/niches.js';

interface KanbanColumnConfig {
  id: keyof Translation['kanban']['columns'];
  status: LeadStatus | LeadStatus[];
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const COLUMNS: KanbanColumnConfig[] = [
  {
    id: 'queued',
    status: ['QUEUED', 'PENDING', 'AUDITING', 'AUDITED', 'GENERATING'],
    icon: <PendingActionsIcon sx={{ fontSize: 18 }} />,
    color: '#64748B',
    bgColor: 'rgba(100, 116, 139, 0.08)',
  },
  {
    id: 'needs_approval',
    status: ['NEEDS_APPROVAL', 'MVP_READY', 'AWAITING_APPROVAL'],
    icon: <AutoAwesomeIcon sx={{ fontSize: 18 }} />,
    color: '#F59E0B',
    bgColor: 'rgba(245, 158, 11, 0.08)',
  },
  {
    id: 'scheduled',
    status: ['SCHEDULED', 'APPROVED'],
    icon: <ScheduleIcon sx={{ fontSize: 18 }} />,
    color: '#6366F1',
    bgColor: 'rgba(99, 102, 241, 0.08)',
  },
  {
    id: 'sent',
    status: ['SENT', 'DISPATCHED'],
    icon: <SendIcon sx={{ fontSize: 18 }} />,
    color: '#3B82F6',
    bgColor: 'rgba(59, 130, 246, 0.08)',
  },
  {
    id: 'opened',
    status: ['OPENED'],
    icon: <MarkEmailReadIcon sx={{ fontSize: 18 }} />,
    color: '#8B5CF6',
    bgColor: 'rgba(139, 92, 246, 0.08)',
  },
  {
    id: 'clicked',
    status: ['CLICKED'],
    icon: <TouchAppIcon sx={{ fontSize: 18 }} />,
    color: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.08)',
  },
  {
    id: 'engaged',
    status: ['ENGAGED', 'REPLIED'],
    icon: <WhatshotIcon sx={{ fontSize: 18 }} />,
    color: '#EC4899',
    bgColor: 'rgba(236, 72, 153, 0.08)',
  },
  {
    id: 'rejected',
    status: ['REJECTED', 'UNSUBSCRIBED'],
    icon: <BlockIcon sx={{ fontSize: 18 }} />,
    color: '#EF4444',
    bgColor: 'rgba(239, 68, 68, 0.08)',
  },
];

interface KanbanBoardProps {
  leads: ILeadItem[];
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ leads }) => {
  const { openModal } = useHitlModalStore();
  const generateMvpMutation = useGenerateMvpMutation();
  const { t } = useTranslation();
  const { language } = useLanguageStore();

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2.5,
        overflowX: 'auto',
        pb: 3,
        pt: 1,
        minHeight: 'calc(100vh - 280px)',
        alignItems: 'flex-start',
      }}
    >
      {COLUMNS.map((col) => {
        const columnLeads = leads.filter((l) =>
          Array.isArray(col.status) ? col.status.includes(l.status) : l.status === col.status,
        );

        return (
          <Box
            key={col.id}
            sx={{
              width: 320,
              minWidth: 320,
              backgroundColor: 'background.paper',
              borderRadius: 3,
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* Column Header */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                pb: 1,
                borderBottom: '2px solid',
                borderColor: col.color,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ color: col.color, display: 'flex', alignItems: 'center' }}>
                  {col.icon}
                </Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t(`kanban.columns.${col.id}`)}
                </Typography>
              </Box>
              <Chip
                label={columnLeads.length}
                size="small"
                sx={{
                  height: 22,
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  backgroundColor: col.bgColor,
                  color: col.color,
                }}
              />
            </Box>

            {/* Column Cards */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {columnLeads.length === 0 ? (
                <Box
                  sx={{
                    py: 4,
                    textAlign: 'center',
                    color: 'text.secondary',
                    fontSize: '0.85rem',
                    border: '1px dashed',
                    borderColor: 'divider',
                    borderRadius: 2,
                  }}
                >
                  {t('kanban.empty')}
                </Box>
              ) : (
                columnLeads.map((lead) => (
                  <Card
                    key={lead.id}
                    sx={{
                      p: 2,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.5,
                      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                      },
                      ...(col.id === 'needs_approval' && {
                        borderLeft: '4px solid #F59E0B',
                      }),
                      ...(col.id === 'rejected' && {
                        borderLeft: '4px solid #EF4444',
                      }),
                    }}
                  >
                    {/* Card Title & Score */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box sx={{ pr: 1 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{
                            fontWeight: 700,
                            lineHeight: 1.3,
                            color: 'text.primary',
                          }}
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
                        <Chip
                          label={`${lead.totalScore}/100`}
                          size="small"
                          sx={{
                            height: 22,
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            backgroundColor:
                              lead.totalScore >= 70
                                ? 'success.light'
                                : lead.totalScore >= 40
                                ? 'warning.light'
                                : 'error.light',
                            color:
                              lead.totalScore >= 70
                                ? 'success.main'
                                : lead.totalScore >= 40
                                ? 'warning.main'
                                : 'error.main',
                          }}
                        />
                      )}
                    </Box>

                    {/* Metadata chips */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        label={isDashboardNiche(lead.niche) ? t(`niches.${lead.niche}`) : lead.niche}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.72rem', height: 20 }}
                      />
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
                        src={lead.comparisonBannerUrl}
                        alt={t('kanban.comparisonBanner')}
                        sx={{
                          width: '100%',
                          height: 70,
                          objectFit: 'cover',
                          borderRadius: 1.5,
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                    )}

                    {/* Action Footer */}
                    <Box
                      sx={{
                        pt: 1,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(lead.createdAt, language, {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </Typography>

                      {['NEEDS_APPROVAL', 'MVP_READY', 'AWAITING_APPROVAL'].includes(lead.status) && (
                        <Button
                          variant="contained"
                          color="warning"
                          size="small"
                          startIcon={<AutoAwesomeIcon sx={{ fontSize: 15 }} />}
                          onClick={() => openModal(lead.id, lead.auditId || `audit-${lead.id}`)}
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            py: 0.5,
                            px: 1.5,
                            color: '#000000',
                          }}
                        >
                          {t('kanban.hitlReview')}
                        </Button>
                      )}

                      {['QUEUED', 'PENDING'].includes(lead.status) && (
                        <Chip
                          label={t('kanban.queued')}
                          size="small"
                          sx={{
                            fontSize: '0.7rem',
                            height: 20,
                            backgroundColor: 'rgba(100, 116, 139, 0.1)',
                          }}
                        />
                      )}

                      {lead.status === 'AUDITING' && (
                        <Chip
                          label={t('kanban.auditing')}
                          size="small"
                          color="info"
                          variant="outlined"
                          sx={{
                            fontSize: '0.7rem',
                            height: 20,
                            fontWeight: 600,
                          }}
                        />
                      )}

                      {lead.status === 'AUDITED' && (
                        <Button
                          variant="contained"
                          color="primary"
                          size="small"
                          disabled={
                            generateMvpMutation.isPending &&
                            generateMvpMutation.variables?.leadId === lead.id
                          }
                          startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                          onClick={() =>
                            generateMvpMutation.mutate({
                              auditId: lead.auditId || lead.id,
                              leadId: lead.id,
                            })
                          }
                          sx={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            py: 0.4,
                            px: 1.2,
                          }}
                        >
                          {t('kanban.generateMvp')}
                        </Button>
                      )}

                      {lead.status === 'GENERATING' && (
                        <Chip
                          label={t('kanban.generating')}
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{
                            fontSize: '0.7rem',
                            height: 20,
                            fontWeight: 600,
                          }}
                        />
                      )}

                      {['REJECTED', 'UNSUBSCRIBED'].includes(lead.status) && (
                        <Chip
                          label={t('kanban.rejected')}
                          size="small"
                          color="error"
                          variant="outlined"
                          sx={{
                            fontSize: '0.7rem',
                            height: 20,
                            fontWeight: 600,
                          }}
                        />
                      )}

                      {lead.previewUrl && !['NEEDS_APPROVAL', 'MVP_READY', 'AWAITING_APPROVAL'].includes(lead.status) && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          href={lead.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ fontSize: '0.75rem', py: 0.3, px: 1 }}
                        >
                          {t('kanban.openMvp')}
                        </Button>
                      )}
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
