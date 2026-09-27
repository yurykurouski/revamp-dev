import { DATE_LOCALES, type AppLanguage } from '../i18n/languages.js';
import { LEAD_STATUSES } from '@revamp/shared-types';
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
 * it leaves (approved or rejected; see `keepSelectedLead` for one a worker moved on), the lead that followed it in the previous
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

/**
 * A bucket's leads, with the operator's selected lead kept in them (REV-86). A lead the operator is
 * looking at stays listed, in its sorted place, while a worker or their own regenerate moves it to
 * another bucket (Needs you → In progress → Needs you), so the review never swaps out from under them.
 * Only a lead that was already shown is kept: a link to a lead of another bucket still selects the
 * first one. `released` is a lead the operator decided on (approved, rejected); it leaves the list as
 * usual and the next lead is selected. A lead gone from the leads altogether leaves too. Quick filters
 * apply after this, so a filter the operator picks still hides the lead.
 */
export function keepSelectedLead<T extends { id: string; createdAt: string }>(
  shown: readonly T[],
  allLeads: readonly T[],
  requested: string | null,
  previousIds: readonly string[],
  released: string | null,
  bucket: LeadBucket,
): readonly T[] {
  if (!requested || requested === released || !previousIds.includes(requested)) return shown;
  if (shown.some((lead) => lead.id === requested)) return shown;
  const lead = allLeads.find((l) => l.id === requested);
  return lead ? sortQueue([...shown, lead], bucket) : shown;
}

/** The lead `delta` places from the selected one, clamped to the list; the first lead when none is selected */
export function stepSelection(ids: readonly string[], selected: string | null, delta: number): string | null {
  if (ids.length === 0) return null;
  const at = selected ? ids.indexOf(selected) : -1;
  if (at < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/** Audit score bands, as the score chip colors them: below 40 is poor, 40–69 needs work, 70+ is healthy */
export const SCORE_BANDS = ['low', 'medium', 'high'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const scoreBand = (score: number): ScoreBand => (score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low');

/**
 * Quick filters over the current bucket's list (REV-80). An empty list means "all": with no status picked
 * every status shows, and with no band picked leads without a score show too. Picking a band keeps only
 * scored leads in the picked bands.
 */
export interface QueueFilters {
  statuses: readonly string[];
  scoreBands: readonly ScoreBand[];
}

export const NO_QUEUE_FILTERS: QueueFilters = { statuses: [], scoreBands: [] };

/** How many filter values are picked; 0 when the list is unfiltered */
export const activeFilterCount = (filters: QueueFilters): number => filters.statuses.length + filters.scoreBands.length;

type FilterableLead = { status: string; totalScore?: number };

/** The lead's score band; undefined for a lead without a numeric score */
export const leadScoreBand = (lead: FilterableLead): ScoreBand | undefined =>
  typeof lead.totalScore === 'number' && Number.isFinite(lead.totalScore) ? scoreBand(lead.totalScore) : undefined;

/** The leads that pass the filters, in their original order */
export function filterQueue<T extends FilterableLead>(leads: readonly T[], filters: QueueFilters): T[] {
  return leads.filter((lead) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(lead.status)) return false;
    if (filters.scoreBands.length > 0) {
      const band = leadScoreBand(lead);
      if (!band || !filters.scoreBands.includes(band)) return false;
    }
    return true;
  });
}

export interface FilterOption<T extends string> {
  value: T;
  count: number;
}

/**
 * The status choices for a bucket's leads: each status present, with its count, in lifecycle order (an
 * unknown status last). A picked status stays on offer at 0, so the operator can always unpick it.
 */
export function queueStatusOptions(leads: readonly FilterableLead[], picked: readonly string[] = []): FilterOption<string>[] {
  const counts = new Map<string, number>(picked.map((status) => [status, 0]));
  for (const { status } of leads) counts.set(status, (counts.get(status) ?? 0) + 1);
  const rank = (status: string) => {
    const at = (LEAD_STATUSES as readonly string[]).indexOf(status);
    return at < 0 ? LEAD_STATUSES.length : at;
  };
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value));
}

/** Leads per score band, for every band, from a bucket's leads */
export function scoreBandOptions(leads: readonly FilterableLead[]): FilterOption<ScoreBand>[] {
  return SCORE_BANDS.map((value) => ({ value, count: leads.filter((lead) => leadScoreBand(lead) === value).length }));
}

/** The list with `value` added, or removed when it was there */
export const toggleValue = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

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
