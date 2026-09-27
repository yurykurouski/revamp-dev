import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoreChip, scoreColor } from '../ScoreChip.js';

describe('ScoreChip (REV-49)', () => {
  it.each([
    [100, 'success'],
    [70, 'success'],
    [69, 'warning'],
    [40, 'warning'],
    [39, 'error'],
    [0, 'error'],
  ] as const)('puts a score of %i in the %s band', (score, color) => {
    expect(scoreColor(score)).toBe(color);
  });

  it('renders the score out of 100 in its band color', () => {
    const html = renderToStaticMarkup(React.createElement(ScoreChip, { score: 42 }));
    expect(html).toContain('42/100');
    expect(html).toContain('MuiChip-colorWarning');
  });
});
