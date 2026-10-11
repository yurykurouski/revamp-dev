import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { MvpChangeSummary } from '../leadReview/MvpChangeSummary.js';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { en } from '../../i18n/locales/en.js';
import { ru } from '../../i18n/locales/ru.js';
import { pl } from '../../i18n/locales/pl.js';
import { lt } from '../../i18n/locales/lt.js';
import { be } from '../../i18n/locales/be.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: ['Add a sticky call button'],
  colorPalette: { primary: '#aa0000' },
  measurementErrors: [],
  designCritiqueFallback: false,
  lcpSeconds: 3.2,
  cls: 0.21,
  a11yViolationsCount: 7,
};

const fullMvp: IMvpProjectDetail = {
  leadId: 'lead-1',
  fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/demo/index.html',
  performance: { webVitals: { lcp: 1400, cls: 0.02 }, host: 'demo.example', measuredAt: '2026-10-10T12:00:00.000Z' },
  completenessReport: {
    status: 'verified',
    hasCriticalIssues: true,
    checkedAt: '2026-10-10T00:00:00Z',
    checks: [
      { field: 'phone', tier: 'critical', status: 'present' },
      { field: 'address', tier: 'critical', status: 'missing' },
    ],
  },
};

const render = (mvp: IMvpProjectDetail | null, auditDetail: IAuditDetail | null = audit) =>
  renderToStaticMarkup(React.createElement(MvpChangeSummary, { mvp, audit: auditDetail }));

/** The rendered text without tags, so assertions read like the screen */
const textOf = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '|');

describe('MvpChangeSummary: measured facts only (REV-140)', () => {
  afterEach(() => {
    useLanguageStore.getState().setLanguage('en');
  });

  it('renders nothing before an MVP is generated', () => {
    expect(render(null)).toBe('');
  });

  it('compares loading speed with the original, naming where the MVP was measured', () => {
    const text = textOf(render(fullMvp));
    expect(text).toContain(`|${en.mvpChanges.performance}|`);
    expect(text).toMatch(/\|3\.2\|.*\|1\.4\|/);
    expect(text).toMatch(/\|0\.21\|.*\|0\.02\|/);
    expect(text).toContain('MVP measured on demo.example');
  });

  it('says why the speed was not measured', () => {
    const text = textOf(render({ ...fullMvp, performance: { webVitals: {}, host: 'demo.example', measuredAt: '2026-10-10T12:00:00.000Z', error: 'navigation timeout' } }));
    expect(text).toContain('speed was not measured: navigation timeout');
  });

  it("shows the original's accessibility violations and that the MVP's are not measured", () => {
    const text = textOf(render(fullMvp));
    expect(text).toContain('7 accessibility violations on the original');
    expect(text).toContain(en.mvpChanges.a11yNotMeasured);
  });

  it('keeps the business data card', () => {
    const text = textOf(render(fullMvp));
    expect(text).toContain(`|${en.mvpChanges.businessData}|`);
    expect(text).toContain('1 of 2 key facts');
  });

  it('shows no layout, copy, palette or critique', () => {
    const text = textOf(render({ ...fullMvp, layout: { variant: 'editorial', reasons: ['rule:professional_niche'] }, provider: 'deterministic' } as IMvpProjectDetail));
    expect(text).not.toContain('Add a sticky call button');
    expect(text).not.toContain('Editorial');
    expect(text).not.toContain('Every change, with its reason');
  });

  it('says so when nothing was measured', () => {
    expect(textOf(render({ leadId: 'lead-1', fullPreviewUrl: 'x' }, null))).toContain(en.mvpChanges.empty);
  });

  it('follows the interface language', () => {
    useLanguageStore.getState().setLanguage('ru');
    expect(render(fullMvp)).toContain(ru.mvpChanges.title);
  });

  it('has every string in every language', () => {
    const keys = (locale: typeof en) => [...Object.keys(locale.mvpChanges), ...Object.keys(locale.mvpChanges.tags)];
    for (const locale of [ru, pl, lt, be]) {
      expect(keys(locale)).toEqual(keys(en));
    }
  });
});

describe('MvpChangeSummary SEO card (REV-118)', () => {
  const standardsChecks = {
    https: true, viewport: true, title: true, metaDescription: false, singleH1: true, favicon: true, structuredData: false, openGraph: false,
  };

  it('shows the standards score before and after, and the checks the MVP fixed', () => {
    const text = textOf(
      render(
        { ...fullMvp, standards: { checks: { ...standardsChecks, metaDescription: true, openGraph: true }, score: 90 } },
        { ...audit, standardsChecks },
      ),
    );
    expect(text).toContain(`|${en.mvpChanges.seo.replace('&', '&amp;')}|`);
    expect(text).toContain(`|${en.mvpChanges.tags.improved}|`);
    expect(text).toMatch(/\|70\|.*\|90\|/);
    expect(text).toContain(en.mvpChanges.seoScore);
    expect(text).toContain(`The MVP fixes: ${en.seo.checks.metaDescription}, ${en.seo.checks.openGraph}`);
  });
});

describe("MvpChangeSummary: the page model's design changes (REV-162)", () => {
  const changes = [
    { change: 'Moved the services up', reason: 'Visitors see the offer first.' },
    { change: 'Darkened the header', reason: 'The menu stands out.' },
  ];
  const withChanges = (extra: Partial<IMvpProjectDetail> = {}): IMvpProjectDetail => ({
    ...fullMvp,
    versions: [{ n: 1, kind: 'generate', storagePath: 'v/demo/versions/1.html', createdAt: '2026-10-11T00:00:00Z', changes }],
    ...extra,
  });

  afterEach(() => {
    useLanguageStore.getState().setLanguage('en');
  });

  it('lists each change with its reason, under the measured blocks', () => {
    const text = textOf(render(withChanges()));
    expect(text).toContain(`|${en.mvpChanges.design.title}|`);
    expect(text).toContain(`|${en.mvpChanges.design.caption}|`);
    for (const { change, reason } of changes) {
      expect(text).toContain(`|${change}|`);
      expect(text).toContain(`|${reason}|`);
    }
    expect(text.indexOf(en.mvpChanges.design.title)).toBeGreaterThan(text.indexOf(en.mvpChanges.businessData));
  });

  it("shows the palette label only when the operator's colors or fonts are applied", () => {
    // React escapes the apostrophe in static markup
    const label = en.mvpChanges.design.controlsApplied.replace("'", '&#x27;');
    expect(textOf(render(withChanges({ controls: { primary: '#000000' } })))).toContain(label);
    expect(textOf(render(withChanges()))).not.toContain(label);
  });

  it('renders no design block and no placeholder without a list', () => {
    const text = textOf(render(fullMvp));
    expect(text).not.toContain(en.mvpChanges.design.title);
    expect(text).not.toContain(en.mvpChanges.design.caption);
  });

  it('shows the list as stored, whatever the dashboard language', () => {
    useLanguageStore.getState().setLanguage('pl');
    const text = textOf(render(withChanges()));
    expect(text).toContain(`|${pl.mvpChanges.design.title}|`);
    expect(text).toContain(`|${changes[0]!.change}|`);
  });

  it('labels the block in every language', () => {
    for (const dict of [en, ru, pl, lt, be]) {
      for (const key of ['title', 'caption', 'controlsApplied'] as const) expect(dict.mvpChanges.design[key].length).toBeGreaterThan(0);
    }
  });
});

