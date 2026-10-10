/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import { MVP_FONT_CHOICES } from '@revamp/shared-types';
import '../../i18n/index.js';
import { getTheme } from '../../theme/theme.js';
import { MvpFontControl } from '../leadReview/MvpFontControl.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MvpFontControl (REV-140)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onChange.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (value: string | null, disabled = false) =>
    act(() =>
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('light') },
          React.createElement(MvpFontControl, { value: value as never, disabled, onChange }),
        ),
      ),
    );
  const select = () => container.querySelector<HTMLSelectElement>('select')!;
  const choose = (value: string) =>
    act(() => {
      select().value = value;
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });

  it('lists the page fonts and all six pairings', () => {
    render(null);
    const options = Array.from(select().options).map((o) => o.textContent);
    expect(options).toHaveLength(MVP_FONT_CHOICES.length + 1);
    expect(options[0]).toBe("The page's own fonts");
    expect(options).toContain('Playfair Display / Source Sans 3');
  });

  it('sends the chosen pairing and null for the page fonts', () => {
    render(null);
    choose('editorial');
    expect(onChange).toHaveBeenLastCalledWith({ heading: 'Lora', body: 'Lato' });
    render('editorial');
    choose('');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('shows the saved pairing and can be disabled', () => {
    render('modern', true);
    expect(select().value).toBe('modern');
    expect(select().disabled).toBe(true);
  });
});
