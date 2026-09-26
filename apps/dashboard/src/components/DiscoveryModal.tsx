import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Alert,
  Chip,
  CircularProgress,
  InputAdornment,
  LinearProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SearchIcon from '@mui/icons-material/Search';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { DiscoveryProvider, NicheType } from '@revamp/shared-types';
import { useTranslation } from 'react-i18next';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import {
  detectLocation,
  LocationDetectError,
  discoveryStateBucket,
  isDiscoveryFinished,
  useDiscoveryStatusQuery,
  useStartDiscoveryMutation,
  validateDiscoveryForm,
} from '../hooks/useDiscovery.js';
import { NICHES, NICHE_EMOJI, isDashboardNiche } from '../i18n/niches.js';
import { DiscoveryReview } from './DiscoveryReview.js';

const PROVIDERS: DiscoveryProvider[] = ['osm', 'google'];

const STATE_CHIP_COLOR = {
  queued: 'default',
  running: 'info',
  completed: 'success',
  failed: 'error',
} as const;

export const DiscoveryModal: React.FC = () => {
  const { isOpen, close, activeJobId, setActiveJob, startNewSearch } = useDiscoveryStore();
  const startMutation = useStartDiscoveryMutation();
  const statusQuery = useDiscoveryStatusQuery(activeJobId);
  const { t, i18n } = useTranslation();

  const [provider, setProvider] = useState<DiscoveryProvider>('osm');
  const [niche, setNiche] = useState<NicheType>('dental');
  const [location, setLocation] = useState('');
  const [keyword, setKeyword] = useState('');
  const [limit, setLimit] = useState('20');
  const [formError, setFormError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  const status = statusQuery.data;
  const finished = isDiscoveryFinished(status);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateDiscoveryForm({
      provider,
      niche,
      location,
      keyword: keyword.trim() || undefined,
      // Empty falls back to the schema default; anything non-numeric fails validation as NaN
      limit: limit.trim() === '' ? undefined : Number(limit),
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
      setLocation(await detectLocation(i18n.language));
    } catch (err: unknown) {
      setFormError(t(err instanceof LocationDetectError ? err.errorKey : 'discovery.errors.geoLookupFailed'));
    } finally {
      setIsDetecting(false);
    }
  };

  const handleNewSearch = () => {
    setFormError(null);
    startNewSearch();
  };

  const renderForm = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
      <FormControl fullWidth disabled={startMutation.isPending}>
        <InputLabel id="discovery-provider-label">{t('discovery.providerLabel')}</InputLabel>
        <Select
          labelId="discovery-provider-label"
          label={t('discovery.providerLabel')}
          value={provider}
          onChange={(e) => setProvider(e.target.value as DiscoveryProvider)}
        >
          {PROVIDERS.map((p) => (
            <MenuItem key={p} value={p}>
              {t(`discovery.providers.${p}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth disabled={startMutation.isPending}>
        <InputLabel id="discovery-niche-label">{t('addLead.nicheLabel')}</InputLabel>
        <Select
          labelId="discovery-niche-label"
          label={t('addLead.nicheLabel')}
          value={niche}
          onChange={(e) => setNiche(e.target.value as NicheType)}
        >
          {NICHES.map((n) => (
            <MenuItem key={n} value={n}>
              {NICHE_EMOJI[n]} {t(`nichesDetailed.${n}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        label={t('discovery.locationLabel')}
        placeholder={t('discovery.locationPlaceholder')}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        fullWidth
        required
        autoFocus
        disabled={startMutation.isPending || isDetecting}
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
                    disabled={startMutation.isPending || isDetecting}
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

      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <TextField
          label={t('discovery.keywordLabel')}
          placeholder={t('discovery.keywordPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          fullWidth
          required={niche === 'other'}
          disabled={startMutation.isPending}
          helperText={niche === 'other' ? t('discovery.keywordRequiredHelper') : t('discovery.keywordHelper')}
        />
        <TextField
          label={t('discovery.limitLabel')}
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          disabled={startMutation.isPending}
          inputProps={{ min: 1, max: 100 }}
          helperText={t('discovery.limitHelper')}
          sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
        />
      </Box>
    </Box>
  );

  const renderStatus = () => {
    if (statusQuery.isError) {
      return (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {statusQuery.error instanceof Error ? statusQuery.error.message : t('discovery.errors.statusFailed')}
        </Alert>
      );
    }
    if (!status) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      );
    }

    const bucket = discoveryStateBucket(status.state);
    const { params, result } = status;

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Chip label={t(`discovery.states.${bucket}`)} color={STATE_CHIP_COLOR[bucket]} size="small" sx={{ fontWeight: 600 }} />
          <Typography variant="body2" color="text.secondary">
            {t('discovery.searchSummary', {
              what: params.keyword ?? (isDashboardNiche(params.niche) ? t(`nichesPlural.${params.niche}`) : params.niche),
              location: params.location,
              provider: t(`discovery.providers.${params.provider}`),
            })}
          </Typography>
        </Box>

        {!finished && (
          <Box>
            <LinearProgress sx={{ borderRadius: 1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t('discovery.runningHint')}
            </Typography>
          </Box>
        )}

        {bucket === 'failed' && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {status.error ?? t('discovery.errors.statusFailed')}
          </Alert>
        )}

        {bucket === 'completed' &&
          result &&
          (Array.isArray(result.candidates) ? (
            <DiscoveryReview key={status.jobId} jobId={status.jobId} candidates={result.candidates} />
          ) : (
            // Searches from before REV-29 imported automatically and kept no candidate list
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              {t('discovery.legacyResult')}
            </Alert>
          ))}
      </Box>
    );
  };

  const showStatus = Boolean(activeJobId);

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      // The review table needs more room than the search form
      maxWidth={status?.state === 'completed' && showStatus ? 'md' : 'sm'}
      fullWidth
      PaperProps={{ sx: { p: 1 } }}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: '10px',
              backgroundColor: 'primary.light',
              color: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TravelExploreIcon />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {t('discovery.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('discovery.subtitle')}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 2 }}>
          {formError && !showStatus && (
            <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>
              {formError}
            </Alert>
          )}
          {showStatus ? renderStatus() : renderForm()}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={close} color="inherit" sx={{ fontWeight: 600 }}>
            {showStatus && !finished ? t('discovery.runInBackground') : t('addLead.cancel')}
          </Button>
          {/* Distinct keys: reusing the DOM node would turn the clicked "New search" into a submit button mid-click */}
          {showStatus ? (
            (finished || statusQuery.isError) && (
              <Button key="new-search" variant="contained" onClick={handleNewSearch} startIcon={<SearchIcon />} sx={{ px: 2.5, py: 1, fontWeight: 700 }}>
                {t('discovery.newSearch')}
              </Button>
            )
          ) : (
            <Button
              key="submit"
              type="submit"
              variant="contained"
              disabled={startMutation.isPending}
              startIcon={startMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
              sx={{ px: 2.5, py: 1, fontWeight: 700 }}
            >
              {startMutation.isPending ? t('discovery.starting') : t('discovery.start')}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
};
