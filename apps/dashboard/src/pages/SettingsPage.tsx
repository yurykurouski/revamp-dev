import React from 'react';
import {
  Box,
  Card,
  Chip,
  FormControl,
  MenuItem,
  Select,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useTranslation } from 'react-i18next';
import { useThemeStore, ThemeMode } from '../store/useThemeStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { useLlmProvidersQuery } from '../hooks/useLeads.js';
import { LlmModelSelect } from '../components/LlmModelSelect.js';
import { AppLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/languages.js';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Card component="section" aria-label={title}>
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="overline" component="h2" color="text.secondary">
        {title}
      </Typography>
    </Box>
    {children}
  </Card>
);

const Row: React.FC<{ label: string; hint?: string; labelId?: string; children: React.ReactNode }> = ({
  label,
  hint,
  labelId,
  children,
}) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: { xs: 'column', sm: 'row' },
      justifyContent: 'space-between',
      alignItems: { xs: 'stretch', sm: 'center' },
      gap: { xs: 1.5, sm: 3 },
      px: 2.5,
      py: 2,
      borderTop: '1px solid',
      borderColor: 'divider',
    }}
  >
    <Box sx={{ minWidth: 0 }}>
      <Typography id={labelId} variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
    <Box sx={{ flexShrink: 0, width: { xs: '100%', sm: 280 } }}>{children}</Box>
  </Box>
);

/** What the workers report for each LLM provider (REV-32) */
const WorkerStatus: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useLlmProvidersQuery();

  if (isLoading) return <Skeleton variant="rounded" height={24} />;
  if (isError || !data?.workersOnline) {
    return <Chip size="small" label={t('llm.reasons.workers_offline')} />;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {data.providers.map((provider) => (
        <Chip
          key={provider.id}
          size="small"
          color={provider.available ? 'success' : 'default'}
          label={
            provider.available
              ? t('settings.providerReady', { name: provider.label })
              : t('settings.providerUnavailable', {
                  name: provider.label,
                  reason: t(`llm.reasons.${provider.reason ?? 'workers_offline'}`),
                })
          }
        />
      ))}
    </Box>
  );
};

/**
 * Settings (REV-76): appearance (theme, interface language) and the default LLM for new MVPs. Every
 * control writes straight to its store, so there is nothing to save.
 */
export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Box sx={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box>
          <Typography variant="h5" component="h1">
            {t('settings.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('settings.subtitle')}
          </Typography>
        </Box>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')} labelId="settings-theme-label">
            <ToggleButtonGroup
              value={mode}
              exclusive
              fullWidth
              size="small"
              onChange={(_e, next: ThemeMode | null) => next && setTheme(next)}
              aria-labelledby="settings-theme-label"
            >
              <ToggleButton value="dark" sx={{ gap: 0.75 }}>
                <DarkModeIcon sx={{ fontSize: 18 }} />
                {t('settings.dark')}
              </ToggleButton>
              <ToggleButton value="light" sx={{ gap: 0.75 }}>
                <LightModeIcon sx={{ fontSize: 18 }} />
                {t('settings.light')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Row>
          <Row label={t('language.label')} hint={t('settings.languageHint')} labelId="settings-language-label">
            <FormControl fullWidth size="small">
              <Select
                labelId="settings-language-label"
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              >
                {SUPPORTED_LANGUAGES.map((code) => (
                  <MenuItem key={code} value={code} lang={code}>
                    {LANGUAGE_NAMES[code]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Row>
        </Section>

        <Section title={t('settings.aiGeneration')}>
          <Row label={t('settings.defaultModel')} hint={t('settings.defaultModelHint')}>
            <LlmModelSelect showOfflineNotice={false} />
          </Row>
          <Row label={t('settings.workers')}>
            <WorkerStatus />
          </Row>
        </Section>
      </Box>
    </Box>
  );
};
