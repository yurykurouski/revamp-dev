import React from 'react';
import { Box } from '@mui/material';
import { getShortcut, isMacPlatform, shortcutKeys, type ShortcutDef, type ShortcutId } from '../utils/shortcuts.js';

interface KeyCapsProps {
  /** A registry shortcut, by id or entry */
  shortcut: ShortcutId | ShortcutDef;
  /** Whether to show ⌘ rather than Ctrl; the current platform by default */
  mac?: boolean;
  /** Caps on a tooltip take the tooltip's text color instead of the page's surfaces */
  inTooltip?: boolean;
}

/** A shortcut's keys as key caps, e.g. [⌘] [Enter] (REV-97); the one place key caps are drawn */
export const KeyCaps: React.FC<KeyCapsProps> = ({ shortcut, mac = isMacPlatform(), inTooltip = false }) => {
  const def = typeof shortcut === 'string' ? getShortcut(shortcut) : shortcut;
  return (
    <Box component="span" data-key-caps={def.id} sx={{ display: 'inline-flex', gap: 0.5, flexShrink: 0 }}>
      {shortcutKeys(def, mac).map((key) => (
        <Box
          key={key}
          component="kbd"
          sx={{
            minWidth: 20,
            px: 0.625,
            lineHeight: '18px',
            border: '1px solid',
            borderColor: inTooltip ? 'currentColor' : 'divider',
            borderRadius: 0.5,
            backgroundColor: inTooltip ? 'transparent' : 'action.hover',
            color: inTooltip ? 'inherit' : 'text.secondary',
            fontFamily: 'inherit',
            fontSize: '0.6875rem',
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {key}
        </Box>
      ))}
    </Box>
  );
};

/** A tooltip title with the shortcut's key caps after the label, e.g. "Add lead  [N]" */
export const ShortcutTitle: React.FC<{ label: string; shortcut: ShortcutId; mac?: boolean }> = ({ label, shortcut, mac }) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
    {label}
    <KeyCaps shortcut={shortcut} mac={mac} inTooltip />
  </Box>
);
