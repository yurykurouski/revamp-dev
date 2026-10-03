import React from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { REBUILD_LEVELS, RebuildLevel } from '@revamp/shared-types';

interface MvpRebuildLevelToggleProps {
  value: RebuildLevel;
  onChange: (level: RebuildLevel) => void;
  disabled?: boolean;
  /** Why the toggle is disabled, shown as its tooltip */
  disabledReason?: string;
  /** Why the page is at the modern level: the site looks dated, or the model's design was replaced by the default */
  reason?: 'suggested' | 'defaultDesign';
}

/**
 * Switches the rebuilt original site between the faithful rebuild and the modernized look (REV-114).
 * Shown in the Design tools only while the layout is the original; the page is re-rendered after a pick.
 */
export const MvpRebuildLevelToggle: React.FC<MvpRebuildLevelToggleProps> = ({
  value,
  onChange,
  disabled,
  disabledReason,
  reason,
}) => {
  const { t } = useTranslation();

  const group = (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      disabled={disabled}
      aria-label={t('mvpLayout.level.label')}
      onChange={(_event, next: RebuildLevel | null) => {
        // A click on the selected level would clear the group; a rebuild always has a level
        if (next && next !== value) onChange(next);
      }}
    >
      {REBUILD_LEVELS.map((level) => (
        <ToggleButton
          key={level}
          value={level}
          sx={{ px: 1.25, py: 0.25, fontSize: '0.75rem', fontWeight: 600, textTransform: 'none' }}
        >
          {t(`mvpLayout.level.${level}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  return (
    <Box
      data-testid="mvp-rebuild-level"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 1.5,
        backgroundColor: 'background.paper',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {t('mvpLayout.level.label')}:
        </Typography>
        {disabled && disabledReason ? (
          <Tooltip title={disabledReason}>
            <span>{group}</span>
          </Tooltip>
        ) : (
          group
        )}
      </Box>
      {reason && (
        <Typography variant="caption" color="text.secondary">
          {t(`mvpLayout.level.${reason}`)}
        </Typography>
      )}
    </Box>
  );
};
