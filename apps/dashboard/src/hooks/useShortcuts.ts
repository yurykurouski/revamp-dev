import { useEffect, useRef } from 'react';
import { SHORTCUTS, shortcutMatches, type ShortcutId } from '../utils/shortcuts.js';

export type ShortcutHandlers = Partial<Record<ShortcutId, (() => void) | undefined>>;

/**
 * Binds handlers to shortcuts of the registry (REV-47) while mounted. Which presses count is
 * `shortcutMatches`' call, so typing in a field or working in a dialog never triggers one; a shortcut
 * without a handler (or with `undefined`) leaves its key alone.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  // The latest handlers, so the listener is added once and still sees the current state
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const def of SHORTCUTS) {
        const handler = latest.current[def.id];
        if (!handler || !shortcutMatches(def, event)) continue;
        event.preventDefault();
        handler();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
