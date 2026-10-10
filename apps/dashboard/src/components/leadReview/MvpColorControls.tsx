import React, { useState } from 'react';
import { Box, Button, ButtonBase, TextField, Tooltip, Typography } from '@mui/material';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import { useTranslation } from 'react-i18next';
import { MVP_MIN_CONTRAST } from '@revamp/shared-types';
import { colorContrast, MVP_COLOR_ROLES, MvpColorRole, MvpColors } from '../../utils/mvpPage.js';

interface MvpColorControlsProps {
  /** The colors the page shows now: the operator's saved colors over the page's theme */
  seed: MvpColors;
  /** The operator saved colors of their own, which can be dropped */
  saved: boolean;
  /** The original site's brand colors, offered first */
  brand: string[];
  disabled: boolean;
  onApply: (colors: MvpColors) => void;
  onReset: () => void;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A square showing a stored color itself, not a theme token */
const Swatch: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
  <Box
    aria-hidden
    sx={{
      width: size,
      height: size,
      borderRadius: 1,
      flexShrink: 0,
      border: '1px solid',
      borderColor: 'border.strong',
      backgroundColor: HEX.test(color) ? color : 'transparent',
    }}
  />
);

/**
 * The page's five colors (REV-140), part of the Design tools panel. A color is picked per role, the original's brand
 * colors first; the text's contrast on the background and the surface is checked as the operator picks, and Apply
 * publishes the five together only when both reach AA. No model is called.
 */
export const MvpColorControls: React.FC<MvpColorControlsProps> = ({ seed, saved, brand, disabled, onApply, onReset }) => {
  const { t } = useTranslation();
  const [role, setRole] = useState<MvpColorRole>('primary');
  const [draft, setDraft] = useState<MvpColors>(seed);
  // A new page or a saved change starts the draft again
  const seedKey = MVP_COLOR_ROLES.map((r) => seed[r]).join('|');
  const [syncedKey, setSyncedKey] = useState(seedKey);
  if (syncedKey !== seedKey) {
    setSyncedKey(seedKey);
    setDraft(seed);
  }

  const set = (value: string) => setDraft((current) => ({ ...current, [role]: value.trim().toLowerCase() }));
  const contrast = colorContrast(draft);
  const changed = MVP_COLOR_ROLES.some((r) => draft[r] !== seed[r]);

  return (
    <Box data-testid="mvp-color-controls" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <PaletteOutlinedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {t('mvpPage.colors.title')}
        </Typography>
      </Box>
      <Box role="group" aria-label={t('mvpPage.colors.title')} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {MVP_COLOR_ROLES.map((r) => (
          <Button
            key={r}
            size="small"
            variant={r === role ? 'contained' : 'outlined'}
            color={r === role ? 'primary' : 'inherit'}
            aria-pressed={r === role}
            disabled={disabled}
            data-testid={`mvp-color-role-${r}`}
            onClick={() => setRole(r)}
            startIcon={<Swatch color={draft[r]} size={14} />}
            sx={{ textTransform: 'none', px: 1, minWidth: 0 }}
          >
            {t(`mvpPage.colors.roles.${r}`)}
          </Button>
        ))}
      </Box>
      {brand.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            {t('mvpPage.colors.brand')}
          </Typography>
          {brand.map((color, index) => (
            <Tooltip key={color} title={color}>
              <span>
                <ButtonBase
                  aria-label={color}
                  disabled={disabled}
                  data-testid={`mvp-brand-color-${index}`}
                  onClick={() => set(color)}
                  sx={{ borderRadius: 1 }}
                >
                  <Swatch color={color} size={22} />
                </ButtonBase>
              </span>
            </Tooltip>
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          component="input"
          type="color"
          aria-label={t(`mvpPage.colors.roles.${role}`)}
          disabled={disabled}
          value={HEX.test(draft[role]) ? draft[role] : '#000000'}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => set(event.target.value)}
          sx={{ width: 36, height: 32, p: 0, border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
        />
        <TextField
          size="small"
          label={t('mvpPage.colors.hex')}
          value={draft[role]}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
          inputProps={{ maxLength: 7, spellCheck: false }}
          data-testid="mvp-color-hex"
          sx={{ width: 120 }}
        />
      </Box>
      {contrast.valid && (
        <Typography variant="caption" color={contrast.ok ? 'text.secondary' : 'warning.main'} role="status">
          {contrast.ok
            ? t('mvpPage.colors.contrast', { bg: contrast.onBg, surface: contrast.onSurface })
            : t('mvpPage.colors.contrastLow', { min: MVP_MIN_CONTRAST })}
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {saved && (
          <Button size="small" variant="text" color="inherit" disabled={disabled} onClick={onReset} data-testid="mvp-colors-reset" sx={{ mr: 'auto' }}>
            {t('mvpPage.colors.reset')}
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          disabled={disabled || !contrast.ok || !changed}
          onClick={() => onApply(draft)}
          data-testid="mvp-colors-apply"
        >
          {t('mvpPage.colors.apply')}
        </Button>
      </Box>
    </Box>
  );
};
