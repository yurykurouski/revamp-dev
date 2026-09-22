import React from 'react';
import {
  Box,
  Typography,
  Tooltip,
  Button,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

const COLOR_PRESETS = [
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Cyan', hex: '#0891B2' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Amber', hex: '#D97706' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Slate', hex: '#334155' },
];

interface ColorPickerToolbarProps {
  currentPrimary: string;
  originalPrimary?: string;
  onColorChange: (color: string) => void;
  onReset: () => void;
}

export const ColorPickerToolbar: React.FC<ColorPickerToolbarProps> = ({
  currentPrimary,
  originalPrimary,
  onColorChange,
  onReset,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        backgroundColor: 'background.paper',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <PaletteIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
          Палитра бренда:
        </Typography>
      </Box>

      {/* Preset Swatches */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        {COLOR_PRESETS.map((preset) => {
          const isSelected = currentPrimary.toLowerCase() === preset.hex.toLowerCase();
          return (
            <Tooltip key={preset.hex} title={preset.name}>
              <Box
                onClick={() => onColorChange(preset.hex)}
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor: preset.hex,
                  cursor: 'pointer',
                  border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(0,0,0,0.1)',
                  outline: isSelected ? '2px solid' : 'none',
                  outlineColor: preset.hex,
                  transition: 'transform 0.15s ease',
                  '&:hover': {
                    transform: 'scale(1.2)',
                  },
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      {/* Custom Color Native Input */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, ml: 0.5 }}>
        <input
          type="color"
          value={currentPrimary}
          onChange={(e) => onColorChange(e.target.value)}
          id="brand-color-picker-input"
          style={{
            width: 26,
            height: 26,
            padding: 0,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            backgroundColor: 'transparent',
          }}
          title="Выбрать свой HEX цвет"
        />
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            fontWeight: 700,
            color: 'text.secondary',
            textTransform: 'uppercase',
          }}
        >
          {currentPrimary}
        </Typography>
      </Box>

      {/* Reset button if changed */}
      {originalPrimary && originalPrimary.toLowerCase() !== currentPrimary.toLowerCase() && (
        <Tooltip title={`Вернуть исходный цвет (${originalPrimary})`}>
          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<RestartAltIcon sx={{ fontSize: 14 }} />}
            onClick={onReset}
            sx={{ fontSize: '0.75rem', py: 0.2, px: 1, color: 'text.secondary' }}
          >
            Сбросить
          </Button>
        </Tooltip>
      )}
    </Box>
  );
};
