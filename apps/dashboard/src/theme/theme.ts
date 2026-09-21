import { createTheme, Theme } from '@mui/material/styles';

export const getTheme = (mode: 'light' | 'dark' = 'light'): Theme => {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? '#6366F1' : '#4F46E5', // Indigo 500 in dark, Indigo 600 in light
        light: '#818CF8',
        dark: '#3730A3',
        contrastText: '#FFFFFF',
      },
      secondary: {
        main: '#06B6D4', // Cyan 500
        light: '#22D3EE',
        dark: '#0891B2',
        contrastText: '#FFFFFF',
      },
      background: {
        default: isDark ? '#0B0F19' : '#F8FAFC', // Slate 950 vs Slate 50
        paper: isDark ? '#111827' : '#FFFFFF',   // Gray 900 vs White
      },
      text: {
        primary: isDark ? '#F9FAFB' : '#0F172A',
        secondary: isDark ? '#9CA3AF' : '#64748B',
      },
      success: {
        main: '#10B981',
        light: isDark ? 'rgba(16, 185, 129, 0.15)' : '#D1FAE5',
      },
      warning: {
        main: '#F59E0B',
        light: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7',
      },
      error: {
        main: '#EF4444',
        light: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
      },
      divider: isDark ? '#1F2937' : '#E2E8F0',
    },
    typography: {
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      h4: {
        fontWeight: 700,
        letterSpacing: '-0.02em',
      },
      h5: {
        fontWeight: 600,
        letterSpacing: '-0.01em',
      },
      h6: {
        fontWeight: 600,
      },
      subtitle1: {
        fontWeight: 500,
      },
      body1: {
        fontSize: '0.925rem',
        lineHeight: 1.5,
      },
      body2: {
        fontSize: '0.85rem',
        lineHeight: 1.4,
      },
      button: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
    shape: {
      borderRadius: 12, // 12px border radius as specified in SRS and Design Guidelines
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            border: isDark ? '1px solid #1F2937' : '1px solid #E2E8F0',
            boxShadow: isDark
              ? '0 1px 3px 0 rgba(0, 0, 0, 0.37)'
              : '0 1px 3px 0 rgb(0 0 0 / 0.05)',
            backgroundImage: 'none',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundImage: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            border: isDark ? '1px solid #1F2937' : '1px solid #E2E8F0',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
          },
        },
      },
    },
  });
};

export const theme = getTheme('light');
