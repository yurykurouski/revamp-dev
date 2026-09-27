/** A point relative to the top-left corner of the area a panel floats in */
export interface PanelPosition {
  x: number;
  y: number;
}

/** The measured sizes of the floating area and of the panel in it */
export interface PanelBounds {
  areaWidth: number;
  areaHeight: number;
  panelWidth: number;
  panelHeight: number;
}

/** The gap kept between the panel and the edges of its area */
export const PANEL_MARGIN = 12;
/** How far an arrow key moves the panel; Shift moves it further */
export const PANEL_KEY_STEP = 16;
export const PANEL_KEY_STEP_LARGE = 64;

const clampAxis = (value: number, area: number, panel: number) => {
  const max = area - panel - PANEL_MARGIN;
  // A panel wider (or taller) than its area sticks to the start edge
  if (max <= PANEL_MARGIN) return PANEL_MARGIN;
  return Math.min(Math.max(value, PANEL_MARGIN), max);
};

/** Keeps the whole panel inside its area, whatever size the area has now (REV-88) */
export function clampPanelPosition(position: PanelPosition, bounds: PanelBounds): PanelPosition {
  return {
    x: clampAxis(position.x, bounds.areaWidth, bounds.panelWidth),
    y: clampAxis(position.y, bounds.areaHeight, bounds.panelHeight),
  };
}

/** The top-right corner, where the panel starts and where "reset position" puts it back */
export function defaultPanelPosition(bounds: PanelBounds): PanelPosition {
  return clampPanelPosition({ x: bounds.areaWidth - bounds.panelWidth - PANEL_MARGIN, y: PANEL_MARGIN }, bounds);
}

/** Where the panel is shown: the operator's position kept in bounds, or the default corner */
export function resolvePanelPosition(position: PanelPosition | null, bounds: PanelBounds): PanelPosition {
  return position ? clampPanelPosition(position, bounds) : defaultPanelPosition(bounds);
}

const KEY_DIRECTIONS: Record<string, PanelPosition> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * The keyboard alternative to dragging: an arrow key moves the panel by one step (a large one with
 * Shift). Returns null for any other key.
 */
export function nudgePanelPosition(
  position: PanelPosition,
  key: string,
  large: boolean,
  bounds: PanelBounds,
): PanelPosition | null {
  const direction = KEY_DIRECTIONS[key];
  if (!direction) return null;
  const step = large ? PANEL_KEY_STEP_LARGE : PANEL_KEY_STEP;
  return clampPanelPosition({ x: position.x + direction.x * step, y: position.y + direction.y * step }, bounds);
}

/** What the panel remembers for the browser session */
export interface FloatingPanelState {
  position: PanelPosition | null;
  collapsed: boolean;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Reads a remembered state; anything malformed falls back to the default corner, expanded */
export function parsePanelState(raw: string | null): FloatingPanelState {
  const fallback: FloatingPanelState = { position: null, collapsed: false };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as { position?: { x?: unknown; y?: unknown } | null; collapsed?: unknown };
    const position =
      value.position && isFiniteNumber(value.position.x) && isFiniteNumber(value.position.y)
        ? { x: value.position.x, y: value.position.y }
        : null;
    return { position, collapsed: value.collapsed === true };
  } catch {
    return fallback;
  }
}
