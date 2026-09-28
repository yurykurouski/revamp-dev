import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Link,
  Switch,
  Typography,
} from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { DiscoveryCandidateStatus, IDiscoveryJobResult } from '@revamp/shared-types';
import { useTranslation } from 'react-i18next';
import {
  countCandidates,
  discoverySearchOutcome,
  importableIds,
  pruneSelection,
  useImportDiscoveryMutation,
  visibleCandidates,
} from '../hooks/useDiscovery.js';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import { useOpenLead } from '../hooks/useOpenLead.js';
import {
  ASSESSMENT_CHIP_COLOR,
  ASSESSMENT_FILTER_BUCKETS,
  countAssessments,
  defaultSelection,
  filterByAssessment,
  hasAssessments,
  sortByAssessment,
} from '../utils/siteAssessment.js';
import { DiscoveryDrawerFooter } from './DiscoveryDrawerFooter.js';
import { AssessmentDetails, AssessmentVerdictChip } from './CandidateAssessment.js';

const STATUS_ORDER: DiscoveryCandidateStatus[] = ['new', 'existing_lead', 'duplicate', 'no_website', 'invalid'];

const STATUS_CHIP_COLOR = {
  new: 'success',
  existing_lead: 'info',
  duplicate: 'default',
  no_website: 'default',
  invalid: 'warning',
} as const;

interface DiscoveryReviewProps {
  jobId: string;
  result: IDiscoveryJobResult;
  /** How many new businesses the search asked for */
  limit: number;
  /** Returns to the Where step with this search's parameters */
  onBack: () => void;
}

/**
 * The Review step of the discovery drawer (REV-78): lists the new businesses a search found and
 * imports the operator's selection as leads (REV-29). Businesses that are already leads are hidden
 * behind a toggle (REV-35). Each new business shows its site pre-assessment, and the list can be
 * filtered and sorted by its verdict (REV-98); select all and import act on the listed rows only.
 * Renders the step's scrolling body and its footer.
 */
export const DiscoveryReview: React.FC<DiscoveryReviewProps> = ({ jobId, result, limit, onBack }) => {
  const { t } = useTranslation();
  const importMutation = useImportDiscoveryMutation(jobId);
  const closeDiscovery = useDiscoveryStore((s) => s.close);
  const setImportResult = useDiscoveryStore((s) => s.setImportResult);
  const assessmentFilter = useDiscoveryStore((s) => s.assessmentFilter);
  const setAssessmentFilter = useDiscoveryStore((s) => s.setAssessmentFilter);
  const sortBest = useDiscoveryStore((s) => s.sortByAssessment);
  const setSortBest = useDiscoveryStore((s) => s.setSortByAssessment);
  const openLead = useOpenLead();
  const { candidates } = result;

  const counts = useMemo(() => countCandidates(candidates), [candidates]);
  const otherSkippedCount = counts.duplicate + counts.no_website + counts.invalid;
  const searchOutcome = discoverySearchOutcome(result, limit);
  const assessed = hasAssessments(candidates);
  const assessmentCounts = useMemo(() => countAssessments(candidates), [candidates]);

  // New businesses start selected unless rated poor; imported ones drop out as polling marks them existing_lead
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelection(candidates)));
  const [showExisting, setShowExisting] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const visible = filterByAssessment(visibleCandidates(candidates, { showExisting, showSkipped }), assessmentFilter);
    return sortBest ? sortByAssessment(visible) : visible;
  }, [candidates, showExisting, showSkipped, assessmentFilter, sortBest]);

  // Only listed rows stay selected, so a filter never imports businesses the operator can't see
  useEffect(() => {
    setSelected((current) => pruneSelection(current, rows));
  }, [rows]);

  const importable = importableIds(rows);
  const allSelected = importable.length > 0 && importable.every((id) => selected.has(id));

  const toggle = (externalId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(importable));

  const handleImport = async () => {
    setImportError(null);
    try {
      // The store moves the drawer to the Import step
      setImportResult(jobId, await importMutation.mutateAsync([...selected]));
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : t('discovery.errors.importFailed'));
    }
  };

  const handleOpenLead = (leadId: string) => {
    closeDiscovery();
    openLead(leadId);
  };

  return (
    <>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 3, pt: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
              <Chip
                key={status}
                size="small"
                variant={status === 'new' ? 'filled' : 'outlined'}
                color={STATUS_CHIP_COLOR[status]}
                label={`${t(`discovery.candidateStatus.${status}`)}: ${counts[status]}`}
              />
            ))}
          </Box>

          {searchOutcome !== 'filled' && (
            <Alert severity="info">
              {t(searchOutcome === 'exhausted' ? 'discovery.searchExhausted' : 'discovery.searchCapped', {
                new: result.counts?.new ?? counts.new,
                limit,
              })}
            </Alert>
          )}
          {counts.new === 0 && <Alert severity="info">{t('discovery.nothingNewHint')}</Alert>}
          {importError && <Alert severity="error">{importError}</Alert>}

          {assessed && (
            <Box
              role="group"
              aria-label={t('discovery.assessment.filterLabel')}
              sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>
                {t('discovery.assessment.filterLabel')}
              </Typography>
              <Chip
                size="small"
                clickable
                variant={assessmentFilter === 'all' ? 'filled' : 'outlined'}
                color={assessmentFilter === 'all' ? 'primary' : 'default'}
                aria-pressed={assessmentFilter === 'all'}
                label={t('discovery.assessment.all')}
                onClick={() => setAssessmentFilter('all')}
              />
              {ASSESSMENT_FILTER_BUCKETS.filter((bucket) => assessmentCounts[bucket] > 0 || assessmentFilter === bucket).map(
                (bucket) => (
                  <Chip
                    key={bucket}
                    size="small"
                    clickable
                    variant={assessmentFilter === bucket ? 'filled' : 'outlined'}
                    color={ASSESSMENT_CHIP_COLOR[bucket]}
                    aria-pressed={assessmentFilter === bucket}
                    label={`${t(`discovery.assessment.verdict.${bucket}`)}: ${assessmentCounts[bucket]}`}
                    onClick={() => setAssessmentFilter(bucket)}
                    data-testid={`assessment-filter-${bucket}`}
                  />
                ),
              )}
              <Box sx={{ flexGrow: 1 }} />
              <FormControlLabel
                sx={{ mr: 0 }}
                control={<Switch size="small" checked={sortBest} onChange={(e) => setSortBest(e.target.checked)} />}
                label={
                  <Typography variant="body2" color="text.secondary">
                    {t('discovery.assessment.sortBest')}
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" component="p" sx={{ width: '100%', m: 0 }}>
                {t('discovery.assessment.hint')} {t('discovery.assessment.scoring')}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Toolbar: select all on the left, the hidden groups' toggles on the right */}
        <Box
          sx={{
            px: 3,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
            borderTop: '1px solid',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <FormControlLabel
            sx={{ ml: -1, mr: 0 }}
            control={
              <Checkbox
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                disabled={importable.length === 0 || importMutation.isPending}
                onChange={toggleAll}
              />
            }
            label={<Typography variant="body2" sx={{ fontWeight: 600 }}>{t('discovery.selectAll')}</Typography>}
          />
          <Box sx={{ flexGrow: 1 }} />
          {counts.existing_lead > 0 && (
            <FormControlLabel
              sx={{ mr: 0 }}
              control={<Switch size="small" checked={showExisting} onChange={(e) => setShowExisting(e.target.checked)} />}
              label={
                <Typography variant="body2" color="text.secondary">
                  {t('discovery.existingSummary', { existing: counts.existing_lead })}
                </Typography>
              }
            />
          )}
          {otherSkippedCount > 0 && (
            <FormControlLabel
              sx={{ mr: 0 }}
              control={<Switch size="small" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />}
              label={
                <Typography variant="body2" color="text.secondary">
                  {t('discovery.showSkipped', { skipped: otherSkippedCount })}
                </Typography>
              }
            />
          )}
        </Box>

        <Box component="ul" aria-label={t('discovery.columns.business')} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {rows.map((c) => {
            const isNew = c.status === 'new';
            const details = [c.city, c.phone].filter(Boolean).join(' · ');
            return (
              <Box
                component="li"
                key={c.externalId}
                data-testid="discovery-candidate"
                onClick={isNew && !importMutation.isPending ? () => toggle(c.externalId) : undefined}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  gap: 1.5,
                  alignItems: 'center',
                  px: 3,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  cursor: isNew ? 'pointer' : 'default',
                  opacity: isNew || c.status === 'existing_lead' ? 1 : 0.6,
                  '&:hover': isNew ? { backgroundColor: 'action.hover' } : undefined,
                }}
              >
                <Checkbox
                  checked={selected.has(c.externalId)}
                  disabled={!isNew || importMutation.isPending}
                  inputProps={{ 'aria-label': c.name }}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(c.externalId)}
                  sx={{ ml: -1 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={c.name}>
                    {c.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div" noWrap>
                    {c.website && (
                      <Link href={c.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {c.domain ?? c.website}
                      </Link>
                    )}
                    {c.website && details && ' · '}
                    {details}
                  </Typography>
                  {c.assessment && <AssessmentDetails assessment={c.assessment} />}
                </Box>
                <Box sx={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                  {c.assessment && <AssessmentVerdictChip assessment={c.assessment} />}
                  <Chip
                    size="small"
                    variant="outlined"
                    color={STATUS_CHIP_COLOR[c.status]}
                    label={t(`discovery.candidateStatus.${c.status}`)}
                  />
                  {c.status === 'existing_lead' && c.leadId && (
                    <Link
                      component="button"
                      type="button"
                      variant="caption"
                      onClick={() => handleOpenLead(c.leadId as string)}
                      sx={{ display: 'block', ml: 'auto', fontWeight: 600 }}
                    >
                      {t('discovery.openLead')}
                    </Link>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      <DiscoveryDrawerFooter hint={counts.new > 0 ? t('discovery.reviewHint') : undefined}>
        <Button onClick={onBack} color="inherit" disabled={importMutation.isPending} sx={{ fontWeight: 600 }}>
          {t('discovery.back')}
        </Button>
        {importable.length > 0 && (
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={selected.size === 0 || importMutation.isPending}
            startIcon={importMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <PlaylistAddIcon />}
            sx={{ fontWeight: 700 }}
          >
            {importMutation.isPending ? t('discovery.importing') : t('discovery.import', { selected: selected.size })}
          </Button>
        )}
      </DiscoveryDrawerFooter>
    </>
  );
};
