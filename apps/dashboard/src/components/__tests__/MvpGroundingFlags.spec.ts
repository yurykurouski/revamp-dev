/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { getTheme } from '../../theme/theme.js';
import { MvpGroundingFlags } from '../leadReview/MvpGroundingFlags.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MvpGroundingFlags (REV-140)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onShow = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onShow.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (flags: React.ComponentProps<typeof MvpGroundingFlags>['flags']) =>
    act(() =>
      root.render(
        React.createElement(ThemeProvider, { theme: getTheme('light') }, React.createElement(MvpGroundingFlags, { flags, onShow })),
      ),
    );

  it('renders nothing without flags', () => {
    render([]);
    expect(container.innerHTML).toBe('');
  });

  it('lists each fact with its context and shows it in the preview', () => {
    render([
      { kind: 'number', text: '15', context: 'Ponad 15 lat doświadczenia' },
      { kind: 'name', text: 'Anna Nowak', context: 'Dr Anna Nowak przyjmuje' },
    ]);
    expect(container.textContent).toContain('Check these facts (2)');
    const items = Array.from(container.querySelectorAll('li'));
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Number');
    expect(items[0]!.textContent).toContain('Ponad 15 lat doświadczenia');
    expect(items[1]!.textContent).toContain('Name');
    act(() => items[0]!.querySelector('button')!.click());
    expect(onShow).toHaveBeenCalledWith('15');
  });
});
