import { useEffect, useRef } from 'react';
import { queueKeyAction, type QueueKeyAction } from '../utils/reviewQueue.js';

/**
 * J / K / Enter on the review queue (REV-79). Listens on the window while mounted; which presses count is
 * `queueKeyAction`'s call, so typing in a field or a dialog never moves the list.
 */
export function useQueueHotkeys(handlers: Record<QueueKeyAction, () => void>): void {
  // The latest handlers, so the listener is added once and still sees the current selection
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = queueKeyAction(event);
      if (!action) return;
      event.preventDefault();
      latest.current[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
