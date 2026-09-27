import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { useTranslation } from 'react-i18next';
import { NicheType, SITE_COMPLEXITY_CLASSES } from '@revamp/shared-types';
import { useLeadFilterStore, ViewMode } from '../store/useLeadFilterStore.js';
import { useLeadsQuery } from '../hooks/useLeads.js';
import { KanbanBoard } from '../components/KanbanBoard.js';
import { LeadsDataGrid } from '../components/LeadsDataGrid.js';
import { ComplexityFilter } from '../utils/siteComplexity.js';
import { BucketFilter, LEAD_BUCKETS, countLeadsByBucket, matchesBucket } from '../utils/leadStages.js';
import { NICHES, NICHE_EMOJI } from '../i18n/niches.js';

const BUCKET_FILTERS: readonly BucketFilter[] = ['ALL', ...LEAD_BUCKETS];

/**
 * All leads (REV-76): every lead in every status as a table or a board, narrowed by bucket, niche and
 * site type. A lead opens as its own page at `/leads/:id`.
 */
export const AllLeadsPage: React.FC = () => {
  const {
    searchQuery,
    selectedBucket,
    selectedNiche,
    selectedComplexity,
    viewMode,
    setSelectedBucket,
    setSelectedNiche,
    setSelectedComplexity,
    setViewMode,
    resetFilters,
  } = useLeadFilterStore();

  const { data, isLoading, isError } = useLeadsQuery();
  const { t } = useTranslation();

  const allLeads = useMemo(() => data?.leads ?? [], [data]);
  const bucketCounts = useMemo(() => countLeadsByBucket(allLeads), [allLeads]);
  const leads = useMemo(
    () => allLeads.filter((lead) => matchesBucket(lead.status, selectedBucket)),
    [allLeads, selectedBucket],
  );

  const filtered = searchQuery || selectedBucket !== 'ALL' || selectedNiche !== 'ALL' || selectedComplexity !== 'ALL';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h1">
          {t('allLeads.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('allLeads.subtitle')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          value={selectedBucket}
          exclusive
          size="small"
          onChange={(_e, bucket: BucketFilter | null) => bucket && setSelectedBucket(bucket)}
          aria-label={t('allLeads.bucketLabel')}
          sx={{ flexWrap: 'wrap' }}
        >
          {BUCKET_FILTERS.map((bucket) => (
            <ToggleButton key={bucket} value={bucket} sx={{ px: 1.5, gap: 0.75 }}>
              {t(`buckets.${bucket}`)}
              <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {bucketCounts[bucket]}
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

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

        {filtered && (
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

        <ToggleButtonGroup
          value={viewMode}
          exclusive
          size="small"
          onChange={(_e, mode: ViewMode | null) => mode && setViewMode(mode)}
          aria-label={t('allLeads.viewLabel')}
        >
          <ToggleButton value="table" sx={{ gap: 0.5 }}>
            <TableRowsIcon sx={{ fontSize: 18 }} />
            {t('allLeads.table')}
          </ToggleButton>
          <ToggleButton value="kanban" sx={{ gap: 0.5 }}>
            <ViewKanbanIcon sx={{ fontSize: 18 }} />
            {t('allLeads.board')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

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
    </Box>
  );
};
