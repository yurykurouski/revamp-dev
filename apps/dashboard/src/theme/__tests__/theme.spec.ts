import { describe, it, expect } from 'vitest';
import { alpha, decomposeColor, getContrastRatio, recomposeColor } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { getTheme, RADIUS, STAGES, TOKENS } from '../theme.js';

const MODES = ['dark', 'light'] as const;
const TONES = ['primary', 'secondary', 'success', 'warning', 'error', 'info'] as const;
const AA_TEXT = 4.5;

/** A translucent color painted over an opaque background, as the browser renders it */
function over(foreground: string, background: string): string {
  const fg = decomposeColor(foreground);
  const bg = decomposeColor(background);
  const a = fg.values[3] ?? 1;
  const values = [0, 1, 2].map((i) => Math.round(fg.values[i] * a + bg.values[i] * (1 - a)));
  return recomposeColor({ type: 'rgb', values: values as [number, number, number] });
}

type StyleFn = (props: { ownerState: Record<string, unknown>; theme: Theme }) => Record<string, unknown>;

describe.each(MODES)('getTheme(%s) (REV-49)', (mode) => {
  const theme = getTheme(mode);
  const tk = TOKENS[mode];
  const { palette } = theme;

  it('exposes the design tokens on the palette', () => {
    expect(palette.mode).toBe(mode);
    expect(palette.background).toMatchObject(tk.background);
    expect(palette.surface).toEqual(tk.surface);
    expect(palette.border).toEqual(tk.border);
    expect(palette.text).toMatchObject(tk.text);
    expect(palette.divider).toBe(tk.border.subtle);
    expect(palette.stage).toEqual(tk.stage);
    for (const tone of TONES) {
      expect(palette[tone].main).toBe(tk.tones[tone]);
      expect(palette[tone].contrastText).toBe(tk.onTone[tone]);
      expect(palette[tone].soft).toBe(alpha(tk.tones[tone], tk.softAlpha));
    }
  });

  it('uses the mint accent in dark mode and a darker teal in light mode', () => {
    expect(palette.primary.main).toBe(mode === 'dark' ? '#97FCE4' : '#0A7563');
  });

  it.each(['primary', 'secondary'] as const)('keeps %s text at WCAG AA on every surface', (key) => {
    for (const surface of [tk.background.default, tk.background.paper, tk.surface.raised]) {
      expect(getContrastRatio(palette.text[key], surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(TONES)('keeps %s readable as text, on its own tint and under its contrast text', (tone) => {
    const { main, soft, contrastText } = palette[tone];
    expect(getContrastRatio(main, tk.background.default)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(getContrastRatio(main, tk.background.paper)).toBeGreaterThanOrEqual(AA_TEXT);
    // Tinted chips and alerts put `main` text on `soft` over the paper
    expect(getContrastRatio(main, over(soft, tk.background.paper))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(getContrastRatio(contrastText, main)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps every stage color readable on the Kanban columns and its count badge', () => {
    for (const stage of STAGES) {
      const color = palette.stage[stage];
      expect(getContrastRatio(color, tk.surface.sunken)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(getContrastRatio(color, tk.background.paper)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(getContrastRatio(color, over(alpha(color, tk.softAlpha), tk.surface.sunken))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('gives each stage its own color', () => {
    expect(new Set(STAGES.map((stage) => palette.stage[stage].toLowerCase())).size).toBe(STAGES.length);
  });

  it('uses small radii and tabular numerals', () => {
    expect(theme.shape.borderRadius).toBe(RADIUS.md);
    expect(theme.typography.metric.fontVariantNumeric).toBe('tabular-nums');
    const baseline = theme.components?.MuiCssBaseline?.styleOverrides as { body: Record<string, unknown> };
    expect(baseline.body.fontVariantNumeric).toBe('tabular-nums');
  });

  it('draws cards, dialogs and the app bar with hairline borders instead of shadows', () => {
    const hairline = `1px solid ${tk.border.subtle}`;
    const card = theme.components?.MuiCard?.styleOverrides?.root as Record<string, unknown>;
    const dialog = theme.components?.MuiDialog?.styleOverrides?.paper as Record<string, unknown>;
    const appBar = theme.components?.MuiAppBar?.styleOverrides?.root as Record<string, unknown>;
    expect(card.border).toBe(hairline);
    expect(dialog.border).toBe(hairline);
    expect(appBar.borderBottom).toBe(hairline);
    expect(theme.components?.MuiCard?.defaultProps?.elevation).toBe(0);
    expect(theme.components?.MuiButton?.defaultProps?.disableElevation).toBe(true);
  });

  it('makes inputs compact by default', () => {
    expect(theme.components?.MuiTextField?.defaultProps?.size).toBe('small');
    expect(theme.components?.MuiSelect?.defaultProps?.size).toBe('small');
  });

  it('tints filled chips with their color instead of filling them solid', () => {
    const root = theme.components?.MuiChip?.styleOverrides?.root as unknown as StyleFn;
    const warning = root({ ownerState: { color: 'warning', variant: 'filled' }, theme });
    expect(warning.backgroundColor).toBe(palette.warning.soft);
    expect(warning.color).toBe(palette.warning.main);

    const outlined = root({ ownerState: { color: 'error', variant: 'outlined' }, theme });
    expect(outlined.backgroundColor).toBeUndefined();
    expect(outlined.borderColor).toBe(alpha(palette.error.main, 0.45));

    const neutral = root({ ownerState: { color: 'default', variant: 'filled' }, theme });
    expect(neutral.color).toBeUndefined();
  });

  it('tints standard alerts by severity', () => {
    const root = theme.components?.MuiAlert?.styleOverrides?.root as unknown as StyleFn;
    const error = root({ ownerState: { severity: 'error', variant: 'standard' }, theme });
    expect(error.backgroundColor).toBe(palette.error.soft);
    expect(error.color).toBe(tk.text.primary);
    const filled = root({ ownerState: { severity: 'error', variant: 'filled' }, theme });
    expect(filled.backgroundColor).toBeUndefined();
  });

  it('styles the leads DataGrid from the tokens', () => {
    const grid = theme.components?.MuiDataGrid?.styleOverrides?.root as Record<string, unknown>;
    expect(grid['--DataGrid-containerBackground']).toBe(tk.surface.sunken);
    expect(grid['--DataGrid-rowBorderColor']).toBe(tk.border.subtle);
  });
});

describe('getTheme locales', () => {
  it('still applies the interface language to built-in component texts', () => {
    const ru = getTheme('dark', 'ru');
    expect(ru.components?.MuiDataGrid?.defaultProps?.localeText?.noRowsLabel).not.toBe(
      getTheme('dark', 'en').components?.MuiDataGrid?.defaultProps?.localeText?.noRowsLabel,
    );
    // Locale defaults merge with the redesign defaults instead of replacing them
    expect(ru.components?.MuiDataGrid?.defaultProps?.columnHeaderHeight).toBe(40);
  });
});
