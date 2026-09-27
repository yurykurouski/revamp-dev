import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
  CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useLeadsQuery } from '../hooks/useLeads.js';
import { KanbanBoard } from '../components/KanbanBoard.js';
import { LeadsDataGrid } from '../components/LeadsDataGrid.js';
import { AddLeadModal } from '../components/AddLeadModal.js';
import { SideBySideInspectorModal } from '../components/SideBySideInspectorModal.js';
import { LeadStatus, NicheType, SITE_COMPLEXITY_CLASSES } from '@revamp/shared-types';
import { ComplexityFilter } from '../utils/siteComplexity.js';
import { useTranslation } from 'react-i18next';
import { NICHES, NICHE_EMOJI } from '../i18n/niches.js';

export const LeadsPage: React.FC = () => {
  const {
    searchQuery,
    selectedStatus,
    selectedNiche,
    selectedComplexity,
    viewMode,
    setSearchQuery,
    setSelectedStatus,
    setSelectedNiche,
    setSelectedComplexity,
    resetFilters,
  } = useLeadFilterStore();

  const { data, isLoading, isError } = useLeadsQuery();
  const { t } = useTranslation();

  const leads = data?.leads ?? [];
  const kpi = data?.kpi ?? {
    totalLeads: leads.length,
    needsApproval: leads.filter((l) => l.status === 'NEEDS_APPROVAL').length,
    scheduled: leads.filter((l) => l.status === 'SCHEDULED').length,
    sent: leads.filter((l) => l.status === 'SENT').length,
    engaged: leads.filter((l) => l.status === 'CLICKED' || l.status === 'OPENED').length,
  };

  const kpiCards: Array<{
    label: string;
    value: number;
    icon: React.ReactNode;
    tone: 'primary' | 'warning' | 'success' | 'info';
    /** The value itself takes the tone color, for counts that call for action */
    highlight?: boolean;
  }> = [
    { label: t('leadsPage.totalLeads'), value: kpi.totalLeads, icon: <CheckCircleOutlineIcon />, tone: 'primary' },
    { label: t('leadsPage.awaitingApproval'), value: kpi.needsApproval, icon: <PendingActionsIcon />, tone: 'warning', highlight: true },
    { label: t('leadsPage.emailsSent'), value: kpi.sent, icon: <SendIcon />, tone: 'success' },
    { label: t('leadsPage.engaged'), value: kpi.engaged, icon: <VisibilityIcon />, tone: 'info', highlight: true },
  ];

  return (
    <Box>
      {/* Top Metrics Cards */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {kpiCards.map((card) => (
          <Grid item xs={12} sm={6} md={3} key={card.label}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    {card.label}
                  </Typography>
                  <Box
                    sx={{
                      width: 26,
                      height: 26,
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${card.tone}.soft`,
                      color: `${card.tone}.main`,
                      '& svg': { fontSize: 16 },
                    }}
                  >
                    {card.icon}
                  </Box>
                </Box>
                <Typography variant="metric" sx={{ color: card.highlight ? `${card.tone}.main` : 'text.primary' }}>
                  {card.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filter Bar */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            placeholder={t('leadsPage.searchPlaceholder')}
            size="small"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />

          <FormControl size="small" sx={{ width: { xs: '100%', sm: 180 } }}>
            <InputLabel id="status-select-label">{t('leadsPage.statusLabel')}</InputLabel>
            <Select
              labelId="status-select-label"
              label={t('leadsPage.statusLabel')}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as LeadStatus | 'ALL')}
            >
              <MenuItem value="ALL">{t('leadsPage.allStatuses')}</MenuItem>
              <MenuItem value="QUEUED">{t('statuses.QUEUED')}</MenuItem>
              <MenuItem value="AUDIT_FAILED">{t('statuses.AUDIT_FAILED')}</MenuItem>
              <MenuItem value="NEEDS_APPROVAL">{t('statuses.NEEDS_APPROVAL')}</MenuItem>
              <MenuItem value="SCHEDULED">{t('statuses.SCHEDULED')}</MenuItem>
              <MenuItem value="SENT">{t('statuses.SENT')}</MenuItem>
              <MenuItem value="OPENED">{t('statuses.OPENED')}</MenuItem>
              <MenuItem value="CLICKED">{t('leadsPage.viewingDemo')}</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ width: { xs: '100%', sm: 190 } }}>
            <InputLabel id="niche-select-label">{t('leadsPage.nicheLabel')}</InputLabel>
            <Select
              labelId="niche-select-label"
              label={t('leadsPage.nicheLabel')}
              value={selectedNiche}
              onChange={(e) => setSelectedNiche(e.target.value as NicheType | 'ALL')}
            >
              <MenuItem value="ALL">{t('nichesPlural.all')}</MenuItem>
              {NICHES.map((niche) => (
                <MenuItem key={niche} value={niche}>
                  {NICHE_EMOJI[niche]} {t(`nichesPlural.${niche}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ width: { xs: '100%', sm: 200 } }}>
            <InputLabel id="complexity-select-label">{t('siteComplexity.label')}</InputLabel>
            <Select
              labelId="complexity-select-label"
              label={t('siteComplexity.label')}
              value={selectedComplexity}
              onChange={(e) => setSelectedComplexity(e.target.value as ComplexityFilter)}
            >
              <MenuItem value="ALL">{t('siteComplexity.all')}</MenuItem>
              {SITE_COMPLEXITY_CLASSES.map((complexity) => (
                <MenuItem key={complexity} value={complexity}>
                  {t(`siteComplexity.classes.${complexity}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {(searchQuery || selectedStatus !== 'ALL' || selectedNiche !== 'ALL' || selectedComplexity !== 'ALL') && (
            <Button
              variant="text"
              color="inherit"
              size="small"
              startIcon={<RestartAltIcon sx={{ fontSize: 16 }} />}
              onClick={resetFilters}
              sx={{ color: 'text.secondary' }}
            >
              {t('leadsPage.reset')}
            </Button>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Typography variant="body2" color="text.secondary">
            {t('leadsPage.found')} <strong>{data?.total ?? leads.length}</strong>
          </Typography>
        </CardContent>
      </Card>

      {/* Main View: Kanban vs Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'error.main' }}>
          <Typography variant="h6">{t('leadsPage.loadFailed')}</Typography>
        </Box>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard leads={leads} />
      ) : (
        <LeadsDataGrid leads={leads} isLoading={isLoading} />
      )}

      {/* Quick Add Lead Modal Dialog */}
      <AddLeadModal />

      {/* Side-by-Side Split Screen Inspector Dialog */}
      <SideBySideInspectorModal />
    </Box>
  );
};
