import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  Link,
  MenuItem,
  Select,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SearchIcon from '@mui/icons-material/Search';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import { DiscoveryProvider, IDiscoveryJobStatus, NicheType } from '@revamp/shared-types';
import { useTranslation } from 'react-i18next';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import {
  DEFAULT_DISCOVERY_FORM,
  DISCOVERY_STEPS,
  DiscoveryFormValues,
  detectLocation,
  discoveryFormFromParams,
  discoveryStateBucket,
  discoveryStep,
  importableIds,
  isDiscoveryFinished,
  LocationDetectError,
  searchAgainInput,
  summarizeImport,
  useDiscoveryStatusQuery,
  useStartDiscoveryMutation,
  validateDiscoveryForm,
} from '../hooks/useDiscovery.js';
import { NICHES, NICHE_EMOJI, isDashboardNiche } from '../i18n/niches.js';
import { DiscoveryReview } from './DiscoveryReview.js';
import { DiscoveryDrawerFooter } from './DiscoveryDrawerFooter.js';

const PROVIDERS: DiscoveryProvider[] = ['osm', 'google'];

const STATE_CHIP_COLOR = {
  queued: 'default',
  running: 'info',
  completed: 'success',
  failed: 'error',
} as const;

const TITLE_ID = 'discovery-drawer-title';

/**
 * Business discovery as a right-side drawer (REV-78, replacing the REV-27 modal) with three steps:
 * Where (the search form), Review (the search's progress, then its candidates) and Import (the
 * outcome). The step follows the store, so closing the drawer mid-search and reopening it lands on
 * the same step while the search keeps running in the background (REV-40, REV-41).
 */
export const DiscoveryDrawer: React.FC = () => {
  const { isOpen, close: closeDrawer, activeJobId, importResult, setActiveJob, markResultsSeen, backToReview, startNewSearch } =
    useDiscoveryStore();
  const startMutation = useStartDiscoveryMutation();
  const statusQuery = useDiscoveryStatusQuery(activeJobId);
  const { t, i18n } = useTranslation();

  // Kept while the drawer is closed, so a half-typed search survives
  const [form, setForm] = useState<DiscoveryFormValues>(DEFAULT_DISCOVERY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [searchAgainError, setSearchAgainError] = useState<string | null>(null);
  const locationRef = useRef<HTMLInputElement>(null);

  const status = statusQuery.data;
  const finished = isDiscoveryFinished(status);
  const step = discoveryStep({ activeJobId, importResult });
  const stepIndex = DISCOVERY_STEPS.indexOf(step);

  // Seeing the outcome here clears the header indicator (REV-40)
  const outcomeShown = isOpen && Boolean(activeJobId) && (finished || statusQuery.isError);
  useEffect(() => {
    if (outcomeShown) markResultsSeen();
  }, [outcomeShown, markResultsSeen]);

  /**
   * Drops focus before closing: the drawer's root turns aria-hidden while it slides out, and focus left
   * inside it makes Chrome block that and warn. MUI hands focus back to the opener once it has closed.
   */
  const close = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    closeDrawer();
  };

  const setField = <K extends keyof DiscoveryFormValues>(key: K, value: DiscoveryFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateDiscoveryForm({
      provider: form.provider,
      niche: form.niche,
      location: form.location,
      keyword: form.keyword.trim() || undefined,
      // Empty falls back to the schema default; anything non-numeric fails validation as NaN
      limit: form.limit.trim() === '' ? undefined : Number(form.limit),
    });
    if (!validation.success) {
      setFormError(t(validation.errorKey));
      return;
    }

    try {
      const { jobId } = await startMutation.mutateAsync(validation.data);
      setActiveJob(jobId);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('discovery.errors.submitFailed'));
    }
  };

  const handleDetectLocation = async () => {
    setFormError(null);
    setIsDetecting(true);
    try {
      setField('location', await detectLocation(i18n.language));
    } catch (err: unknown) {
      setFormError(t(err instanceof LocationDetectError ? err.errorKey : 'discovery.errors.geoLookupFailed'));
    } finally {
      setIsDetecting(false);
    }
  };

  /** Back to Where, starting from the finished search's parameters */
  const handleChangeSearch = () => {
    if (status) setForm(discoveryFormFromParams(status.params));
    setFormError(null);
    setSearchAgainError(null);
    startNewSearch();
  };

  /** The same search again without the businesses already checked (REV-107); stays on the step until it starts */
  const againInput = status && isDiscoveryFinished(status) ? searchAgainInput(status) : null;
  const handleSearchAgain = async () => {
    if (!againInput) return;
    setSearchAgainError(null);
    try {
      const { jobId } = await startMutation.mutateAsync(againInput);
      setActiveJob(jobId);
    } catch (err: unknown) {
      setSearchAgainError(err instanceof Error ? err.message : t('discovery.errors.submitFailed'));
    }
  };

  /** Offered in the Review and Import footers while there are checked businesses to skip */
  const renderSearchAgain = () =>
    againInput && (
      <Tooltip title={t('discovery.searchAgainHint', { count: againInput.excludeDomains?.length ?? 0 })}>
        <span>
          <Button
            onClick={handleSearchAgain}
            color="inherit"
            disabled={startMutation.isPending}
            startIcon={startMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <ManageSearchIcon />}
            sx={{ fontWeight: 600 }}
          >
            {t('discovery.searchAgain')}
          </Button>
        </span>
      </Tooltip>
    );

  const busy = startMutation.isPending;

  const renderWhere = () => (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t('discovery.subtitle')}
        </Typography>
        {formError && <Alert severity="error">{formError}</Alert>}

        <FormControl fullWidth disabled={busy}>
          <InputLabel id="discovery-provider-label">{t('discovery.providerLabel')}</InputLabel>
          <Select
            labelId="discovery-provider-label"
            label={t('discovery.providerLabel')}
            value={form.provider}
            onChange={(e) => setField('provider', e.target.value as DiscoveryProvider)}
          >
            {PROVIDERS.map((p) => (
              <MenuItem key={p} value={p}>
                {t(`discovery.providers.${p}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label={t('discovery.locationLabel')}
          placeholder={t('discovery.locationPlaceholder')}
          value={form.location}
          onChange={(e) => setField('location', e.target.value)}
          fullWidth
          required
          inputRef={locationRef}
          disabled={busy || isDetecting}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <PlaceOutlinedIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title={t('discovery.detectLocation')}>
                  <span>
                    <IconButton
                      edge="end"
                      onClick={handleDetectLocation}
                      disabled={busy || isDetecting}
                      aria-label={t('discovery.detectLocation')}
                    >
                      {isDetecting ? <CircularProgress size={20} /> : <MyLocationIcon />}
                    </IconButton>
                  </span>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />

        <FormControl fullWidth disabled={busy}>
          <InputLabel id="discovery-niche-label">{t('addLead.nicheLabel')}</InputLabel>
          <Select
            labelId="discovery-niche-label"
            label={t('addLead.nicheLabel')}
            value={form.niche}
            onChange={(e) => setField('niche', e.target.value as NicheType)}
          >
            {NICHES.map((n) => (
              <MenuItem key={n} value={n}>
                {NICHE_EMOJI[n]} {t(`nichesDetailed.${n}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
          <TextField
            label={t('discovery.keywordLabel')}
            placeholder={t('discovery.keywordPlaceholder')}
            value={form.keyword}
            onChange={(e) => setField('keyword', e.target.value)}
            fullWidth
            required={form.niche === 'other'}
            disabled={busy}
            helperText={form.niche === 'other' ? t('discovery.keywordRequiredHelper') : t('discovery.keywordHelper')}
          />
          <TextField
            label={t('discovery.limitLabel')}
            type="number"
            value={form.limit}
            onChange={(e) => setField('limit', e.target.value)}
            disabled={busy}
            inputProps={{ min: 1, max: 100 }}
            helperText={t('discovery.limitHelper')}
            sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
          />
        </Box>
      </Box>

      <DiscoveryDrawerFooter>
        <Button onClick={close} color="inherit" sx={{ fontWeight: 600 }}>
          {t('addLead.cancel')}
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
          sx={{ px: 2 }}
        >
          {busy ? t('discovery.starting') : t('discovery.start')}
        </Button>
      </DiscoveryDrawerFooter>
    </Box>
  );

  /** What was searched, where and how it went; shown above the Review and Import steps */
  const renderSearchBar = (s: IDiscoveryJobStatus) => {
    const bucket = discoveryStateBucket(s.state);
    const { params } = s;
    return (
      <Box
        sx={{
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          backgroundColor: 'action.hover',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {t('discovery.searchSummary', {
              what: params.keyword ?? (isDashboardNiche(params.niche) ? t(`nichesPlural.${params.niche}`) : params.niche),
              location: params.location,
              provider: t(`discovery.providers.${params.provider}`),
            })}
          </Typography>
        </Box>
        <Chip label={t(`discovery.states.${bucket}`)} color={STATE_CHIP_COLOR[bucket]} size="small" sx={{ fontWeight: 600 }} />
        {step === 'review' && isDiscoveryFinished(s) && (
          <Link component="button" type="button" variant="body2" onClick={handleChangeSearch} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {t('discovery.changeSearch')}
          </Link>
        )}
      </Box>
    );
  };

  /** A Review step without candidates to pick: loading, running, failed, or a search from before REV-29 */
  const renderReviewNotice = (body: React.ReactNode, withFooter: boolean) => (
    <>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 3, py: 3 }}>{body}</Box>
      {withFooter && (
        <DiscoveryDrawerFooter>
          <Button onClick={close} color="inherit" sx={{ fontWeight: 600 }}>
            {t('discovery.close')}
          </Button>
          <Button variant="contained" onClick={handleChangeSearch} startIcon={<SearchIcon />} sx={{ px: 2 }}>
            {t('discovery.changeSearch')}
          </Button>
        </DiscoveryDrawerFooter>
      )}
    </>
  );

  const renderReview = () => {
    if (statusQuery.isError) {
      return renderReviewNotice(
        <Alert severity="error">
          {statusQuery.error instanceof Error ? statusQuery.error.message : t('discovery.errors.statusFailed')}
        </Alert>,
        true,
      );
    }
    if (!status) {
      return renderReviewNotice(
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>,
        false,
      );
    }

    const bucket = discoveryStateBucket(status.state);
    const { params, result } = status;

    if (!finished) {
      return renderReviewNotice(
        <Box>
          <LinearProgress />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {t('discovery.runningHint')}
          </Typography>
        </Box>,
        false,
      );
    }
    if (bucket === 'failed' || !result) {
      return renderReviewNotice(<Alert severity="error">{status.error ?? t('discovery.errors.statusFailed')}</Alert>, true);
    }
    if (!Array.isArray(result.candidates)) {
      // Searches from before REV-29 imported automatically and kept no candidate list
      return renderReviewNotice(<Alert severity="info">{t('discovery.legacyResult')}</Alert>, true);
    }
    return (
      <DiscoveryReview
        key={status.jobId}
        jobId={status.jobId}
        result={result}
        limit={params.limit}
        onBack={handleChangeSearch}
        searchAgain={renderSearchAgain()}
        searchAgainError={searchAgainError}
      />
    );
  };

  const renderImport = () => {
    if (!importResult) return null;
    const summary = summarizeImport(importResult);
    // Candidates the operator left unselected can still be imported
    const remaining = Array.isArray(status?.result?.candidates) ? importableIds(status.result.candidates).length : 0;
    const stats = [
      { key: 'imported', value: summary.imported, color: 'success.main' },
      { key: 'skipped', value: summary.skipped, color: 'text.primary' },
      { key: 'failed', value: summary.failed, color: summary.failed > 0 ? 'error.main' : 'text.primary' },
    ] as const;

    return (
      <>
        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {searchAgainError && <Alert severity="error">{searchAgainError}</Alert>}
          <Alert severity={summary.failed > 0 ? 'warning' : 'success'}>
            {t('discovery.importDone', { imported: summary.imported })}
            {summary.skipped > 0 && ` ${t('discovery.importSkipped', { skipped: summary.skipped })}`}
            {summary.failed > 0 && ` ${t('discovery.importFailedCount', { failed: summary.failed })}`}
          </Alert>
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
            {stats.map((s) => (
              <Box key={s.key} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography component="dt" variant="caption" color="text.secondary">
                  {t(`discovery.importStats.${s.key}`)}
                </Typography>
                <Typography
                  component="dd"
                  variant="h5"
                  sx={{ m: 0, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}
                >
                  {s.value}
                </Typography>
              </Box>
            ))}
          </Box>
          {summary.imported > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('discovery.importNextHint')}
            </Typography>
          )}
        </Box>
        <DiscoveryDrawerFooter>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {remaining > 0 && (
              <Button onClick={backToReview} color="inherit" sx={{ fontWeight: 600 }}>
                {t('discovery.reviewRemaining', { count: remaining })}
              </Button>
            )}
            {renderSearchAgain()}
            <Button onClick={handleChangeSearch} color="inherit" startIcon={<SearchIcon />} sx={{ fontWeight: 600 }}>
              {t('discovery.newSearch')}
            </Button>
          </Box>
          <Button variant="contained" onClick={close} sx={{ px: 3 }}>
            {t('discovery.done')}
          </Button>
        </DiscoveryDrawerFooter>
      </>
    );
  };

  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={close}
      // The focus trap takes focus while the drawer slides in, so the form's first field gets it once it has
      SlideProps={{ onEntered: () => locationRef.current?.focus() }}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': TITLE_ID,
        sx: {
          width: { xs: '100%', sm: 600 },
          display: 'flex',
          flexDirection: 'column',
          borderRight: 'none',
          borderLeft: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      {/* Header: the title, "Run in background" while a search runs, and close */}
      <Box
        sx={{
          flexShrink: 0,
          height: 64,
          px: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography id={TITLE_ID} variant="h6" component="h2" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>
          {t('discovery.title')}
        </Typography>
        {activeJobId && !finished && !statusQuery.isError && (
          <Button onClick={close} color="inherit" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            {t('discovery.runInBackground')}
          </Button>
        )}
        <IconButton onClick={close} aria-label={t('discovery.close')} edge="end">
          <CloseIcon />
        </IconButton>
      </Box>

      <Stepper
        activeStep={stepIndex}
        aria-label={t('discovery.stepsLabel')}
        sx={{ flexShrink: 0, px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {DISCOVERY_STEPS.map((s, idx) => (
          <Step key={s} completed={idx < stepIndex}>
            <StepLabel aria-current={idx === stepIndex ? 'step' : undefined}>{t(`discovery.steps.${s}`)}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {step !== 'where' && status && renderSearchBar(status)}

      {step === 'where' && renderWhere()}
      {step === 'review' && renderReview()}
      {step === 'import' && renderImport()}
    </Drawer>
  );
};
