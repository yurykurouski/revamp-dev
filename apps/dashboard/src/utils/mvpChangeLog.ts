import {
  MVP_LAYOUT_MODERNIZE_REASONS,
  MVP_LAYOUT_VARIANTS,
  REBUILD_OMISSION_REASONS,
  REBUILD_OMISSIONS,
} from '@revamp/shared-types';
import type { IRebuildChangeFact, RebuildChangeKind, RebuildChangeSource, RebuildOmission, StandardsCheck } from '@revamp/shared-types';
import { parseRebuildChange } from '@revamp/validation';
import type { IAuditDetail, IMvpProjectDetail } from '../api/client.js';
import { layoutRuleOf, rebuildFallbackOf } from '../components/MvpLayoutChip.js';
import { seoStandardsView } from './seoStandards.js';

/**
 * Every change the published MVP makes to the original site, each with its reason and what it means for a visitor
 * (REV-119). The entries are built by code from what the renderer recorded (`MvpProject.rebuild`: tuning codes, their
 * facts, omissions, level; `layout.reasons`) and what was measured (`MvpProject.standards`, `MvpProject.performance`,
 * the audit); the words are i18n templates under `mvpChangeLog`. A value nobody measured is said to be missing, never
 * filled in (AGENTS.md §3.2.2).
 */

export const CHANGE_GROUPS = ['accessibility', 'readability', 'performance', 'seo', 'booking', 'design', 'edits', 'omitted'] as const;
export type ChangeGroup = (typeof CHANGE_GROUPS)[number];

/** `improved`: better for visitors; `lost`: something visitors no longer get, or a measured step back; `info`: neither */
export type ChangeTone = 'improved' | 'lost' | 'info';

/**
 * An i18n template and the values it is filled with; a `refs` value is itself translated first (a check's or a
 * layout's name)
 */
export interface ChangeText {
  key: string;
  /** A date is formatted by the template (`{{at, datetime(…)}}`) in the operator's language */
  values?: Record<string, string | number | Date>;
  refs?: Record<string, ChangeText>;
}

/** A template of the change log */
const k = (key: string, values?: ChangeText['values'], refs?: ChangeText['refs']): ChangeText => ({
  key: `mvpChangeLog.${key}`,
  ...(values && Object.keys(values).length ? { values } : {}),
  ...(refs ? { refs } : {}),
});

export interface ChangeEntry {
  /** Unique within a log */
  id: string;
  group: ChangeGroup;
  tone: ChangeTone;
  what: ChangeText;
  why: ChangeText;
  effect: ChangeText;
  /**
   * The section the change is in, as named on the original; `null` for a section without a heading; absent when the
   * summary was saved before headings were recorded
   */
  section?: string | null;
  /** The element id to scroll to in the published page */
  anchor?: string;
  /** What was left out, as recorded (omissions) */
  samples?: string[];
  /** A note under the entry, e.g. where a measurement was taken */
  note?: ChangeText;
}

/** Which group each kind of tuning code belongs to; a design change goes to `edits` when the operator asked for it */
export const CHANGE_KIND_GROUPS: Record<RebuildChangeKind, ChangeGroup | 'by-source'> = {
  contrast: 'accessibility',
  overlay: 'accessibility',
  alt: 'accessibility',
  'h1-hidden': 'accessibility',
  'font-body': 'readability',
  'line-height': 'readability',
  collapse: 'readability',
  'booking-replaced': 'booking',
  'booking-appended': 'booking',
  'hero-cta': 'by-source',
  'footer-added': 'design',
  'seo-description': 'seo',
  'seo-og': 'seo',
  'seo-jsonld': 'seo',
  style: 'by-source',
  cards: 'by-source',
  side: 'by-source',
  fill: 'by-source',
  'hero-photo': 'by-source',
  type: 'by-source',
  theme: 'by-source',
  order: 'by-source',
  'css-dropped': 'by-source',
  'text-wall': 'readability',
};

/** The template of each kind under `mvpChangeLog.changes` (camel case); kinds with a measured value have an `…Unmeasured` twin */
export const CHANGE_KIND_KEYS: Record<RebuildChangeKind, string> = {
  contrast: 'contrast',
  overlay: 'overlay',
  alt: 'alt',
  'h1-hidden': 'h1Hidden',
  'font-body': 'fontBody',
  'line-height': 'lineHeight',
  collapse: 'collapse',
  'booking-replaced': 'bookingReplaced',
  'booking-appended': 'bookingAppended',
  'hero-cta': 'heroCta',
  'footer-added': 'footerAdded',
  'seo-description': 'seoDescription',
  'seo-og': 'seoOg',
  'seo-jsonld': 'seoJsonld',
  style: 'style',
  cards: 'cards',
  side: 'side',
  fill: 'fill',
  'hero-photo': 'heroPhoto',
  type: 'type',
  theme: 'theme',
  order: 'order',
  'css-dropped': 'cssDropped',
  'text-wall': 'textWall',
};

/** Kinds whose text needs a measured value; without the fact they use their `…Unmeasured` template */
export const MEASURED_KINDS: ReadonlySet<RebuildChangeKind> = new Set(['contrast', 'overlay', 'font-body', 'line-height', 'collapse', 'text-wall']);

/** Kinds that take something away from visitors */
const LOSS_KINDS: ReadonlySet<RebuildChangeKind> = new Set(['css-dropped']);

/** Kinds that change nothing and point the operator at something to review (REV-122) */
const NOTICE_KINDS: ReadonlySet<RebuildChangeKind> = new Set(['text-wall']);

/** The SEO check each SEO code adds, so the standards comparison does not list it twice */
const SEO_CODE_CHECKS: Partial<Record<RebuildChangeKind, StandardsCheck>> = {
  'seo-description': 'metaDescription',
  'seo-og': 'openGraph',
  'seo-jsonld': 'structuredData',
};

/** The original text the rebuild folds under "Read more" (`COLLAPSE_CHARS` in the planner) */
export const COLLAPSE_CHARS = 1200;

/** Why the modernize layer chose a design change, from the layout's reasons (REV-114) */
function modernizeWhy(reasons: string[]): ChangeText {
  if (reasons.includes(MVP_LAYOUT_MODERNIZE_REASONS.manual)) return k('sources.modernizeManual');
  if (reasons.includes(MVP_LAYOUT_MODERNIZE_REASONS.dated)) {
    const score = Number(reasons.find((r) => r.startsWith('dated:'))?.slice('dated:'.length));
    return Number.isFinite(score) ? k('sources.modernizeDated', { score }) : k('sources.modernizeDatedUnscored');
  }
  return k('sources.modernize');
}

const sourceWhy = (source: RebuildChangeSource | undefined, reasons: string[]): ChangeText =>
  source === 'edit' ? k('sources.edit') : modernizeWhy(reasons);

/** The template values of a measured change, or undefined when the fact lacks one it needs */
function measuredValues(kind: RebuildChangeKind, fact: IRebuildChangeFact | undefined): Record<string, string | number> | undefined {
  if (!fact) return undefined;
  switch (kind) {
    case 'contrast': {
      const { from, to, background, ratioBefore, ratioAfter } = fact;
      if (from === undefined || to === undefined || !background || ratioBefore === undefined || ratioAfter === undefined) return undefined;
      return { from, to, background, before: ratioBefore.toFixed(1), after: ratioAfter.toFixed(1) };
    }
    case 'overlay':
      return fact.value === undefined ? undefined : { percent: Math.round(fact.value * 100) };
    case 'collapse':
      return fact.value === undefined ? undefined : { chars: fact.value, limit: COLLAPSE_CHARS };
    case 'text-wall':
      return fact.value === undefined || fact.median === undefined ? undefined : { paragraphs: fact.value, median: fact.median };
    case 'font-body':
    case 'line-height':
      return fact.from === undefined || fact.to === undefined ? undefined : { from: fact.from, to: fact.to };
    default:
      return undefined;
  }
}

/** The entry of one tuning code, or an `unknown` one for a code no kind covers (shown as recorded, nothing explained) */
export function changeEntry(code: string, fact: IRebuildChangeFact | undefined, reasons: string[], factsRecorded = true): ChangeEntry {
  const change = parseRebuildChange(code);
  if (!change) {
    return {
      id: `code:${code}`,
      group: 'design',
      tone: 'info',
      what: k('changes.unknown.what', { code }),
      why: k('changes.unknown.why'),
      effect: k('changes.unknown.effect'),
    };
  }
  const { kind, source, section, count } = change;
  const mapped = CHANGE_KIND_GROUPS[kind];
  const group: ChangeGroup = mapped === 'by-source' ? (source === 'edit' ? 'edits' : 'design') : mapped;
  let base = `changes.${CHANGE_KIND_KEYS[kind]}`;
  let values: Record<string, string | number> = count !== undefined ? { count } : {};
  if (MEASURED_KINDS.has(kind)) {
    const measured = measuredValues(kind, fact);
    if (measured) values = measured;
    else base = `${base}Unmeasured`;
  }
  const bySource = mapped === 'by-source';
  return {
    id: `code:${code}`,
    group,
    tone: LOSS_KINDS.has(kind) ? 'lost' : NOTICE_KINDS.has(kind) ? 'info' : 'improved',
    what: k(`${base}.what`, values),
    why: bySource ? sourceWhy(source, reasons) : k(`${base}.why`, values),
    effect: k(`${base}.effect`, values),
    ...(section !== undefined && kind !== 'hero-photo'
      ? { anchor: `s-${section}`, ...(fact?.section ? { section: fact.section } : factsRecorded ? { section: null } : {}) }
      : {}),
    ...(kind === 'hero-photo' && fact?.section ? { section: fact.section } : {}),
    ...(kind === 'booking-replaced' || kind === 'booking-appended' ? { anchor: 'booking', ...(fact?.section ? { section: fact.section } : {}) } : {}),
  };
}

/** Omissions of one kind and reason as one entry, with the recorded samples (REV-119) */
export function omissionEntries(omitted: NonNullable<IMvpProjectDetail['rebuild']>['omitted']): ChangeEntry[] {
  const groups = new Map<string, { what: RebuildOmission; reason: string; count: number; samples: string[] }>();
  for (const { what, reason, sample } of omitted) {
    const id = `${what}:${reason}`;
    const entry = groups.get(id) ?? { what, reason, count: 0, samples: [] };
    entry.count += 1;
    if (sample?.trim() && !entry.samples.includes(sample.trim())) entry.samples.push(sample.trim());
    groups.set(id, entry);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => REBUILD_OMISSIONS.indexOf(a.what) - REBUILD_OMISSIONS.indexOf(b.what))
    .map(([id, { what, reason, count, samples }]) => {
      const known = (REBUILD_OMISSION_REASONS[what] as readonly string[]).includes(reason);
      return {
        id: `omitted:${id}`,
        group: 'omitted' as const,
        tone: 'lost' as const,
        what: k(`omitted.items.${what}`, { count }),
        why: known ? k(`omitted.reasons.${what}.${reason}.why`) : k('omitted.unknown.why', { reason }),
        effect: known ? k(`omitted.reasons.${what}.${reason}.effect`) : k('omitted.unknown.effect'),
        ...(samples.length ? { samples } : {}),
      };
    });
}

/** The prototype's measured LCP and CLS next to the original's (REV-119) */
function performanceEntries(mvp: IMvpProjectDetail, audit: IAuditDetail | null | undefined): ChangeEntry[] {
  const measured = mvp.performance;
  if (!measured) return [];
  // When it was measured: a template switched in place shows the earlier page's numbers until the MVP is read again
  const measuredAt = new Date(measured.measuredAt);
  const note: ChangeText = Number.isNaN(measuredAt.getTime())
    ? k('changes.measuredOn', { host: measured.host })
    : k('changes.measuredOnAt', { host: measured.host, at: measuredAt });
  const { lcp, cls } = measured.webVitals;
  const entries: ChangeEntry[] = [];

  if (lcp === undefined) {
    entries.push({
      id: 'performance:lcp',
      group: 'performance',
      tone: 'info',
      what: k('changes.lcpNotMeasured.what'),
      why: k('changes.lcpNotMeasured.why', { error: measured.error ?? '' }),
      effect: k('changes.lcpNotMeasured.effect'),
      note,
    });
  } else {
    const mvpSeconds = (lcp / 1000).toFixed(1);
    const original = audit?.lcpSeconds;
    if (original === undefined) {
      entries.push({
        id: 'performance:lcp',
        group: 'performance',
        tone: 'info',
        what: k('changes.lcpNoOriginal.what', { mvp: mvpSeconds }),
        why: k('changes.lcpNoOriginal.why'),
        effect: k('changes.lcpNoOriginal.effect'),
        note,
      });
    } else {
      const faster = lcp / 1000 < original;
      entries.push({
        id: 'performance:lcp',
        group: 'performance',
        tone: faster ? 'improved' : 'lost',
        what: k('changes.lcp.what', { mvp: mvpSeconds, original: original.toFixed(1) }),
        why: k('changes.lcp.why'),
        effect: k(faster ? 'changes.lcp.effect' : 'changes.lcp.effectSlower'),
        note,
      });
    }
  }

  if (cls !== undefined) {
    const original = audit?.cls;
    entries.push(
      original === undefined
        ? {
            id: 'performance:cls',
            group: 'performance',
            tone: 'info',
            what: k('changes.clsNoOriginal.what', { mvp: cls.toFixed(2) }),
            why: k('changes.clsNoOriginal.why'),
            effect: k('changes.clsNoOriginal.effect'),
            note,
          }
        : {
            id: 'performance:cls',
            group: 'performance',
            // A shift of the same size is no change to report as better or worse
            tone: cls < original ? 'improved' : cls > original ? 'lost' : 'info',
            what: k('changes.cls.what', { mvp: cls.toFixed(2), original: original.toFixed(2) }),
            why: k('changes.cls.why'),
            effect: k(cls <= original ? 'changes.cls.effect' : 'changes.cls.effectWorse'),
            note,
          },
    );
  }
  return entries;
}

/** The rebuild's level, or the template and why it was used */
function renderEntry(mvp: IMvpProjectDetail): ChangeEntry | undefined {
  const variant = mvp.layout?.variant;
  const reasons = mvp.layout?.reasons ?? [];
  if (!variant || !MVP_LAYOUT_VARIANTS.includes(variant)) return undefined;
  if (variant === 'original' && mvp.rebuild) {
    const modern = mvp.rebuild.level === 'modern';
    return {
      id: 'render:level',
      group: 'design',
      tone: 'info',
      what: k(modern ? 'changes.levelModern.what' : 'changes.levelFaithful.what'),
      why: modern ? modernizeWhy(reasons) : k('changes.levelFaithful.why'),
      effect: k(modern ? 'changes.levelModern.effect' : 'changes.levelFaithful.effect'),
    };
  }
  const fallback = rebuildFallbackOf(reasons);
  const rule = layoutRuleOf(reasons);
  return {
    id: 'render:template',
    group: 'design',
    tone: 'info',
    what: k('changes.template.what', undefined, { variant: { key: `mvpLayout.variants.${variant}` } }),
    // The layout chip's own sentences: why the rebuild could not be used, or which rule picked the template
    why: fallback
      ? {
          key: `mvpLayout.fallback.${fallback.reason.slice('rebuild:'.length)}`,
          ...(fallback.percent !== undefined ? { values: { percent: fallback.percent } } : {}),
        }
      : rule
        ? k('changes.template.whyRule', undefined, { rule: { key: `mvpLayout.rules.${rule}` } })
        : k('changes.template.whyUnknown'),
    effect: k('changes.template.effect'),
  };
}

/** The checks the published page passes or fails unlike the original, except those an SEO code already lists */
function standardsEntries(mvp: IMvpProjectDetail, audit: IAuditDetail | null | undefined, listed: Set<StandardsCheck>): ChangeEntry[] {
  const view = seoStandardsView(audit, mvp);
  if (!view || view.mvpScore === undefined) return [];
  return [
    ...view.fixed
      .filter((check) => !listed.has(check))
      .map((check): ChangeEntry => ({
        id: `standards:fixed:${check}`,
        group: 'seo',
        tone: 'improved',
        what: k('changes.standardsFixed.what', undefined, { check: { key: `seo.checks.${check}` } }),
        why: k('changes.standardsFixed.why'),
        effect: { key: `seo.hints.${check}` },
      })),
    ...view.regressed.map((check): ChangeEntry => ({
      id: `standards:regressed:${check}`,
      group: 'seo',
      tone: 'lost',
      what: k('changes.standardsRegressed.what', undefined, { check: { key: `seo.checks.${check}` } }),
      why: k('changes.standardsRegressed.why'),
      effect: k('changes.standardsRegressed.effect', undefined, { hint: { key: `seo.hints.${check}` } }),
    })),
  ];
}

/** Every change of the published MVP, in group order, or null before an MVP exists */
export function buildMvpChangeLog(mvp: IMvpProjectDetail | null | undefined, audit: IAuditDetail | null | undefined): ChangeEntry[] | null {
  if (!mvp) return null;
  const reasons = mvp.layout?.reasons ?? [];
  // The summary belongs to the rebuilt page; it can outlive a switch to a template until the re-render
  const rebuild = mvp.layout?.variant === 'original' ? mvp.rebuild : undefined;
  const facts = new Map((rebuild?.facts ?? []).map((fact) => [fact.code, fact]));
  const codeEntries = (rebuild?.tuning ?? []).map((code) => changeEntry(code, facts.get(code), reasons, Boolean(rebuild?.facts)));
  const listed = new Set(
    (rebuild?.tuning ?? []).flatMap((code) => {
      const kind = parseRebuildChange(code)?.kind;
      const check = kind ? SEO_CODE_CHECKS[kind] : undefined;
      return check ? [check] : [];
    }),
  );
  const render = renderEntry(mvp);
  const entries = [
    ...(render ? [render] : []),
    ...codeEntries,
    ...performanceEntries(mvp, audit),
    ...standardsEntries(mvp, audit, listed),
    ...omissionEntries(rebuild?.omitted ?? []),
  ];
  // Stable within a group: the order the renderer recorded
  entries.sort((a, b) => CHANGE_GROUPS.indexOf(a.group) - CHANGE_GROUPS.indexOf(b.group));
  return entries;
}

/** The entries of each group that has any, in group order */
export function groupChangeLog(entries: ChangeEntry[]): Array<{ group: ChangeGroup; entries: ChangeEntry[] }> {
  return CHANGE_GROUPS.map((group) => ({ group, entries: entries.filter((entry) => entry.group === group) })).filter((g) => g.entries.length > 0);
}

/**
 * Scrolls the preview to an element of the published page (REV-119): a fragment navigation of the page the frame
 * shows, so it does not reload. The preview is on another origin, so its document is never read; the navigation is
 * the one thing a parent may do there. False when there is no frame or page to navigate.
 */
export function showInPreview(frame: HTMLIFrameElement | null, previewUrl: string, anchor: string): boolean {
  const target = frame?.contentWindow;
  if (!target || !previewUrl) return false;
  try {
    target.location.replace(`${previewUrl.split('#')[0]}#${encodeURIComponent(anchor)}`);
    return true;
  } catch {
    return false;
  }
}
