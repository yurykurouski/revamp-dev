/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_QUEUE_BUCKET,
  formatAge,
  isLeadBucket,
  isTypingTarget,
  queueKeyAction,
  resolveSelection,
  sortQueue,
  stepSelection,
} from '../reviewQueue.js';

const at = (createdAt: string, id = createdAt) => ({ id, createdAt });

describe('review queue order (REV-79)', () => {
  const leads = [at('2026-09-27T10:00:00Z', 'mid'), at('2026-09-25T10:00:00Z', 'old'), at('2026-09-27T12:00:00Z', 'new')];

  it('lists Needs you oldest first', () => {
    expect(sortQueue(leads, 'needs_you').map((l) => l.id)).toEqual(['old', 'mid', 'new']);
  });

  it.each(['in_progress', 'outreach', 'closed'] as const)('lists %s newest first', (bucket) => {
    expect(sortQueue(leads, bucket).map((l) => l.id)).toEqual(['new', 'mid', 'old']);
  });

  it('puts leads without a valid date last and leaves the input alone', () => {
    const withBad = [at('not a date', 'bad'), ...leads];
    expect(sortQueue(withBad, 'needs_you').map((l) => l.id)).toEqual(['old', 'mid', 'new', 'bad']);
    expect(sortQueue(withBad, 'closed').map((l) => l.id)).toEqual(['new', 'mid', 'old', 'bad']);
    expect(withBad[0].id).toBe('bad');
  });

  it('opens on Needs you and accepts only real buckets', () => {
    expect(DEFAULT_QUEUE_BUCKET).toBe('needs_you');
    expect(isLeadBucket('outreach')).toBe(true);
    for (const value of ['ALL', 'NEEDS_APPROVAL', '', null, undefined]) expect(isLeadBucket(value)).toBe(false);
  });
});

describe('queue selection (REV-79)', () => {
  it('keeps the requested lead while it is in the list', () => {
    expect(resolveSelection(['a', 'b', 'c'], 'b', ['a', 'b', 'c'])).toBe('b');
  });

  it('selects the first lead when none is requested or the requested one was never listed', () => {
    expect(resolveSelection(['a', 'b'], null, [])).toBe('a');
    expect(resolveSelection(['a', 'b'], 'elsewhere', ['a', 'b'])).toBe('a');
  });

  it('selects the next lead after the selected one is approved or rejected', () => {
    expect(resolveSelection(['a', 'c'], 'b', ['a', 'b', 'c'])).toBe('c');
  });

  it('skips leads that left the list together with the selected one', () => {
    expect(resolveSelection(['a', 'd'], 'b', ['a', 'b', 'c', 'd'])).toBe('d');
  });

  it('falls back to the lead before when the last one leaves', () => {
    expect(resolveSelection(['a', 'b'], 'c', ['a', 'b', 'c'])).toBe('b');
  });

  it('selects nothing when the list empties', () => {
    expect(resolveSelection([], 'a', ['a'])).toBeNull();
    expect(resolveSelection([], null, [])).toBeNull();
  });

  it('steps through the list and stops at its ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'b', -1)).toBe('a');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection(ids, 'gone', -1)).toBe('a');
    expect(stepSelection([], 'a', 1)).toBeNull();
  });
});

describe('queue keyboard (REV-79)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const press = (key: string, target: EventTarget | null = document.body, init: Partial<KeyboardEvent> = {}) =>
    queueKeyAction({ key, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target, ...init });

  const element = (html: string) => {
    document.body.innerHTML = html;
    return document.body.querySelector<HTMLElement>('[data-target]')!;
  };

  it('moves with J / K and opens with Enter', () => {
    expect(press('j')).toBe('next');
    expect(press('k')).toBe('previous');
    expect(press('J')).toBe('next');
    expect(press('Enter')).toBe('open');
    expect(press('x')).toBeNull();
    expect(press('ArrowDown')).toBeNull();
  });

  it('does nothing while a text field has focus', () => {
    for (const html of [
      '<input data-target>',
      '<textarea data-target></textarea>',
      '<select data-target></select>',
      '<div contenteditable="true" data-target></div>',
      '<div role="combobox" data-target></div>',
    ]) {
      const target = element(html);
      expect(isTypingTarget(target), html).toBe(true);
      expect(press('j', target), html).toBeNull();
      expect(press('Enter', target), html).toBeNull();
    }
  });

  it('does nothing inside a dialog', () => {
    const target = element('<div role="dialog"><button data-target>Cancel</button></div>');
    expect(press('j', target)).toBeNull();
    expect(press('k', target)).toBeNull();
  });

  it('leaves modified keys alone, so Cmd + Enter still approves', () => {
    expect(press('Enter', document.body, { metaKey: true })).toBeNull();
    expect(press('Enter', document.body, { ctrlKey: true })).toBeNull();
    expect(press('j', document.body, { altKey: true })).toBeNull();
  });

  it('leaves a key another element already handled alone', () => {
    expect(press('Enter', document.body, { defaultPrevented: true })).toBeNull();
  });

  it('moves from a focused button but never takes Enter from it', () => {
    const target = element('<button data-target>Next</button>');
    expect(isTypingTarget(target)).toBe(false);
    expect(press('j', target)).toBe('next');
    expect(press('Enter', target)).toBeNull();
  });
});

describe('lead age (REV-79)', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');

  it('shows minutes, hours, then days', () => {
    expect(formatAge('2026-09-27T11:55:00Z', now, 'en')).toBe('5m');
    expect(formatAge('2026-09-27T10:00:00Z', now, 'en')).toBe('2h');
    expect(formatAge('2026-09-24T12:00:00Z', now, 'en')).toBe('3d');
  });

  it('shows at least one minute, also for a clock that runs ahead', () => {
    expect(formatAge('2026-09-27T12:00:00Z', now, 'en')).toBe('1m');
    expect(formatAge('2026-09-27T12:05:00Z', now, 'en')).toBe('1m');
  });

  it('is empty for an invalid date and localized for other languages', () => {
    expect(formatAge('', now, 'en')).toBe('');
    expect(formatAge('2026-09-27T10:00:00Z', now, 'ru')).toMatch(/^2\s?ч/);
  });
});
