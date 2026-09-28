/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  ariaKeyShortcuts,
  findShortcutConflicts,
  getShortcut,
  isMacPlatform,
  isTypingTarget,
  SHORTCUT_SCOPES,
  SHORTCUTS,
  shortcutKeys,
  shortcutMatches,
  type ShortcutDef,
  type ShortcutEvent,
  type ShortcutId,
} from '../shortcuts.js';

const def = (id: ShortcutId): ShortcutDef => SHORTCUTS.find((s) => s.id === id)!;

describe('shortcut registry (REV-47)', () => {
  it('has unique ids and no two shortcuts on the same keys', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    expect(findShortcutConflicts(SHORTCUTS)).toEqual([]);
  });

  it('reports shortcuts that share keys', () => {
    const defs: ShortcutDef[] = [
      { id: 'a', key: 'j', scope: 'global' },
      { id: 'b', key: 'j', scope: 'queue' },
      { id: 'c', key: 'j', scope: 'review', mod: true },
    ];
    expect(findShortcutConflicts(defs)).toEqual([['a', 'b']]);
  });

  it('puts every shortcut in a listed scope', () => {
    for (const s of SHORTCUTS) expect(SHORTCUT_SCOPES).toContain(s.scope);
  });

  it('uses the platform modifier only for approve, which no browser binds to Enter', () => {
    expect(SHORTCUTS.filter((s) => 'mod' in s && s.mod).map((s) => s.id)).toEqual(['approve']);
  });
});

describe('shortcut matching (REV-47)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const press = (
    id: ShortcutId,
    key: string,
    target: EventTarget | null = document.body,
    init: Partial<ShortcutEvent> = {},
    mac = true,
  ) => shortcutMatches(def(id), { key, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target, ...init }, mac);

  const element = (html: string) => {
    document.body.innerHTML = html;
    return document.body.querySelector<HTMLElement>('[data-target]')!;
  };

  it('matches plain keys, ignoring letter case', () => {
    expect(press('next', 'j')).toBe(true);
    expect(press('next', 'J')).toBe(true);
    expect(press('previous', 'k')).toBe(true);
    expect(press('goQueue', '1')).toBe(true);
    expect(press('showHelp', '?')).toBe(true);
    expect(press('focusSearch', '/')).toBe(true);
    expect(press('next', 'x')).toBe(false);
    expect(press('next', 'ArrowDown')).toBe(false);
  });

  it('never takes a key with a modifier held, so browser shortcuts stay theirs', () => {
    expect(press('goQueue', '1', document.body, { metaKey: true })).toBe(false);
    expect(press('goQueue', '1', document.body, { ctrlKey: true })).toBe(false);
    expect(press('next', 'j', document.body, { altKey: true })).toBe(false);
    expect(press('open', 'Enter', document.body, { metaKey: true })).toBe(false);
  });

  it('needs ⌘ on macOS and Ctrl elsewhere for a modifier shortcut', () => {
    expect(press('approve', 'Enter', document.body, { metaKey: true }, true)).toBe(true);
    expect(press('approve', 'Enter', document.body, { ctrlKey: true }, true)).toBe(false);
    expect(press('approve', 'Enter', document.body, { ctrlKey: true }, false)).toBe(true);
    expect(press('approve', 'Enter', document.body, { metaKey: true }, false)).toBe(false);
    expect(press('approve', 'Enter', document.body, {}, true)).toBe(false);
    expect(press('approve', 'Enter', document.body, { metaKey: true, altKey: true }, true)).toBe(false);
  });

  it('does nothing while a text field has focus', () => {
    for (const html of [
      '<input data-target>',
      '<textarea data-target></textarea>',
      '<select data-target></select>',
      '<div contenteditable="true" data-target></div>',
      '<div role="combobox" data-target></div>',
      '<div role="searchbox" data-target></div>',
    ]) {
      const target = element(html);
      expect(isTypingTarget(target), html).toBe(true);
      expect(press('next', 'j', target), html).toBe(false);
      expect(press('goLeads', '2', target), html).toBe(false);
      expect(press('focusSearch', '/', target), html).toBe(false);
      expect(press('open', 'Enter', target), html).toBe(false);
    }
  });

  it('treats buttons, links and contenteditable="false" as not typing', () => {
    expect(isTypingTarget(element('<button data-target>Go</button>'))).toBe(false);
    expect(isTypingTarget(element('<a href="#" data-target>Go</a>'))).toBe(false);
    expect(isTypingTarget(element('<div contenteditable="false" data-target></div>'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });

  it('lets approve work from the email draft, where the operator types', () => {
    expect(press('approve', 'Enter', element('<textarea data-target></textarea>'), { metaKey: true })).toBe(true);
  });

  it('does nothing inside a dialog, drawer or menu', () => {
    expect(press('next', 'j', element('<div role="dialog"><button data-target>Cancel</button></div>'))).toBe(false);
    expect(press('goQueue', '1', element('<div class="MuiModal-root"><li data-target>Item</li></div>'))).toBe(false);
    expect(press('approve', 'Enter', element('<div role="dialog"><input data-target></div>'), { metaKey: true })).toBe(false);
  });

  it('leaves a key another element already handled alone', () => {
    expect(press('open', 'Enter', document.body, { defaultPrevented: true })).toBe(false);
    expect(press('next', 'j', document.body, { defaultPrevented: true })).toBe(false);
  });

  it('moves from a focused button but never takes Enter from it', () => {
    const target = element('<button data-target>Next</button>');
    expect(press('next', 'j', target)).toBe(true);
    expect(press('open', 'Enter', target)).toBe(false);
    expect(press('open', 'Enter', document.documentElement)).toBe(true);
  });

  it('never fires a built-in shortcut, which its component handles', () => {
    expect(press('closeDialog', 'Escape')).toBe(false);
  });
});

describe('platform modifier (REV-47)', () => {
  it('detects macOS and iOS from the platform', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: 'iPad' })).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ userAgentData: { platform: 'Linux' }, platform: 'Linux x86_64' })).toBe(false);
    expect(isMacPlatform({})).toBe(false);
  });

  it('shows the key caps for the platform', () => {
    expect(shortcutKeys(def('approve'), true)).toEqual(['⌘', 'Enter']);
    expect(shortcutKeys(def('approve'), false)).toEqual(['Ctrl', 'Enter']);
    expect(shortcutKeys(def('next'), true)).toEqual(['J']);
    expect(shortcutKeys(def('closeDialog'), false)).toEqual(['Esc']);
    expect(shortcutKeys(def('showHelp'), false)).toEqual(['?']);
  });

  it('describes each shortcut for aria-keyshortcuts (REV-97)', () => {
    expect(getShortcut('focusSearch').key).toBe('/');
    expect(ariaKeyShortcuts(getShortcut('approve'), true)).toBe('Meta+Enter');
    expect(ariaKeyShortcuts(getShortcut('approve'), false)).toBe('Control+Enter');
    expect(ariaKeyShortcuts(getShortcut('addLead'), true)).toBe('N');
    expect(ariaKeyShortcuts(getShortcut('goQueue'), true)).toBe('1');
    expect(ariaKeyShortcuts(getShortcut('focusSearch'), false)).toBe('/');
    expect(ariaKeyShortcuts(getShortcut('showHelp'), false)).toBe('?');
  });
});
