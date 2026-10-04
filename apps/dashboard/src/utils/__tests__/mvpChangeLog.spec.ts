import { describe, it, expect, vi } from 'vitest';
import i18n from 'i18next';
import {
  REBUILD_CHANGE_KINDS,
  REBUILD_FALLBACK_REASONS,
  REBUILD_OMISSION_REASONS,
  REBUILD_OMISSIONS,
  STANDARDS_CHECKS,
} from '@revamp/shared-types';
import type { IMvpRebuildSummary, RebuildChangeKind, StandardsCheck } from '@revamp/shared-types';
import '../../i18n/index.js';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages.js';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { renderChangeText } from '../../components/leadReview/MvpChangeLog.js';
import {
  CHANGE_KIND_GROUPS,
  CHANGE_KIND_KEYS,
  MEASURED_KINDS,
  buildMvpChangeLog,
  changeEntry,
  groupChangeLog,
  omissionEntries,
  showInPreview,
  type ChangeEntry,
  type ChangeText,
} from '../mvpChangeLog.js';

const audit = (overrides: Partial<IAuditDetail> = {}): IAuditDetail => ({
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: [],
  colorPalette: {},
  measurementErrors: [],
  designCritiqueFallback: false,
  ...overrides,
});

const rebuild = (over: Partial<IMvpRebuildSummary> = {}): IMvpRebuildSummary => ({
  coverage: 0.95,
  sections: 4,
  omitted: [],
  tuning: [],
  level: 'faithful',
  ...over,
});

const rebuilt = (summary: Partial<IMvpRebuildSummary> = {}, over: Partial<IMvpProjectDetail> = {}): IMvpProjectDetail => ({
  leadId: 'lead-1',
  fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/demo/index.html',
  layout: { variant: 'original', reasons: ['rule:rebuild'] },
  rebuild: rebuild(summary),
  ...over,
});

/** A code of each kind, both sources for the design changes */
const SAMPLE_CODES: Record<RebuildChangeKind, string[]> = {
  contrast: ['contrast:3'],
  overlay: ['overlay:1'],
  alt: ['alt:4'],
  'h1-hidden': ['h1:hidden'],
  'font-body': ['font:body-16'],
  'line-height': ['line-height:1.5'],
  collapse: ['collapse:5'],
  'booking-replaced': ['booking:replaced'],
  'booking-appended': ['booking:appended'],
  'hero-cta': ['modernize:hero-cta', 'edit:hero-cta'],
  'footer-added': ['footer:added'],
  'seo-description': ['seo:description'],
  'seo-og': ['seo:og'],
  'seo-jsonld': ['seo:jsonld'],
  style: ['modernize:style:2', 'edit:style:2'],
  cards: ['modernize:cards:2', 'edit:cards:2'],
  side: ['modernize:side:2', 'edit:side:2'],
  fill: ['modernize:fill:2', 'edit:fill:2'],
  'hero-photo': ['modernize:hero-photo:s-4.m0', 'edit:hero-photo:s-4.m0'],
  type: ['modernize:type', 'edit:type'],
  theme: ['modernize:theme', 'edit:theme'],
  order: ['edit:order'],
  'css-dropped': ['edit:css-dropped'],
};

const FULL_FACTS: Record<string, IMvpRebuildSummary['facts']> = {
  contrast: [{ code: 'contrast:3', section: 'Our services', from: '#9a9a9a', to: '#595959', background: '#ffffff', ratioBefore: 2.84, ratioAfter: 7.0 }],
  overlay: [{ code: 'overlay:1', value: 0.55 }],
  collapse: [{ code: 'collapse:5', value: 2260 }],
  'font-body': [{ code: 'font:body-16', from: 14, to: 16 }],
  'line-height': [{ code: 'line-height:1.5', from: 1.25, to: 1.5 }],
};

const texts = (entry: ChangeEntry): ChangeText[] => [entry.what, entry.why, entry.effect, ...(entry.note ? [entry.note] : [])];

/** Every template of an entry, its refs included, exists in the language and is filled in completely */
function expectExplained(entry: ChangeEntry, language: string) {
  const t = i18n.getFixedT(language);
  const check = (text: ChangeText) => {
    expect(i18n.exists(text.key, { lng: language, fallbackLng: false }), `${language}: ${text.key}`).toBe(true);
    Object.values(text.refs ?? {}).forEach(check);
    const rendered = renderChangeText(t, text);
    expect(rendered, `${language}: ${text.key}`).not.toMatch(/{{|}}/);
    expect(rendered.trim()).not.toBe('');
  };
  texts(entry).forEach(check);
}

describe('change explanations are complete (REV-119)', () => {
  it('maps every change kind to a group and a template', () => {
    expect(Object.keys(CHANGE_KIND_GROUPS).sort()).toEqual([...REBUILD_CHANGE_KINDS].sort());
    expect(Object.keys(CHANGE_KIND_KEYS).sort()).toEqual([...REBUILD_CHANGE_KINDS].sort());
    expect(Object.keys(SAMPLE_CODES).sort()).toEqual([...REBUILD_CHANGE_KINDS].sort());
  });

  for (const language of SUPPORTED_LANGUAGES) {
    it(`explains every change kind, measured and unmeasured, in ${language}`, () => {
      for (const kind of REBUILD_CHANGE_KINDS) {
        for (const code of SAMPLE_CODES[kind]) {
          const entry = changeEntry(code, FULL_FACTS[kind]?.[0], ['rule:rebuild', 'modernize:dated', 'dated:5']);
          expect(entry.what.key, code).not.toContain('unknown');
          expectExplained(entry, language);
          if (MEASURED_KINDS.has(kind)) expectExplained(changeEntry(code, undefined, []), language);
        }
      }
    });

    it(`explains every omission kind and reason in ${language}`, () => {
      for (const what of REBUILD_OMISSIONS) {
        for (const reason of REBUILD_OMISSION_REASONS[what]) {
          const [entry] = omissionEntries([{ what, reason, sample: 'Blog' }]);
          expect(entry!.why.key).not.toContain('unknown');
          expectExplained(entry!, language);
        }
      }
    });

    it(`explains the template, the levels, performance and every standards check in ${language}`, () => {
      const entries: ChangeEntry[] = [];
      for (const reason of REBUILD_FALLBACK_REASONS) {
        entries.push(...buildMvpChangeLog({ leadId: 'l', fullPreviewUrl: 'u', layout: { variant: 'bento', reasons: ['rule:manual', reason, 'coverage:0.4'] } }, null)!);
      }
      entries.push(...buildMvpChangeLog({ leadId: 'l', fullPreviewUrl: 'u', layout: { variant: 'split', reasons: ['rule:text_heavy'] } }, null)!);
      entries.push(...buildMvpChangeLog({ leadId: 'l', fullPreviewUrl: 'u', layout: { variant: 'split', reasons: [] } }, null)!);
      for (const level of ['faithful', 'modern'] as const) {
        for (const reasons of [['modernize:manual'], ['modernize:dated', 'dated:4'], ['modernize:dated'], ['modernize:default']]) {
          entries.push(...buildMvpChangeLog(rebuilt({ level }, { layout: { variant: 'original', reasons } }), null)!);
        }
      }
      const measuredAt = '2026-10-04T10:00:00Z';
      for (const performance of [
        { webVitals: { lcp: 900, cls: 0.01 }, score: 100, host: 'localhost:9000', measuredAt },
        { webVitals: { lcp: 9000, cls: 0.4 }, score: 10, host: 'localhost:9000', measuredAt },
        { webVitals: {}, host: 'localhost:9000', measuredAt, error: 'timeout' },
      ]) {
        entries.push(...buildMvpChangeLog(rebuilt({}, { performance }), audit({ lcpSeconds: 4.8, cls: 0.2 }))!);
        entries.push(...buildMvpChangeLog(rebuilt({}, { performance }), audit())!);
      }
      const all = Object.fromEntries(STANDARDS_CHECKS.map((c) => [c, true])) as Record<StandardsCheck, boolean>;
      const none = Object.fromEntries(STANDARDS_CHECKS.map((c) => [c, false])) as Record<StandardsCheck, boolean>;
      entries.push(...buildMvpChangeLog(rebuilt({}, { standards: { checks: all, score: 100 } }), audit({ standardsChecks: none }))!);
      entries.push(...buildMvpChangeLog(rebuilt({}, { standards: { checks: none, score: 0 } }), audit({ standardsChecks: all }))!);
      const ids = new Set(entries.map((entry) => entry.id));
      expect(ids).toEqual(expect.objectContaining({ size: expect.any(Number) }));
      for (const check of STANDARDS_CHECKS.filter((c) => c !== 'https')) {
        expect(ids.has(`standards:fixed:${check}`), check).toBe(true);
        expect(ids.has(`standards:regressed:${check}`), check).toBe(true);
      }
      entries.forEach((entry) => expectExplained(entry, language));
    });
  }
});

describe('buildMvpChangeLog (REV-119)', () => {
  const en = i18n.getFixedT('en');
  const say = (text: ChangeText) => renderChangeText(en, text);

  it('tells a contrast fix with its measured colors and ratios, in its section, linked to the preview', () => {
    const log = buildMvpChangeLog(rebuilt({ tuning: ['contrast:3'], facts: FULL_FACTS.contrast }), audit())!;
    const entry = log.find((e) => e.id === 'code:contrast:3')!;
    expect(entry).toMatchObject({ group: 'accessibility', tone: 'improved', section: 'Our services', anchor: 's-3' });
    expect(say(entry.what)).toBe('Text color changed from #9a9a9a to #595959 on #ffffff');
    expect(say(entry.why)).toBe('Its contrast was 2.8:1, below the WCAG AA minimum of 4.5:1; it is now 7.0:1.');
    expect(say(entry.effect)).toBe('Readable in bright light and for visitors with low vision.');
  });

  it('says a value was not recorded instead of guessing, for a summary saved before the facts', () => {
    const log = buildMvpChangeLog(rebuilt({ tuning: ['contrast:3', 'font:body-16'] }), audit())!;
    const contrast = log.find((e) => e.id === 'code:contrast:3')!;
    // The heading was not recorded either: no section name, never "untitled"; the preview link still works
    expect(contrast).not.toHaveProperty('section');
    expect(contrast.anchor).toBe('s-3');
    expect(say(contrast.why)).toContain('were not recorded for this page');
    expect(say(contrast.what)).not.toMatch(/#/);
    expect(say(log.find((e) => e.id === 'code:font:body-16')!.why)).toContain('was not recorded');
  });

  it('names a section without a heading as untitled only when the summary recorded headings', () => {
    const log = buildMvpChangeLog(rebuilt({ tuning: ['edit:style:2'], facts: [] }), audit())!;
    expect(log.find((e) => e.id === 'code:edit:style:2')).toMatchObject({ section: null, anchor: 's-2', group: 'edits' });
  });

  it('counts the alt texts and groups readability, booking and SEO codes', () => {
    const log = buildMvpChangeLog(rebuilt({ tuning: ['alt:4', 'line-height:1.5', 'booking:replaced', 'seo:og'], facts: FULL_FACTS['line-height'] }), audit())!;
    expect(say(log.find((e) => e.id === 'code:alt:4')!.what)).toBe('Alt text added to 4 images, from their caption or section heading');
    expect(log.find((e) => e.id === 'code:line-height:1.5')!.group).toBe('readability');
    expect(log.find((e) => e.id === 'code:booking:replaced')).toMatchObject({ group: 'booking', anchor: 'booking' });
    expect(log.find((e) => e.id === 'code:seo:og')!.group).toBe('seo');
  });

  it('puts the modernize layer under design with the dated score, and the operator`s edits under edits', () => {
    const log = buildMvpChangeLog(
      rebuilt({ level: 'modern', tuning: ['modernize:cards:2', 'edit:order', 'edit:css-dropped'] }, { layout: { variant: 'original', reasons: ['rule:rebuild', 'modernize:dated', 'dated:5'] } }),
      audit(),
    )!;
    const cards = log.find((e) => e.id === 'code:modernize:cards:2')!;
    expect(cards).toMatchObject({ group: 'design', anchor: 's-2' });
    expect(say(cards.why)).toBe('Part of the modernized look: the original was detected as dated (score 5).');
    expect(log.find((e) => e.id === 'code:edit:order')!.group).toBe('edits');
    expect(log.find((e) => e.id === 'code:edit:css-dropped')!.tone).toBe('lost');
    expect(say(log.find((e) => e.id === 'render:level')!.what)).toContain('Modernized rebuild');
  });

  it('lists omissions per kind and reason with their samples, as what visitors lose', () => {
    const entries = omissionEntries([
      { what: 'nav_link', reason: 'other_page', sample: 'Blog' },
      { what: 'nav_link', reason: 'other_page', sample: 'Cennik' },
      { what: 'nav_link', reason: 'other_page', sample: 'Blog' },
      { what: 'section', reason: 'hidden' },
    ]);
    expect(entries.map((e) => e.id)).toEqual(['omitted:section:hidden', 'omitted:nav_link:other_page']);
    const links = entries[1]!;
    expect(links).toMatchObject({ group: 'omitted', tone: 'lost', samples: ['Blog', 'Cennik'] });
    expect(say(links.what)).toBe('Menu links left out: 3');
    expect(say(links.why)).toBe('It leads to another page; the prototype is the home page only.');
  });

  it('shows an unknown code or reason as recorded rather than dropping it', () => {
    expect(changeEntry('future:thing', undefined, []).what).toEqual({ key: 'mvpChangeLog.changes.unknown.what', values: { code: 'future:thing' } });
    expect(say(omissionEntries([{ what: 'link', reason: 'later' }])[0]!.why)).toContain('"later"');
  });

  it('compares the prototype`s measured vitals with the original`s, with where they were measured', () => {
    const performance = { webVitals: { lcp: 1240, cls: 0.02 }, score: 100, host: 'localhost:9000', measuredAt: '2026-10-04T10:00:00Z' };
    const log = buildMvpChangeLog(rebuilt({}, { performance }), audit({ lcpSeconds: 4.8, cls: 0.31 }))!;
    const lcp = log.find((e) => e.id === 'performance:lcp')!;
    expect(lcp).toMatchObject({ group: 'performance', tone: 'improved' });
    expect(say(lcp.what)).toBe('Largest content shown after 1.2 s (original: 4.8 s)');
    expect(say(lcp.note!)).toContain('localhost:9000');
    // When it was measured, as a date in the operator's language
    expect(say(lcp.note!)).toMatch(/^Measured \d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2}/);
    expect(say(log.find((e) => e.id === 'performance:cls')!.what)).toBe('Layout shift while loading: 0.02 (original: 0.31)');
  });

  it('marks a slower prototype as lost and never compares with an unmeasured original', () => {
    const performance = { webVitals: { lcp: 6000, cls: 0 }, score: 40, host: 'h', measuredAt: '2026-10-04T10:00:00Z' };
    const slower = buildMvpChangeLog(rebuilt({}, { performance }), audit({ lcpSeconds: 2, cls: 0 }))!;
    expect(slower.find((e) => e.id === 'performance:lcp')!.tone).toBe('lost');
    expect(slower.find((e) => e.id === 'performance:cls')!.tone).toBe('info');
    const unmeasured = buildMvpChangeLog(rebuilt({}, { performance }), audit())!;
    expect(say(unmeasured.find((e) => e.id === 'performance:lcp')!.why)).toContain('was not measured');
  });

  it('says why the prototype could not be measured, without a number', () => {
    const performance = { webVitals: {}, host: 'h', measuredAt: '2026-10-04T10:00:00Z', error: 'net::ERR_CONNECTION_REFUSED' };
    const log = buildMvpChangeLog(rebuilt({}, { performance }), audit({ lcpSeconds: 3 }))!;
    const lcp = log.find((e) => e.id === 'performance:lcp')!;
    expect(say(lcp.why)).toBe('The measurement failed: net::ERR_CONNECTION_REFUSED');
    expect(log.some((e) => e.id === 'performance:cls')).toBe(false);
  });

  it('explains a Bento page by its fallback reason or rule and lists its fixed checks, ignoring a stale rebuild summary', () => {
    const none = Object.fromEntries(STANDARDS_CHECKS.map((c) => [c, false])) as Record<StandardsCheck, boolean>;
    const mvp: IMvpProjectDetail = {
      leadId: 'l',
      fullPreviewUrl: 'u',
      layout: { variant: 'bento', reasons: ['rule:manual', 'manual:original', 'rebuild:low_coverage', 'coverage:0.42'] },
      rebuild: rebuild({ tuning: ['contrast:1'] }),
      standards: { checks: { ...none, viewport: true, title: true }, score: 30 },
    };
    const log = buildMvpChangeLog(mvp, audit({ standardsChecks: none }))!;
    expect(log.map((e) => e.id)).toEqual(['standards:fixed:viewport', 'standards:fixed:title', 'render:template']);
    const template = log.find((e) => e.id === 'render:template')!;
    expect(say(template.what)).toContain('Bento');
    expect(say(template.why)).toBe('Only 42% of the original page could be read, so the template was used.');
    expect(say(log[0]!.effect)).toBe('Sized for phones. Without it the page opens zoomed out on mobile.');
  });

  it('does not list a check twice when an SEO code already tells it', () => {
    const none = Object.fromEntries(STANDARDS_CHECKS.map((c) => [c, false])) as Record<StandardsCheck, boolean>;
    const log = buildMvpChangeLog(
      rebuilt({ tuning: ['seo:og'] }, { standards: { checks: { ...none, openGraph: true, title: true }, score: 20 } }),
      audit({ standardsChecks: none }),
    )!;
    expect(log.filter((e) => e.group === 'seo').map((e) => e.id)).toEqual(['code:seo:og', 'standards:fixed:title']);
  });

  it('orders entries by group and returns null without an MVP', () => {
    const log = buildMvpChangeLog(rebuilt({ tuning: ['booking:appended', 'alt:2'], omitted: [{ what: 'image', reason: 'not_http' }] }), audit())!;
    expect(groupChangeLog(log).map((g) => g.group)).toEqual(['accessibility', 'booking', 'design', 'omitted']);
    expect(buildMvpChangeLog(null, audit())).toBeNull();
  });
});

describe('showInPreview (REV-119)', () => {
  it('navigates the frame to the anchor of the page it shows, without the old fragment', () => {
    const replace = vi.fn();
    const frame = { contentWindow: { location: { replace } } } as unknown as HTMLIFrameElement;
    expect(showInPreview(frame, 'http://minio/v/index.html?v=3#s-1', 's-4')).toBe(true);
    expect(replace).toHaveBeenCalledWith('http://minio/v/index.html?v=3#s-4');
  });

  it('does nothing without a frame or a page, and survives a refused navigation', () => {
    expect(showInPreview(null, 'http://minio/v', 's-1')).toBe(false);
    const frame = { contentWindow: { location: { replace: () => { throw new Error('blocked'); } } } } as unknown as HTMLIFrameElement;
    expect(showInPreview(frame, 'http://minio/v', 's-1')).toBe(false);
    expect(showInPreview(frame, '', 's-1')).toBe(false);
  });
});
