import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  Snackbar,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ILeadItem } from '../api/client.js';
import { useLeadsQuery } from '../hooks/useLeads.js';
import { useOpenLead } from '../hooks/useOpenLead.js';
import { useQueueHotkeys } from '../hooks/useQueueHotkeys.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { LeadReview, type ReviewDecision } from '../components/leadReview/LeadReview.js';
import { AuditFailedActions } from '../components/AuditFailedActions.js';
import { ScoreChip } from '../components/ScoreChip.js';
import { MAIN_FILL_HEIGHT } from '../components/Layout.js';
import { isAuditFailed } from '../utils/auditFailure.js';
import {
  countLeadsByBucket,
  isKnownLeadStatus,
  LEAD_BUCKETS,
  LEAD_STATUS_CHIP_COLOR,
  leadBucket,
  matchesBucket,
  type LeadBucket,
} from '../utils/leadStages.js';
import {
  activeFilterCount,
  DEFAULT_QUEUE_BUCKET,
  filterQueue,
  formatAge,
  isLeadBucket,
  NO_QUEUE_FILTERS,
  queueStatusOptions,
  resolveSelection,
  scoreBandOptions,
  sortQueue,
  stepSelection,
  toggleValue,
  type FilterOption,
  type QueueFilters,
} from '../utils/reviewQueue.js';

/** Width of the lead list next to the review */
export const QUEUE_LIST_WIDTH = 380;

const tabId = (bucket: LeadBucket) => `queue-tab-${bucket}`;
const LIST_ID = 'queue-list';
const FILTERS_ID = 'queue-filters';

/** Hidden from sight but read by screen readers, for the page heading the layout has no room for */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

interface QueueItemProps {
  lead: ILeadItem;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

const QueueItem: React.FC<QueueItemProps> = ({ lead, selected, now, onSelect, onOpen }) => {
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const known = isKnownLeadStatus(lead.status);

  return (
    <ListItemButton
      selected={selected}
      aria-current={selected ? 'true' : undefined}
      data-queue-item={lead.id}
      // ButtonBase turns Enter into a click after onKeyDown; that Enter already opened the lead
      onClick={(event) => {
        if (!event.defaultPrevented) onSelect(lead.id);
      }}
      onKeyDown={(event) => {
        // Enter on a focused lead opens it, like Enter on the selected lead with nothing focused
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          onOpen(lead.id);
        }
      }}
      divider
      sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 0.75, py: 1.75, px: 2.5 }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
          {lead.businessName}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {formatAge(lead.createdAt, now, language)}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" noWrap>
        {[lead.domain, lead.city].filter(Boolean).join(' · ')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          label={known ? t(`statuses.${lead.status}`) : lead.status}
          size="small"
          color={known ? LEAD_STATUS_CHIP_COLOR[lead.status] : 'default'}
        />
        {isAuditFailed(lead) ? (
          <Typography variant="caption" color="text.secondary">
            {t('queue.auditFailedHint')}
          </Typography>
        ) : (
          typeof lead.totalScore === 'number' && <ScoreChip score={lead.totalScore} />
        )}
      </Box>
    </ListItemButton>
  );
};

interface FilterChipsProps<T extends string> {
  label: string;
  group: string;
  options: readonly FilterOption<T>[];
  picked: readonly T[];
  optionLabel: (value: T) => string;
  onToggle: (value: T) => void;
}

/** One quick-filter group: a toggle chip per value, with how many of the bucket's leads have it */
const FilterChips = <T extends string>({ label, group, options, picked, optionLabel, onToggle }: FilterChipsProps<T>) => (
  <Box role="group" aria-label={label} data-filter-group={group} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44 }}>
      {label}
    </Typography>
    {options.map(({ value, count }) => {
      const on = picked.includes(value);
      return (
        <Chip
          key={value}
          data-filter={value}
          size="small"
          clickable
          aria-pressed={on}
          aria-label={`${optionLabel(value)} (${count})`}
          color={on ? 'primary' : 'default'}
          variant={on ? 'filled' : 'outlined'}
          onClick={() => onToggle(value)}
          label={
            <>
              {optionLabel(value)}
              <Box component="span" sx={{ ml: 0.75, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                {count}
              </Box>
            </>
          }
        />
      );
    })}
  </Box>
);

/**
 * Review queue home (REV-79): the leads in four buckets (Needs you, In progress, Outreach, Closed), a
 * 380px list of the current bucket, and the selected lead's review (REV-77) next to it. The bucket and
 * the selected lead live in the URL (`?bucket=…&lead=…`), so a reload keeps the operator's place. When
 * the selected lead leaves the bucket (approved, rejected, moved on by a worker) the next one is selected.
 * J / K move through the list and Enter opens the lead as its own page. Quick filters (REV-80) narrow the
 * bucket's list by status and score band; they belong to the bucket and reset when it changes.
 */
export const ReviewQueuePage: React.FC = () => {
  const { t } = useTranslation();
  const openLead = useOpenLead();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, isError, dataUpdatedAt } = useLeadsQuery();
  const [notice, setNotice] = useState<string | null>(null);

  const allLeads = useMemo(() => data?.leads ?? [], [data]);
  const counts = useMemo(() => countLeadsByBucket(allLeads), [allLeads]);

  const requestedLead = searchParams.get('lead');
  const bucketParam = searchParams.get('bucket');
  // A link to a lead without a bucket opens the bucket the lead is in
  const linkedLeadBucket = requestedLead ? leadBucket(allLeads.find((l) => l.id === requestedLead)?.status ?? '') : undefined;
  const bucket: LeadBucket = isLeadBucket(bucketParam) ? bucketParam : (linkedLeadBucket ?? DEFAULT_QUEUE_BUCKET);

  const bucketLeads = useMemo(
    () => sortQueue(allLeads.filter((lead) => matchesBucket(lead.status, bucket)), bucket),
    [allLeads, bucket],
  );

  // Filters belong to the bucket they were set in: a new bucket, by tab or by URL, starts unfiltered
  const [filterState, setFilterState] = useState<{ bucket: LeadBucket; filters: QueueFilters }>({ bucket, filters: NO_QUEUE_FILTERS });
  if (filterState.bucket !== bucket) setFilterState({ bucket, filters: NO_QUEUE_FILTERS });
  const filters = filterState.bucket === bucket ? filterState.filters : NO_QUEUE_FILTERS;
  const filtering = activeFilterCount(filters) > 0;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const updateFilters = (next: Partial<QueueFilters>) => setFilterState({ bucket, filters: { ...filters, ...next } });

  const statusOptions = useMemo(() => queueStatusOptions(bucketLeads, filters.statuses), [bucketLeads, filters.statuses]);
  const bandOptions = useMemo(() => scoreBandOptions(bucketLeads), [bucketLeads]);
  const leads = useMemo(() => filterQueue(bucketLeads, filters), [bucketLeads, filters]);
  const ids = useMemo(() => leads.map((lead) => lead.id), [leads]);

  // The list as last shown, to find the lead that followed one that just left it
  const shownIds = useRef<string[]>([]);
  const selectedId = data ? resolveSelection(ids, requestedLead, shownIds.current) : requestedLead;
  const selectedLead = leads.find((lead) => lead.id === selectedId);

  useEffect(() => {
    if (data) shownIds.current = ids;
  }, [data, ids]);

  const setQuery = useCallback(
    (next: { bucket?: LeadBucket; lead?: string | null }) =>
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next.bucket) params.set('bucket', next.bucket);
          if (next.lead === null) params.delete('lead');
          else if (next.lead) params.set('lead', next.lead);
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  // Keep the URL on the bucket and lead actually shown, so a reload and Back return to them. The bucket
  // is pinned too: otherwise an approved lead would take the page along to its new bucket.
  useEffect(() => {
    if (data && (selectedId !== requestedLead || bucketParam !== bucket)) setQuery({ bucket, lead: selectedId });
  }, [data, selectedId, requestedLead, bucketParam, bucket, setQuery]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('[data-queue-item]') ?? [];
    const item = [...items].find((el) => el.dataset.queueItem === selectedId);
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  const select = useCallback((id: string | null) => setQuery({ lead: id }), [setQuery]);

  useQueueHotkeys({
    next: () => select(stepSelection(ids, selectedId, 1)),
    previous: () => select(stepSelection(ids, selectedId, -1)),
    open: () => {
      if (selectedId) openLead(selectedId);
    },
  });

  const handleDecision = (decision: ReviewDecision) => {
    if (selectedLead) setNotice(t(`queue.${decision}`, { name: selectedLead.businessName }));
  };

  // Ages are relative to the last time the list loaded
  const now = dataUpdatedAt || Date.now();

  return (
    <Box
      sx={{
        height: { lg: MAIN_FILL_HEIGHT },
        minHeight: { lg: 560 },
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        backgroundColor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Typography variant="h5" component="h1" sx={visuallyHidden}>
        {t('queue.title')}
      </Typography>

      <Tabs
        value={bucket}
        onChange={(_event, value: LeadBucket) => setQuery({ bucket: value, lead: null })}
        aria-label={t('queue.bucketsLabel')}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ px: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}
      >
        {LEAD_BUCKETS.map((b) => (
          <Tab
            key={b}
            value={b}
            id={tabId(b)}
            aria-controls={LIST_ID}
            data-bucket={b}
            iconPosition="end"
            icon={
              <Chip
                label={counts[b]}
                size="small"
                color={b === 'needs_you' && counts[b] > 0 ? 'warning' : 'default'}
                sx={{ height: 20, fontVariantNumeric: 'tabular-nums', '& .MuiChip-label': { px: 0.75 } }}
              />
            }
            label={t(`buckets.${b}`)}
            sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600, gap: 1 }}
          />
        ))}
      </Tabs>

      <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', lg: 'row' } }}>
        {/* The bucket's leads */}
        <Box
          sx={{
            width: { lg: QUEUE_LIST_WIDTH },
            flexShrink: 0,
            maxHeight: { xs: 360, lg: 'none' },
            display: 'flex',
            flexDirection: 'column',
            borderRight: { lg: '1px solid' },
            borderBottom: { xs: '1px solid', lg: 'none' },
            borderColor: 'divider',
          }}
        >
          <Box
            sx={{
              pl: 2.5,
              pr: 1,
              py: 0.5,
              minHeight: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <Typography variant="caption" color="text.secondary" data-testid="queue-caption" sx={{ minWidth: 0 }} noWrap>
              {t(`queue.listCaption.${bucket}`)}
              {filtering && ` · ${t('queue.filters.shown', { shown: leads.length, total: bucketLeads.length })}`}
            </Typography>
            <Button
              size="small"
              color={filtering ? 'primary' : 'inherit'}
              startIcon={<FilterListIcon fontSize="small" />}
              aria-expanded={filtersOpen}
              aria-controls={FILTERS_ID}
              data-testid="queue-filter-toggle"
              onClick={() => setFiltersOpen((open) => !open)}
              sx={{ flexShrink: 0, color: filtering ? undefined : 'text.secondary', fontWeight: 600 }}
            >
              {filtering ? t('queue.filters.buttonActive', { count: activeFilterCount(filters) }) : t('queue.filters.button')}
            </Button>
          </Box>

          {filtersOpen && (
            <Box
              id={FILTERS_ID}
              role="region"
              aria-label={t('queue.filters.label')}
              sx={{ px: 2.5, py: 1.25, display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}
            >
              {statusOptions.length > 1 && (
                <FilterChips
                  label={t('queue.filters.status')}
                  group="status"
                  options={statusOptions}
                  picked={filters.statuses}
                  optionLabel={(status) => (isKnownLeadStatus(status) ? t(`statuses.${status}`) : status)}
                  onToggle={(status) => updateFilters({ statuses: toggleValue(filters.statuses, status) })}
                />
              )}
              <FilterChips
                label={t('queue.filters.score')}
                group="score"
                options={bandOptions}
                picked={filters.scoreBands}
                optionLabel={(band) => t(`queue.filters.bands.${band}`)}
                onToggle={(band) => updateFilters({ scoreBands: toggleValue(filters.scoreBands, band) })}
              />
              {filtering && (
                <Button size="small" onClick={() => updateFilters(NO_QUEUE_FILTERS)} sx={{ alignSelf: 'flex-start', ml: -0.5 }}>
                  {t('queue.filters.clear')}
                </Button>
              )}
            </Box>
          )}

          <Box ref={listRef} id={LIST_ID} role="tabpanel" aria-labelledby={tabId(bucket)} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
            {isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : isError ? (
              <Typography color="error.main" sx={{ p: 2.5 }}>
                {t('leadsPage.loadFailed')}
              </Typography>
            ) : leads.length === 0 && bucketLeads.length > 0 ? (
              <Box data-testid="queue-filtered-empty" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                <FilterListIcon sx={{ fontSize: 32, mb: 1 }} />
                <Typography variant="body2">{t('queue.filters.noMatch')}</Typography>
                <Button size="small" onClick={() => updateFilters(NO_QUEUE_FILTERS)} sx={{ mt: 1 }}>
                  {t('queue.filters.clear')}
                </Button>
              </Box>
            ) : leads.length === 0 ? (
              <Box data-testid="queue-empty" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                <InboxOutlinedIcon sx={{ fontSize: 32, mb: 1 }} />
                <Typography variant="body2">{t(`queue.empty.${bucket}`)}</Typography>
              </Box>
            ) : (
              <List disablePadding aria-label={t(`buckets.${bucket}`)}>
                {leads.map((lead) => (
                  <QueueItem
                    key={lead.id}
                    lead={lead}
                    selected={lead.id === selectedId}
                    now={now}
                    onSelect={select}
                    onOpen={openLead}
                  />
                ))}
              </List>
            )}
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 2.5, py: 1.25, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0, display: { xs: 'none', lg: 'block' } }}
          >
            {t('queue.keyboardHint')}
          </Typography>
        </Box>

        {/* The selected lead's review */}
        <Box component="section" aria-label={t('queue.detailLabel')} sx={{ flexGrow: 1, minWidth: 0, minHeight: { xs: 560, lg: 0 }, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {selectedLead ? (
            <>
              {isAuditFailed(selectedLead) && (
                <Alert
                  severity="error"
                  action={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AuditFailedActions lead={selectedLead} />
                    </Box>
                  }
                >
                  {selectedLead.auditError || t('auditFailure.chip')}
                </Alert>
              )}
              <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                <LeadReview key={selectedLead.id} lead={selectedLead} headingComponent="h2" onDecision={handleDecision} />
              </Box>
            </>
          ) : (
            // An empty bucket says so in the list; the review side stays blank
            !isLoading &&
            leads.length > 0 && (
              <Box sx={{ m: 'auto', textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">{t('queue.selectLead')}</Typography>
              </Box>
            )
          )}
        </Box>
      </Box>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>
    </Box>
  );
};
