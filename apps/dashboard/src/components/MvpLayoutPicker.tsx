import React from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import { useTranslation } from 'react-i18next';
import { MVP_LAYOUT_VARIANTS, MvpLayoutVariant } from '@revamp/shared-types';

interface MvpLayoutPickerProps {
  /** The layout shown in the preview; none before an MVP exists */
  value: MvpLayoutVariant | undefined;
  onChange: (variant: MvpLayoutVariant) => void;
  disabled?: boolean;
  /** Why the picker is disabled, shown as its tooltip */
  disabledReason?: string;
}

/**
 * Switches the MVP between its layouts (REV-84). The preview changes live; the same grounded content
 * is only arranged differently, so no generation is started.
 */
export const MvpLayoutPicker: React.FC<MvpLayoutPickerProps> = ({ value, onChange, disabled, disabledReason }) => {
  const { t } = useTranslation();

  const group = (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value ?? null}
      disabled={disabled}
      aria-label={t('mvpLayout.picker')}
      onChange={(_event, next: MvpLayoutVariant | null) => {
        // A click on the selected layout would clear the group; the MVP always has a layout
        if (next && next !== value) onChange(next);
      }}
    >
      {MVP_LAYOUT_VARIANTS.map((variant) => (
        <ToggleButton
          key={variant}
          value={variant}
          title={disabled ? undefined : t(`mvpLayout.descriptions.${variant}`)}
          sx={{ px: 1.25, py: 0.25, fontSize: '0.75rem', fontWeight: 600, textTransform: 'none' }}
        >
          {t(`mvpLayout.variants.${variant}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  return (
    <Box
      data-testid="mvp-layout-picker"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        backgroundColor: 'background.paper',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <DashboardCustomizeIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {t('mvpLayout.picker')}
        </Typography>
      </Box>
      {disabled && disabledReason ? (
        <Tooltip title={disabledReason}>
          <span>{group}</span>
        </Tooltip>
      ) : (
        group
      )}
    </Box>
  );
};
