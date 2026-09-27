import { DATE_LOCALES, type AppLanguage } from '../i18n/languages.js';
import { LEAD_BUCKETS, type LeadBucket } from './leadStages.js';

/**
 * Review-queue home (REV-79): which leads the list shows in which order, which one is selected, and
 * what J / K / Enter do. Pure helpers, free of React and the router, so they stay unit-testable.
 */

/** The bucket the queue opens on */
export const DEFAULT_QUEUE_BUCKET: LeadBucket = 'needs_you';

export const isLeadBucket = (value: unknown): value is LeadBucket =>
  typeof value === 'string' && (LEAD_BUCKETS as readonly string[]).includes(value);

/** Needs you lists the longest-waiting lead first; the other buckets show the newest first */
export const queueSortsOldestFirst = (bucket: LeadBucket): boolean => bucket === 'needs_you';

/** The bucket's leads in list order; leads without a valid date go last */
export function sortQueue<T extends { createdAt: string }>(leads: readonly T[], bucket: LeadBucket): T[] {
  const time = (lead: T) => {
    const stamp = Date.parse(lead.createdAt);
    return Number.isNaN(stamp) ? null : stamp;
  };
  const direction = queueSortsOldestFirst(bucket) ? 1 : -1;
  return [...leads].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1;
    return (ta - tb) * direction;
  });
}

/**
 * The lead to select in the list `ids`. The requested lead stays selected while it is in the list. When
 * it leaves (approved, rejected, or moved on by a worker), the lead that followed it in the previous
 * list takes its place, else the one before it, so the operator moves on without losing their place.
 * With nothing requested, or a lead that was never in the list, the first lead is selected.
 */
export function resolveSelection(
  ids: readonly string[],
  requested: string | null,
  previousIds: readonly string[],
): string | null {
  if (requested && ids.includes(requested)) return requested;
  const at = requested ? previousIds.indexOf(requested) : -1;
  if (at >= 0) {
    const after = previousIds.slice(at + 1).find((id) => ids.includes(id));
    if (after) return after;
    const before = previousIds
      .slice(0, at)
      .reverse()
      .find((id) => ids.includes(id));
    if (before) return before;
  }
  return ids[0] ?? null;
}

/** The lead `delta` places from the selected one, clamped to the list; the first lead when none is selected */
export function stepSelection(ids: readonly string[], selected: string | null, delta: number): string | null {
  if (ids.length === 0) return null;
  const at = selected ? ids.indexOf(selected) : -1;
  if (at < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

export type QueueKeyAction = 'next' | 'previous' | 'open';

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

/**
 * What a key press does in the queue: J / K move through the list and Enter opens the selected lead.
 * Nothing happens while the operator types in a field or works in a dialog, with a modifier held (so
 * Cmd + Enter stays the approve shortcut), or on a key another element already handled. Enter counts
 * only when nothing is focused, so it never takes over a focused button or link.
 */
export function queueKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'>,
): QueueKeyAction | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null;
  const target = event.target as KeyTarget | null;
  if (isTypingTarget(event.target)) return null;
  if (target && typeof target.closest === 'function' && target.closest('[role="dialog"]')) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'j') return 'next';
  if (key === 'k') return 'previous';
  if (key === 'Enter') {
    const tag = target && typeof target.tagName === 'string' ? target.tagName.toUpperCase() : 'BODY';
    return tag === 'BODY' || tag === 'HTML' ? 'open' : null;
  }
  return null;
}

const AGE_UNITS = [
  { unit: 'minute', ms: 60_000, below: 60 },
  { unit: 'hour', ms: 3_600_000, below: 24 },
  { unit: 'day', ms: 86_400_000, below: Infinity },
] as const;

/** How long ago a lead was added, as a short localized age ("5 min", "2h", "3d"); empty for an invalid date */
export function formatAge(createdAt: string, now: number, language: AppLanguage): string {
  const stamp = Date.parse(createdAt);
  if (Number.isNaN(stamp)) return '';
  const elapsed = Math.max(0, now - stamp);
  const { unit, ms } = AGE_UNITS.find(({ ms, below }) => elapsed / ms < below)!;
  const value = Math.max(unit === 'minute' ? 1 : 0, Math.floor(elapsed / ms));
  return new Intl.NumberFormat(DATE_LOCALES[language], { style: 'unit', unit, unitDisplay: 'narrow' }).format(value);
}
