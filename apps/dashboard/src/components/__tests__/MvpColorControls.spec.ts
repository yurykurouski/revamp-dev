/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { getTheme } from '../../theme/theme.js';
import { MvpColorControls } from '../leadReview/MvpColorControls.js';
import type { MvpColors } from '../../utils/mvpPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seed: MvpColors = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#ffffff', text: '#111111' };

describe('MvpColorControls (REV-140)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onApply = vi.fn();
  const onReset = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onApply.mockReset();
    onReset.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (props: Partial<React.ComponentProps<typeof MvpColorControls>> = {}) =>
    act(() =>
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('light') },
          React.createElement(MvpColorControls, { seed, saved: false, brand: ['#c0ffee', '#0a5c8a'], disabled: false, onApply, onReset, ...props }),
        ),
      ),
    );
  const role = (name: string) => container.querySelector<HTMLButtonElement>(`[data-testid="mvp-color-role-${name}"]`)!;
  const apply = () => container.querySelector<HTMLButtonElement>('[data-testid="mvp-colors-apply"]')!;
  const hex = () => container.querySelector<HTMLInputElement>('[data-testid="mvp-color-hex"] input')!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hex(), value);
      hex().dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('applies a brand color picked for the selected role', () => {
    render();
    act(() => role('primary').click());
    expect(role('primary').getAttribute('aria-pressed')).toBe('true');
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mvp-brand-color-0"]')!.click());
    expect(apply().disabled).toBe(false);
    act(() => apply().click());
    expect(onApply).toHaveBeenCalledWith({ ...seed, primary: '#c0ffee' });
  });

  it('keeps Apply off while the text is too light, and says why', () => {
    render();
    act(() => role('text').click());
    type('#777777');
    expect(apply().disabled).toBe(true);
    expect(container.textContent).toContain('Text needs at least 4.5:1');
    type('#767676');
    expect(apply().disabled).toBe(false);
    expect(container.textContent).toContain('4.54:1 on background');
  });

  it('sends nothing for a half-typed hex', () => {
    render();
    act(() => role('accent').click());
    type('#12');
    expect(apply().disabled).toBe(true);
    act(() => apply().click());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps Apply off until a color differs from the page', () => {
    render();
    expect(apply().disabled).toBe(true);
  });

  it("offers going back to the page's colors only for saved colors", () => {
    render();
    expect(container.querySelector('[data-testid="mvp-colors-reset"]')).toBeNull();
    render({ saved: true });
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mvp-colors-reset"]')!.click());
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('disables everything when disabled', () => {
    render({ disabled: true, saved: true });
    expect(role('primary').disabled).toBe(true);
    expect(apply().disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="mvp-colors-reset"]')!.disabled).toBe(true);
  });
});
