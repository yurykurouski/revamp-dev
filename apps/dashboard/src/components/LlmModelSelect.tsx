import React from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Skeleton,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LlmProviderId } from '@revamp/shared-types';
import { useLlmProvidersQuery } from '../hooks/useLeads.js';
import { useLlmChoiceStore } from '../store/useLlmChoiceStore.js';
import { describeLlm, effectiveLlmChoice } from '../utils/llmChoice.js';

const SERVER_DEFAULT = '__default__';

/**
 * Provider and model picker for MVP generation (REV-32). Options the workers can't run are
 * disabled with the reason; the choice is remembered in the Zustand store.
 */
interface LlmModelSelectProps {
  /** Explains that the workers are offline; Settings shows that in its own Workers row (REV-76) */
  showOfflineNotice?: boolean;
}

export const LlmModelSelect: React.FC<LlmModelSelectProps> = ({ showOfflineNotice = true }) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useLlmProvidersQuery();
  const choice = useLlmChoiceStore();

  if (isLoading) return <Skeleton variant="rounded" height={56} />;

  // A remembered choice the workers can no longer run shows as the server default
  const effective = effectiveLlmChoice(choice, data);
  const providerValue = effective.provider ?? SERVER_DEFAULT;
  const selected = data?.providers.find((p) => p.id === effective.provider);
  const defaultLabel = data?.defaultProvider
    ? t('llm.serverDefault', { name: describeLlm(data.defaultProvider, data.defaultModel) })
    : t('llm.serverDefaultUnknown');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {showOfflineNotice && (isError || (data && !data.workersOnline)) && (
        <Alert severity="info">
          {t('llm.workersOffline')}
        </Alert>
      )}

      <FormControl fullWidth size="small">
        <InputLabel id="llm-provider-label">{t('llm.provider')}</InputLabel>
        <Select
          labelId="llm-provider-label"
          label={t('llm.provider')}
          value={providerValue}
          onChange={(event) => {
            const value = event.target.value;
            choice.setProvider(value === SERVER_DEFAULT ? null : (value as LlmProviderId));
          }}
          renderValue={(value) =>
            value === SERVER_DEFAULT ? defaultLabel : data?.providers.find((p) => p.id === value)?.label ?? value
          }
        >
          <MenuItem value={SERVER_DEFAULT}>
            <ListItemText primary={defaultLabel} />
          </MenuItem>
          {data?.providers.map((provider) => (
            <MenuItem key={provider.id} value={provider.id} disabled={!provider.available}>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    {provider.label}
                    {provider.local && <Chip label={t('llm.local')} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />}
                  </Box>
                }
                secondary={provider.available ? undefined : t(`llm.reasons.${provider.reason ?? 'workers_offline'}`)}
              />
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth size="small" disabled={!selected}>
        <InputLabel id="llm-model-label">{t('llm.model')}</InputLabel>
        <Select
          labelId="llm-model-label"
          label={t('llm.model')}
          value={selected ? effective.model ?? selected.defaultModel : ''}
          onChange={(event) => choice.setModel(String(event.target.value))}
        >
          {selected?.models.map((model) => (
            <MenuItem key={model.id} value={model.id}>
              {model.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};
