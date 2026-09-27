import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { useTranslation } from 'react-i18next';
import {
  FloatingPanelState,
  PANEL_MARGIN,
  PanelBounds,
  PanelPosition,
  nudgePanelPosition,
  parsePanelState,
  resolvePanelPosition,
} from '../../utils/floatingPanel.js';

/** Where the panel's position and collapse state are kept for the browser session, for every lead */
export const TOOLS_PANEL_STORAGE_KEY = 'revamp.prototypeToolsPanel';

const readState = (): FloatingPanelState => {
  try {
    return parsePanelState(window.sessionStorage.getItem(TOOLS_PANEL_STORAGE_KEY));
  } catch {
    return parsePanelState(null);
  }
};

const EMPTY_BOUNDS: PanelBounds = { areaWidth: 0, areaHeight: 0, panelWidth: 0, panelHeight: 0 };

interface FloatingToolsPanelProps {
  children: React.ReactNode;
}

/**
 * A panel floating over the MVP preview (REV-88), holding the live color and layout pickers. It stays
 * inside its parent element (the positioned preview viewport) and is a sibling of the sandboxed
 * iframe, never part of the MVP document. The operator drags it by its handle
 * (or moves it with the arrow keys on the focused handle), collapses it to its header, and puts it back
 * in the top-right corner with "reset position". Position and collapse state last for the session.
 */
export const FloatingToolsPanel: React.FC<FloatingToolsPanelProps> = ({ children }) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<FloatingPanelState>(readState);
  const [bounds, setBounds] = useState<PanelBounds>(EMPTY_BOUNDS);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pointer: PanelPosition; panel: PanelPosition } | null>(null);

  const measure = useCallback(() => {
    // The parent, not a ref to it: a parent's ref is not attached yet when this first runs
    const panel = panelRef.current;
    const area = panel?.parentElement;
    if (!panel || !area) return;
    const next = {
      areaWidth: area.clientWidth,
      areaHeight: area.clientHeight,
      panelWidth: panel.offsetWidth,
      panelHeight: panel.offsetHeight,
    };
    setBounds((current) =>
      current.areaWidth === next.areaWidth &&
      current.areaHeight === next.areaHeight &&
      current.panelWidth === next.panelWidth &&
      current.panelHeight === next.panelHeight
        ? current
        : next,
    );
  }, []);

  // Re-measured as the breakpoint changes the preview size or the pickers change the panel size
  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    const panel = panelRef.current;
    if (panel) observer.observe(panel);
    if (panel?.parentElement) observer.observe(panel.parentElement);
    return () => observer.disconnect();
  }, [measure, state.collapsed]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(TOOLS_PANEL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Without session storage the panel only keeps its place until the page is reloaded
    }
  }, [state]);

  const position = resolvePanelPosition(state.position, bounds);
  const moveTo = (next: PanelPosition | null) => setState((current) => ({ ...current, position: next }));

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    measure();
    dragStart.current = { pointer: { x: event.clientX, y: event.clientY }, panel: position };
    // Captured, so the drag keeps going while the pointer is over the iframe
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    moveTo(
      resolvePanelPosition(
        {
          x: start.panel.x + event.clientX - start.pointer.x,
          y: start.panel.y + event.clientY - start.pointer.y,
        },
        bounds,
      ),
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      moveTo(null);
      return;
    }
    const next = nudgePanelPosition(position, event.key, event.shiftKey, bounds);
    if (!next) return;
    event.preventDefault();
    moveTo(next);
  };

  const collapseLabel = state.collapsed ? t('mvpTools.expand') : t('mvpTools.collapse');

  return (
    <Paper
      ref={panelRef}
      role="region"
      aria-label={t('mvpTools.title')}
      data-testid="mvp-tools-panel"
      data-collapsed={state.collapsed}
      elevation={0}
      // Inline, since it changes on every pointer move during a drag
      style={{ left: position.x, top: position.y }}
      sx={{
        position: 'absolute',
        // Above the mobile notch and the regeneration overlay
        zIndex: 20,
        width: 'max-content',
        maxWidth: `calc(100% - ${PANEL_MARGIN * 2}px)`,
        maxHeight: `calc(100% - ${PANEL_MARGIN * 2}px)`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderColor: 'border.strong',
        boxShadow: (theme) => `0 12px 32px -8px ${alpha(theme.palette.common.black, 0.35)}`,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: 0.5,
          pr: 0.5,
          py: 0.25,
          borderBottom: state.collapsed ? 'none' : '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-label={t('mvpTools.move')}
          data-testid="mvp-tools-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
          sx={{
            flexGrow: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            py: 0.5,
            pr: 1,
            borderRadius: 1,
            cursor: dragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            touchAction: 'none',
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {t('mvpTools.title')}
          </Typography>
        </Box>
        <Tooltip title={t('mvpTools.resetPosition')}>
          <IconButton size="small" aria-label={t('mvpTools.resetPosition')} onClick={() => moveTo(null)}>
            <CenterFocusStrongIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={collapseLabel}>
          <IconButton
            size="small"
            aria-label={collapseLabel}
            aria-expanded={!state.collapsed}
            onClick={() => setState((current) => ({ ...current, collapsed: !current.collapsed }))}
          >
            {state.collapsed ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ExpandLessIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
      </Box>
      {!state.collapsed && (
        <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', minHeight: 0 }}>
          {children}
        </Box>
      )}
    </Paper>
  );
};
