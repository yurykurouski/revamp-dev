/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { getTheme } from '../../theme/theme.js';
import { FloatingToolsPanel, TOOLS_PANEL_STORAGE_KEY } from '../leadReview/FloatingToolsPanel.js';
import { PANEL_KEY_STEP, PANEL_MARGIN } from '../../utils/floatingPanel.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout, so the area and the panel get fixed sizes
const AREA = { width: 800, height: 600 };
const PANEL = { width: 300, height: 120 };
const DEFAULT_X = AREA.width - PANEL.width - PANEL_MARGIN;
const MAX_Y = AREA.height - PANEL.height - PANEL_MARGIN;

const Harness: React.FC = () =>
  React.createElement(
    'div',
    { 'data-testid': 'area' },
    React.createElement(FloatingToolsPanel, null, React.createElement('button', { 'data-testid': 'tool' }, 'tool')),
  );

describe('FloatingToolsPanel (REV-88)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.sessionStorage.clear();
    const size = (el: HTMLElement, axis: 'width' | 'height') => {
      if (el.dataset.testid === 'area') return AREA[axis];
      if (el.dataset.testid === 'mvp-tools-panel') return PANEL[axis];
      return 0;
    };
    // Stubbed on whichever prototype defines each size
    const stub = (name: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight', axis: 'width' | 'height') => {
      let owner: object | null = HTMLElement.prototype;
      while (owner && !Object.getOwnPropertyDescriptor(owner, name)) owner = Object.getPrototypeOf(owner);
      vi.spyOn(owner as HTMLElement, name, 'get').mockImplementation(function (this: HTMLElement) {
        return size(this, axis);
      });
    };
    stub('clientWidth', 'width');
    stub('clientHeight', 'height');
    stub('offsetWidth', 'width');
    stub('offsetHeight', 'height');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const render = () =>
    act(() => {
      root.render(React.createElement(ThemeProvider, { theme: getTheme('light') }, React.createElement(Harness)));
    });

  const panel = () => container.querySelector<HTMLElement>('[data-testid="mvp-tools-panel"]')!;
  const handle = () => container.querySelector<HTMLElement>('[data-testid="mvp-tools-handle"]')!;
  const at = () => ({ x: parseFloat(panel().style.left), y: parseFloat(panel().style.top) });
  const buttonLabelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const pointer = (type: string, x: number, y: number) =>
    act(() => {
      handle().dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
      );
    });
  const key = (name: string, shiftKey = false) =>
    act(() => {
      handle().dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
    });

  it('floats in the top-right corner of its area with its tools shown', () => {
    render();
    expect(panel().parentElement?.dataset.testid).toBe('area');
    expect(panel().getAttribute('role')).toBe('region');
    expect(panel().getAttribute('aria-label')).toBe(en.mvpTools.title);
    expect(at()).toEqual({ x: DEFAULT_X, y: PANEL_MARGIN });
    expect(container.querySelector('[data-testid="tool"]')).not.toBeNull();
  });

  it('has a labelled, focusable drag handle and collapse control', () => {
    render();
    expect(handle().getAttribute('role')).toBe('button');
    expect(handle().tabIndex).toBe(0);
    expect(handle().getAttribute('aria-label')).toBe(en.mvpTools.move);
    expect(buttonLabelled(en.mvpTools.collapse).getAttribute('aria-expanded')).toBe('true');
    expect(buttonLabelled(en.mvpTools.resetPosition)).not.toBeNull();
  });

  it('follows a drag and stays inside its area', () => {
    render();
    pointer('pointerdown', 500, 50);
    pointer('pointermove', 300, 150);
    expect(at()).toEqual({ x: DEFAULT_X - 200, y: PANEL_MARGIN + 100 });

    // Far past the bottom-left corner
    pointer('pointermove', -2000, 5000);
    expect(at()).toEqual({ x: PANEL_MARGIN, y: MAX_Y });

    pointer('pointerup', -2000, 5000);
    // Moving the pointer after the drag ended does nothing
    pointer('pointermove', 400, 100);
    expect(at()).toEqual({ x: PANEL_MARGIN, y: MAX_Y });
  });

  it('moves with the arrow keys on the handle and goes back to the corner with Home', () => {
    render();
    key('ArrowLeft');
    key('ArrowDown');
    expect(at()).toEqual({ x: DEFAULT_X - PANEL_KEY_STEP, y: PANEL_MARGIN + PANEL_KEY_STEP });
    key('ArrowRight', true);
    expect(at().x).toBe(DEFAULT_X);
    key('Home');
    expect(at()).toEqual({ x: DEFAULT_X, y: PANEL_MARGIN });
  });

  it('goes back to the corner with reset position', () => {
    render();
    pointer('pointerdown', 500, 50);
    pointer('pointermove', 200, 250);
    pointer('pointerup', 200, 250);
    expect(at()).not.toEqual({ x: DEFAULT_X, y: PANEL_MARGIN });
    act(() => buttonLabelled(en.mvpTools.resetPosition).click());
    expect(at()).toEqual({ x: DEFAULT_X, y: PANEL_MARGIN });
  });

  it('collapses to its header and expands again', () => {
    render();
    act(() => buttonLabelled(en.mvpTools.collapse).click());
    expect(container.querySelector('[data-testid="tool"]')).toBeNull();
    expect(panel().dataset.collapsed).toBe('true');
    const expand = buttonLabelled(en.mvpTools.expand);
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    // The handle stays reachable while collapsed
    expect(handle()).not.toBeNull();

    act(() => expand.click());
    expect(container.querySelector('[data-testid="tool"]')).not.toBeNull();
    expect(panel().dataset.collapsed).toBe('false');
  });

  it('remembers its position and collapse state for the session', () => {
    render();
    key('ArrowLeft');
    act(() => buttonLabelled(en.mvpTools.collapse).click());
    const moved = at();
    expect(JSON.parse(window.sessionStorage.getItem(TOOLS_PANEL_STORAGE_KEY)!)).toEqual({ position: moved, collapsed: true });

    // Another lead's review mounts a fresh panel
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(at()).toEqual(moved);
    expect(panel().dataset.collapsed).toBe('true');
  });

  it('pulls a remembered position back inside a smaller area', () => {
    window.sessionStorage.setItem(TOOLS_PANEL_STORAGE_KEY, JSON.stringify({ position: { x: 5000, y: -40 }, collapsed: false }));
    render();
    expect(at()).toEqual({ x: DEFAULT_X, y: PANEL_MARGIN });
  });

  it('still works when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render();
    expect(at()).toEqual({ x: DEFAULT_X, y: PANEL_MARGIN });
    key('ArrowUp', true);
    act(() => buttonLabelled(en.mvpTools.collapse).click());
    expect(panel().dataset.collapsed).toBe('true');
  });
});
