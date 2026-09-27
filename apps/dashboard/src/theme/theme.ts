import type { CSSProperties } from 'react';
import { alpha, createTheme, Theme } from '@mui/material/styles';
import { beBY, enUS, plPL, ruRU } from '@mui/material/locale';
import { beBY as gridBeBY, enUS as gridEnUS, plPL as gridPlPL, ruRU as gridRuRU } from '@mui/x-data-grid/locales';
import type {} from '@mui/x-data-grid/themeAugmentation';
import type { AppLanguage } from '../i18n/languages.js';
import type { ThemeMode } from '../store/useThemeStore.js';

/** Pipeline stages with their own color: the Kanban columns and the lead statuses grouped under them */
export const STAGES = ['queued', 'needs_approval', 'scheduled', 'sent', 'opened', 'clicked', 'engaged', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];

declare module '@mui/material/styles' {
  interface Palette {
    border: { subtle: string; strong: string };
    surface: { sunken: string; raised: string };
    stage: Record<Stage, string>;
  }
  interface PaletteOptions {
    border?: { subtle: string; strong: string };
    surface?: { sunken: string; raised: string };
    stage?: Record<Stage, string>;
  }
  interface PaletteColor {
    /** Low-contrast tint of `main`, the background for chips, badges and icon tiles */
    soft: string;
  }
  interface SimplePaletteColorOptions {
    soft?: string;
  }
  interface TypographyVariants {
    metric: CSSProperties;
  }
  interface TypographyVariantsOptions {
    metric?: CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    metric: true;
  }
}

type Tone = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

export interface ThemeTokens {
  background: { default: string; paper: string };
  surface: { sunken: string; raised: string };
  border: { subtle: string; strong: string };
  text: { primary: string; secondary: string; disabled: string };
  /** `main` of each semantic color; every one meets WCAG AA as text on the backgrounds */
  tones: Record<Tone, string>;
  /** Text on a filled `main` background */
  onTone: Record<Tone, string>;
  stage: Record<Stage, string>;
  /** Opacity of the `soft` tints */
  softAlpha: number;
}

/**
 * Hyperliquid-inspired tokens (REV-49): a deep teal/near-black base with one mint accent in dark mode,
 * and the same hues darkened on near-white surfaces in light mode.
 */
export const TOKENS: Record<ThemeMode, ThemeTokens> = {
  dark: {
    background: { default: '#0B1418', paper: '#0F1A1F' },
    surface: { sunken: '#0B1418', raised: '#15242A' },
    border: { subtle: '#1C2D33', strong: '#2A4048' },
    text: { primary: '#E6EEED', secondary: '#8FA5A8', disabled: '#5A6F73' },
    tones: {
      primary: '#97FCE4',
      secondary: '#B69CFF',
      success: '#3DDC97',
      warning: '#F5B94F',
      error: '#F4707E',
      info: '#6BB8FF',
    },
    onTone: {
      primary: '#04110E',
      secondary: '#0B0620',
      success: '#04110E',
      warning: '#1A1000',
      error: '#1A0306',
      info: '#021120',
    },
    stage: {
      queued: '#8FA5A8',
      needs_approval: '#F5B94F',
      scheduled: '#97FCE4',
      sent: '#6BB8FF',
      opened: '#B69CFF',
      clicked: '#3DDC97',
      engaged: '#FF8FC7',
      rejected: '#F4707E',
    },
    softAlpha: 0.14,
  },
  light: {
    background: { default: '#F3F6F6', paper: '#FFFFFF' },
    surface: { sunken: '#F3F6F6', raised: '#F7FAFA' },
    border: { subtle: '#DCE5E6', strong: '#B9C8CA' },
    text: { primary: '#0B1B20', secondary: '#4E6469', disabled: '#8A9A9D' },
    tones: {
      primary: '#0A7563',
      secondary: '#6B4FD1',
      success: '#0A7650',
      warning: '#935700',
      error: '#B5243A',
      info: '#1A67B8',
    },
    onTone: {
      primary: '#FFFFFF',
      secondary: '#FFFFFF',
      success: '#FFFFFF',
      warning: '#FFFFFF',
      error: '#FFFFFF',
      info: '#FFFFFF',
    },
    stage: {
      queued: '#4E6469',
      needs_approval: '#935700',
      scheduled: '#0A7563',
      sent: '#1A67B8',
      opened: '#6B4FD1',
      clicked: '#0A7650',
      engaged: '#A82A6F',
      rejected: '#B5243A',
    },
    softAlpha: 0.1,
  },
};

/** Corner radii in px: flat, dense shapes instead of the stock rounded MUI look */
export const RADIUS = { sm: 4, md: 6, lg: 8, xl: 10 } as const;

const TONES: Tone[] = ['primary', 'secondary', 'success', 'warning', 'error', 'info'];

// MUI ships no Lithuanian locale, so its built-in component texts stay English there
const MUI_LOCALES: Record<AppLanguage, [typeof enUS, typeof gridEnUS]> = {
  en: [enUS, gridEnUS],
  ru: [ruRU, gridRuRU],
  be: [beBY, gridBeBY],
  pl: [plPL, gridPlPL],
  lt: [enUS, gridEnUS],
};

export const getTheme = (mode: ThemeMode = 'light', language: AppLanguage = 'en'): Theme => {
  const tk = TOKENS[mode];
  const isDark = mode === 'dark';
  const tone = (name: Tone) => ({
    main: tk.tones[name],
    contrastText: tk.onTone[name],
    soft: alpha(tk.tones[name], tk.softAlpha),
  });
  const hairline = `1px solid ${tk.border.subtle}`;

  return createTheme(
    {
      palette: {
        mode,
        ...(Object.fromEntries(TONES.map((name) => [name, tone(name)])) as Record<Tone, ReturnType<typeof tone>>),
        background: tk.background,
        surface: tk.surface,
        border: tk.border,
        text: tk.text,
        stage: tk.stage,
        divider: tk.border.subtle,
        action: {
          hover: alpha(tk.text.primary, isDark ? 0.05 : 0.04),
          selected: alpha(tk.tones.primary, isDark ? 0.12 : 0.08),
          focus: alpha(tk.tones.primary, 0.2),
        },
      },
      shape: { borderRadius: RADIUS.md },
      typography: {
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeightBold: 600,
        h4: { fontWeight: 600, letterSpacing: '-0.02em' },
        h5: { fontWeight: 600, letterSpacing: '-0.01em' },
        h6: { fontWeight: 600, fontSize: '1.05rem', letterSpacing: '-0.01em' },
        subtitle1: { fontWeight: 600, fontSize: '0.95rem' },
        subtitle2: { fontWeight: 600, fontSize: '0.85rem' },
        body1: { fontSize: '0.9rem', lineHeight: 1.5 },
        body2: { fontSize: '0.8125rem', lineHeight: 1.45 },
        caption: { fontSize: '0.75rem', lineHeight: 1.4 },
        overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', lineHeight: 1.5 },
        button: { textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem' },
        metric: {
          fontSize: '1.75rem',
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              // Numbers line up in tables, cards and counters
              fontVariantNumeric: 'tabular-nums',
              scrollbarColor: `${tk.border.strong} transparent`,
            },
            '::selection': { backgroundColor: alpha(tk.tones.primary, 0.3) },
          },
        },
        MuiTypography: {
          defaultProps: { variantMapping: { metric: 'div' } },
        },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: {
            root: { borderRadius: RADIUS.md, padding: '6px 14px', lineHeight: 1.5 },
            sizeSmall: { padding: '3px 10px', fontSize: '0.75rem' },
          },
        },
        MuiIconButton: {
          styleOverrides: { root: { borderRadius: RADIUS.md } },
        },
        MuiTextField: { defaultProps: { size: 'small' } },
        MuiFormControl: { defaultProps: { size: 'small' } },
        MuiSelect: { defaultProps: { size: 'small' } },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: RADIUS.md,
              backgroundColor: tk.surface.sunken,
              '& .MuiOutlinedInput-notchedOutline': { borderColor: tk.border.strong },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tk.text.secondary },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: tk.tones.primary },
              '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: tk.tones.error },
            },
          },
        },
        MuiInputLabel: {
          styleOverrides: { root: { '&.Mui-focused': { color: tk.tones.primary } } },
        },
        MuiMenu: {
          styleOverrides: { paper: { border: hairline, backgroundColor: tk.surface.raised } },
        },
        MuiPopover: {
          styleOverrides: { paper: { border: hairline } },
        },
        MuiMenuItem: {
          styleOverrides: { root: { fontSize: '0.8125rem', minHeight: 34 } },
        },
        MuiChip: {
          styleOverrides: {
            root: ({ ownerState, theme }) => {
              const color = ownerState.color;
              const isTone = color !== undefined && color !== 'default';
              return {
                borderRadius: RADIUS.sm,
                fontWeight: 600,
                // Filled chips are tinted instead of solid, so status colors stay readable side by side
                ...(ownerState.variant !== 'outlined' &&
                  isTone && {
                    backgroundColor: theme.palette[color].soft,
                    color: theme.palette[color].main,
                    '& .MuiChip-icon': { color: 'inherit' },
                    '&.MuiChip-clickable:hover': { backgroundColor: alpha(theme.palette[color].main, tk.softAlpha * 1.6) },
                  }),
                ...(ownerState.variant !== 'outlined' &&
                  !isTone && { backgroundColor: alpha(tk.text.primary, isDark ? 0.08 : 0.06) }),
                ...(ownerState.variant === 'outlined' &&
                  isTone && { borderColor: alpha(theme.palette[color].main, 0.45) }),
                ...(ownerState.variant === 'outlined' && !isTone && { borderColor: tk.border.strong }),
              };
            },
            sizeSmall: { height: 22, fontSize: '0.72rem' },
            label: { paddingLeft: 8, paddingRight: 8 },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: { backgroundImage: 'none' },
            rounded: { borderRadius: RADIUS.lg },
          },
        },
        MuiCard: {
          defaultProps: { elevation: 0 },
          styleOverrides: {
            root: { borderRadius: RADIUS.lg, border: hairline, backgroundImage: 'none' },
          },
        },
        MuiCardContent: {
          styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } },
        },
        MuiDialog: {
          styleOverrides: {
            paper: { borderRadius: RADIUS.xl, border: hairline, boxShadow: `0 24px 64px ${alpha('#000000', isDark ? 0.6 : 0.18)}` },
          },
        },
        MuiBackdrop: {
          styleOverrides: {
            root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: alpha('#02080A', isDark ? 0.72 : 0.45) } },
          },
        },
        MuiDialogTitle: {
          styleOverrides: { root: { fontSize: '1rem', fontWeight: 600 } },
        },
        MuiTabs: {
          styleOverrides: {
            root: { minHeight: 38 },
            indicator: { height: 2, backgroundColor: tk.tones.primary },
          },
        },
        MuiTab: {
          styleOverrides: {
            root: {
              minHeight: 38,
              padding: '8px 14px',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.8125rem',
              color: tk.text.secondary,
              '&.Mui-selected': { color: tk.text.primary },
            },
          },
        },
        MuiTooltip: {
          styleOverrides: {
            tooltip: {
              backgroundColor: isDark ? tk.surface.raised : tk.text.primary,
              color: isDark ? tk.text.primary : tk.background.paper,
              border: isDark ? `1px solid ${tk.border.strong}` : 'none',
              borderRadius: RADIUS.sm,
              fontSize: '0.75rem',
              fontWeight: 500,
              padding: '6px 10px',
            },
          },
        },
        MuiDrawer: {
          styleOverrides: {
            paper: { backgroundColor: tk.background.paper, borderRight: hairline },
          },
        },
        MuiAppBar: {
          defaultProps: { elevation: 0, color: 'inherit' },
          styleOverrides: {
            root: { backgroundColor: tk.background.paper, borderBottom: hairline, backgroundImage: 'none' },
          },
        },
        MuiListItemButton: {
          styleOverrides: {
            root: {
              borderRadius: RADIUS.md,
              color: tk.text.secondary,
              '& .MuiListItemIcon-root': { color: 'inherit' },
              '&:hover': { color: tk.text.primary },
              '&.Mui-selected': {
                backgroundColor: alpha(tk.tones.primary, tk.softAlpha),
                color: tk.tones.primary,
                '&:hover': { backgroundColor: alpha(tk.tones.primary, tk.softAlpha * 1.4) },
              },
            },
          },
        },
        MuiToggleButtonGroup: {
          styleOverrides: {
            root: { backgroundColor: tk.surface.sunken, border: hairline, borderRadius: RADIUS.md, padding: 2, gap: 2 },
            grouped: { border: 0, borderRadius: `${RADIUS.sm}px !important` },
          },
        },
        MuiToggleButton: {
          styleOverrides: {
            root: {
              border: 0,
              padding: '4px 10px',
              textTransform: 'none',
              fontWeight: 600,
              color: tk.text.secondary,
              '&.Mui-selected, &.Mui-selected:hover': {
                backgroundColor: tk.surface.raised,
                color: tk.tones.primary,
                boxShadow: `inset 0 0 0 1px ${tk.border.strong}`,
              },
            },
          },
        },
        MuiAlert: {
          styleOverrides: {
            root: ({ ownerState, theme }) => {
              const severity = ownerState.severity ?? 'success';
              return {
                borderRadius: RADIUS.md,
                fontSize: '0.8125rem',
                ...(ownerState.variant === 'standard' && {
                  backgroundColor: theme.palette[severity].soft,
                  color: tk.text.primary,
                  border: `1px solid ${alpha(theme.palette[severity].main, 0.35)}`,
                  '& .MuiAlert-icon': { color: theme.palette[severity].main },
                }),
              };
            },
          },
        },
        MuiLinearProgress: {
          styleOverrides: {
            root: { borderRadius: RADIUS.sm, backgroundColor: alpha(tk.tones.primary, tk.softAlpha) },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            root: { borderBottom: hairline, fontSize: '0.8125rem' },
            head: { color: tk.text.secondary, fontWeight: 600, backgroundColor: tk.surface.sunken },
          },
        },
        MuiDataGrid: {
          defaultProps: { columnHeaderHeight: 40 },
          styleOverrides: {
            root: {
              border: hairline,
              borderRadius: RADIUS.lg,
              backgroundColor: tk.background.paper,
              '--DataGrid-containerBackground': tk.surface.sunken,
              '--DataGrid-rowBorderColor': tk.border.subtle,
            },
            columnHeader: {
              color: tk.text.secondary,
              fontSize: '0.72rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              '&:focus, &:focus-within': { outline: 'none' },
            },
            columnHeaderTitle: { fontWeight: 600 },
            columnSeparator: { color: tk.border.subtle },
            row: {
              '&:hover': { backgroundColor: alpha(tk.text.primary, isDark ? 0.03 : 0.025) },
            },
            cell: {
              display: 'flex',
              alignItems: 'center',
              '&:focus, &:focus-within': { outline: 'none' },
            },
            footerContainer: { borderTop: hairline, minHeight: 44 },
          },
        },
      },
    },
    ...MUI_LOCALES[language],
  );
};

export const theme = getTheme('light');
