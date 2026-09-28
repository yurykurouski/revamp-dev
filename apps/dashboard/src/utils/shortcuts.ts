/**
 * The dashboard's keyboard shortcuts (REV-47), defined once so they never collide and the help overlay
 * lists exactly what works. A component binds handlers to ids with `useShortcuts`; which key presses
 * count is `shortcutMatches`' call.
 */

/** Where a shortcut works: anywhere in the app shell, on the review queue, or in a lead's review */
export type ShortcutScope = 'global' | 'queue' | 'review';

export interface ShortcutDef {
  id: string;
  /** `KeyboardEvent.key`, lower case for letters */
  key: string;
  scope: ShortcutScope;
  /** Needs the platform modifier: ⌘ on macOS, Ctrl elsewhere */
  mod?: boolean;
  /** Also works while typing in a field (only modifier shortcuts, which never type text) */
  whileTyping?: boolean;
  /** Only when nothing is focused, so it never takes Enter from a focused button or link */
  bodyOnly?: boolean;
  /** Handled by the component itself (MUI closes dialogs on Esc); listed in the help overlay only */
  builtIn?: boolean;
}

export const SHORTCUTS = [
  { id: 'goQueue', key: '1', scope: 'global' },
  { id: 'goLeads', key: '2', scope: 'global' },
  { id: 'goSettings', key: '3', scope: 'global' },
  { id: 'openDiscovery', key: 'd', scope: 'global' },
  { id: 'addLead', key: 'n', scope: 'global' },
  { id: 'focusSearch', key: '/', scope: 'global' },
  { id: 'showHelp', key: '?', scope: 'global' },
  { id: 'closeDialog', key: 'Escape', scope: 'global', builtIn: true },
  { id: 'next', key: 'j', scope: 'queue' },
  { id: 'previous', key: 'k', scope: 'queue' },
  { id: 'open', key: 'Enter', scope: 'queue', bodyOnly: true },
  // Runs the Approve button's own checks and confirmations; it never sends by itself (HITL)
  { id: 'approve', key: 'Enter', scope: 'review', mod: true, whileTyping: true },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

export const SHORTCUT_SCOPES: readonly ShortcutScope[] = ['global', 'queue', 'review'];

/** Pairs of shortcuts with the same keys; the registry must have none */
export function findShortcutConflicts(defs: readonly ShortcutDef[]): Array<[string, string]> {
  const combo = (def: ShortcutDef) => `${def.mod ? 'mod+' : ''}${def.key}`;
  return defs.flatMap((a, i) => defs.slice(i + 1).filter((b) => combo(a) === combo(b)).map((b): [string, string] => [a.id, b.id]));
}

type KeyTarget = Pick<Element, 'tagName' | 'getAttribute' | 'closest'> & { isContentEditable?: boolean };

/** Whether keys typed here are text: a field, an editor, or a widget that uses letters itself */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as KeyTarget | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  return ['textbox', 'combobox', 'searchbox', 'spinbutton'].includes(el.getAttribute('role') ?? '');
}

/** Whether the operator is in a dialog, drawer or menu, where keys belong to that overlay */
function inOverlay(target: KeyTarget | null): boolean {
  return !!target && typeof target.closest === 'function' && !!target.closest('[role="dialog"], .MuiModal-root');
}

type NavigatorLike = { platform?: string; userAgentData?: { platform?: string } };

/** Whether the platform modifier is ⌘ rather than Ctrl */
export function isMacPlatform(nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  const platform = nav?.userAgentData?.platform || nav?.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'>;

/**
 * Whether a key press triggers the shortcut. Nothing counts on a key another element already handled,
 * inside a dialog or menu, or while typing in a field (unless the shortcut allows it). Plain shortcuts
 * need no modifier held, so browser and OS shortcuts (⌘ + K, Ctrl + 1, …) stay theirs; a modifier
 * shortcut needs exactly the platform modifier.
 */
export function shortcutMatches(def: ShortcutDef, event: ShortcutEvent, mac = isMacPlatform()): boolean {
  if (def.builtIn || event.defaultPrevented) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key !== def.key) return false;

  if (event.altKey) return false;
  if (def.mod) {
    if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  } else if (event.metaKey || event.ctrlKey) {
    return false;
  }

  const target = event.target as KeyTarget | null;
  if (inOverlay(target)) return false;
  if (!def.whileTyping && isTypingTarget(event.target)) return false;
  if (def.bodyOnly) {
    const tag = target && typeof target.tagName === 'string' ? target.tagName.toUpperCase() : 'BODY';
    if (tag !== 'BODY' && tag !== 'HTML') return false;
  }
  return true;
}

const KEY_LABELS: Record<string, string> = { Escape: 'Esc', Enter: 'Enter' };

/** The key caps to show for a shortcut, e.g. ['⌘', 'Enter'] on macOS or ['Ctrl', 'Enter'] elsewhere */
export function shortcutKeys(def: ShortcutDef, mac = isMacPlatform()): string[] {
  const key = KEY_LABELS[def.key] ?? def.key.toUpperCase();
  return def.mod ? [mac ? '⌘' : 'Ctrl', key] : [key];
}
