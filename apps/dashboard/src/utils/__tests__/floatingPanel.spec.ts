import { describe, it, expect } from 'vitest';
import {
  PANEL_KEY_STEP,
  PANEL_KEY_STEP_LARGE,
  PANEL_MARGIN,
  PanelBounds,
  clampPanelPosition,
  defaultPanelPosition,
  nudgePanelPosition,
  parsePanelState,
  resolvePanelPosition,
} from '../floatingPanel.js';

const bounds: PanelBounds = { areaWidth: 800, areaHeight: 600, panelWidth: 300, panelHeight: 120 };
const maxX = 800 - 300 - PANEL_MARGIN;
const maxY = 600 - 120 - PANEL_MARGIN;

describe('floating panel positioning (REV-88)', () => {
  it('keeps a position inside the area as it is', () => {
    expect(clampPanelPosition({ x: 100, y: 200 }, bounds)).toEqual({ x: 100, y: 200 });
  });

  it('keeps the whole panel inside the area, with a margin', () => {
    expect(clampPanelPosition({ x: -50, y: -50 }, bounds)).toEqual({ x: PANEL_MARGIN, y: PANEL_MARGIN });
    expect(clampPanelPosition({ x: 5000, y: 5000 }, bounds)).toEqual({ x: maxX, y: maxY });
    expect(clampPanelPosition({ x: maxX, y: maxY }, bounds)).toEqual({ x: maxX, y: maxY });
    expect(clampPanelPosition({ x: maxX + 1, y: maxY + 1 }, bounds)).toEqual({ x: maxX, y: maxY });
  });

  it('pins a panel larger than its area to the top-left edge', () => {
    const narrow = { areaWidth: 200, areaHeight: 100, panelWidth: 300, panelHeight: 120 };
    expect(clampPanelPosition({ x: 80, y: 40 }, narrow)).toEqual({ x: PANEL_MARGIN, y: PANEL_MARGIN });
  });

  it('pulls a remembered position back in when the area shrinks (a smaller breakpoint)', () => {
    const desktopSpot = { x: 700, y: 400 };
    const mobile = { areaWidth: 355, areaHeight: 600, panelWidth: 331, panelHeight: 200 };
    expect(resolvePanelPosition(desktopSpot, mobile)).toEqual({ x: PANEL_MARGIN, y: 400 - 12 });
  });

  it('starts in the top-right corner', () => {
    expect(defaultPanelPosition(bounds)).toEqual({ x: maxX, y: PANEL_MARGIN });
    expect(resolvePanelPosition(null, bounds)).toEqual({ x: maxX, y: PANEL_MARGIN });
  });

  it('stays at the margin before anything is measured', () => {
    const empty = { areaWidth: 0, areaHeight: 0, panelWidth: 0, panelHeight: 0 };
    expect(resolvePanelPosition(null, empty)).toEqual({ x: PANEL_MARGIN, y: PANEL_MARGIN });
  });

  it('moves one step per arrow key and a large step with Shift', () => {
    const at = { x: 100, y: 100 };
    expect(nudgePanelPosition(at, 'ArrowRight', false, bounds)).toEqual({ x: 100 + PANEL_KEY_STEP, y: 100 });
    expect(nudgePanelPosition(at, 'ArrowLeft', false, bounds)).toEqual({ x: 100 - PANEL_KEY_STEP, y: 100 });
    expect(nudgePanelPosition(at, 'ArrowDown', true, bounds)).toEqual({ x: 100, y: 100 + PANEL_KEY_STEP_LARGE });
    expect(nudgePanelPosition(at, 'ArrowUp', false, bounds)).toEqual({ x: 100, y: 100 - PANEL_KEY_STEP });
  });

  it('does not move the panel out of the area with the keyboard', () => {
    expect(nudgePanelPosition({ x: PANEL_MARGIN, y: PANEL_MARGIN }, 'ArrowUp', true, bounds)).toEqual({
      x: PANEL_MARGIN,
      y: PANEL_MARGIN,
    });
    expect(nudgePanelPosition({ x: maxX, y: 50 }, 'ArrowRight', false, bounds)).toEqual({ x: maxX, y: 50 });
  });

  it('ignores keys other than the arrows', () => {
    expect(nudgePanelPosition({ x: 100, y: 100 }, 'Enter', false, bounds)).toBeNull();
    expect(nudgePanelPosition({ x: 100, y: 100 }, 'a', true, bounds)).toBeNull();
  });
});

describe('remembered panel state (REV-88)', () => {
  it('reads a stored position and collapse state', () => {
    expect(parsePanelState(JSON.stringify({ position: { x: 40, y: 60 }, collapsed: true }))).toEqual({
      position: { x: 40, y: 60 },
      collapsed: true,
    });
  });

  it('falls back to the default corner, expanded, for nothing or anything malformed', () => {
    const fallback = { position: null, collapsed: false };
    expect(parsePanelState(null)).toEqual(fallback);
    expect(parsePanelState('')).toEqual(fallback);
    expect(parsePanelState('{not json')).toEqual(fallback);
    expect(parsePanelState('null')).toEqual(fallback);
    expect(parsePanelState(JSON.stringify({ position: { x: 'a', y: 2 }, collapsed: 'yes' }))).toEqual(fallback);
    expect(parsePanelState(JSON.stringify({ position: { x: 1 } }))).toEqual(fallback);
  });
});
