import { describe, it, expect } from 'vitest';
import React from 'react';
import { readFileSync } from 'fs';
import path from 'path';
import { renderToString } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { getTheme, TOKENS } from '../../theme/theme.js';
import { RevampLogo, REVAMP_LOGO_R_PATH } from '../RevampLogo.js';

const render = (mode: 'light' | 'dark', size?: number) =>
  renderToString(React.createElement(ThemeProvider, { theme: getTheme(mode) }, React.createElement(RevampLogo, { size })));

describe('RevampLogo (REV-75)', () => {
  it('is a labelled image of the R mark', () => {
    const html = render('light');
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Revamp"/);
    expect(html).toContain(`d="${REVAMP_LOGO_R_PATH}"`);
  });

  it.each(['light', 'dark'] as const)('takes its colors from the %s theme tokens', (mode) => {
    const html = render(mode).toLowerCase();
    expect(html).toContain(`color:${TOKENS[mode].tones.primary.toLowerCase()}`);
    expect(html).toContain(`fill:${TOKENS[mode].onTone.primary.toLowerCase()}`);
  });

  it('renders at the requested size, 32px by default', () => {
    expect(render('light')).toContain('width:32px');
    expect(render('light', 20)).toContain('width:20px');
  });

  it('draws the same R as the favicon', () => {
    const favicon = readFileSync(path.resolve(__dirname, '../../../public/favicon.svg'), 'utf8');
    expect(favicon).toContain(`d="${REVAMP_LOGO_R_PATH}"`);
  });
});
