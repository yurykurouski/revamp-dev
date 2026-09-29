import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { MvpChangeSummary } from '../leadReview/MvpChangeSummary.js';
import type { IMvpGeneratedContent, IMvpProject } from '@revamp/shared-types';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { en } from '../../i18n/locales/en.js';
import { ru } from '../../i18n/locales/ru.js';
import { pl } from '../../i18n/locales/pl.js';
import { lt } from '../../i18n/locales/lt.js';
import { be } from '../../i18n/locales/be.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';

/** Stored copy and palette as older or malformed records hold them; the summary reads them defensively */
const content = (value: object) => value as IMvpGeneratedContent;
const palette = (value: Partial<IMvpProjectDetail['colorPalette']>) => value as IMvpProject['colorPalette'];

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: ['Add a sticky call button'],
  colorPalette: { primary: '#aa0000' },
  measurementErrors: [],
  designCritiqueFallback: false,
  originalServiceCount: 2,
};

const fullMvp: IMvpProjectDetail = {
  leadId: 'lead-1',
  fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/demo/index.html',
  layout: { variant: 'editorial', reasons: ['rule:professional_niche'] },
  provider: 'deterministic',
  generatedContent: content({
    about: { heading: 'About', body: 'Since 1999' },
    services: [{ title: 'Contracts' }, { title: 'Disputes' }, { title: 'Tax' }],
    trustSignals: [{ metric: '25', label: 'years' }],
  }),
  colorPalette: palette({ primary: '#0000aa' }),
  completenessReport: {
    status: 'verified',
    hasCriticalIssues: true,
    checkedAt: '2026-09-27T00:00:00Z',
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

describe('MvpChangeSummary (REV-81)', () => {
  afterEach(() => {
    useLanguageStore.getState().setLanguage('en');
  });

  it('renders nothing before an MVP is generated', () => {
    expect(render(null)).toBe('');
  });

  it('shows every recorded change as a tagged card with full data', () => {
    const text = textOf(render(fullMvp));
    expect(text).toContain(en.mvpChanges.title);
    // Layout and why
    expect(text).toContain(`|${en.mvpLayout.variants.editorial}|`);
    expect(text).toContain(en.mvpLayout.rules.professional_niche);
    expect(text).toContain(`|${en.mvpChanges.tags.newLayout}|`);
    // Copy source
    expect(text).toContain(en.llm.deterministic);
    expect(text).toContain(`|${en.mvpChanges.tags.template}|`);
    // Sections: 2 → 3 services, 1 trust signal, about
    expect(text).toMatch(/\|2\|.*\|3\|/);
    expect(text).toContain(en.mvpChanges.servicesCompared);
    expect(text).toContain(en.mvpChanges.trustSignals);
    expect(text).toContain(en.mvpChanges.aboutSection);
    // Palette changed
    expect(text).toContain('|#aa0000|');
    expect(text).toContain('|#0000aa|');
    expect(text).toContain(`|${en.mvpChanges.tags.changed}|`);
    // Business data
    expect(text).toContain('|1/2|');
    expect(text).toContain('1 of 2 key facts');
    expect(text).toContain('Address: Missing');
    expect(text).toContain('Issues: 1');
    // Critique guidance, marked as unchecked
    expect(text).toContain('Add a sticky call button');
    expect(text).toContain(en.mvpChanges.critiqueNote);
  });

  it('shows only the parts that were recorded with partial data', () => {
    const text = textOf(
      render(
        { leadId: 'lead-1', fullPreviewUrl: 'x', generatedContent: content({ services: [] }), colorPalette: palette({ primary: '#5c5bed' }) },
        null,
      ),
    );
    expect(text).toContain(en.mvpChanges.paletteDefault);
    expect(text).toContain(`|${en.mvpChanges.tags.default}|`);
    for (const absent of [
      en.mvpChanges.layout,
      en.mvpChanges.copy,
      en.mvpChanges.sections,
      en.mvpChanges.businessData,
      en.mvpChanges.critique,
      en.mvpChanges.aboutSection,
      en.mvpChanges.trustSignals,
    ]) {
      expect(text).not.toContain(`|${absent}|`);
    }
  });

  it('does not claim the original site has no services when the crawler found no list', () => {
    const text = textOf(
      render(
        { leadId: 'lead-1', fullPreviewUrl: 'x', generatedContent: content({ services: [{}, {}] }) },
        { ...audit, originalServiceCount: 0 },
      ),
    );
    expect(text).toContain('|—|');
    expect(text).toContain(en.mvpChanges.servicesNoneFound);
  });

  it('says so when the MVP has no change data at all', () => {
    expect(render({ leadId: 'lead-1', fullPreviewUrl: 'x' }, null)).toContain(en.mvpChanges.empty);
  });

  it('hides what stayed as it was on the original site', () => {
    const text = textOf(
      render(
        {
          leadId: 'lead-1',
          fullPreviewUrl: 'x',
          generatedContent: content({ services: [{}, {}] }),
          colorPalette: palette({ primary: '#AA0000' }),
          completenessReport: {
            status: 'verified',
            hasCriticalIssues: false,
            checkedAt: '',
            checks: [{ field: 'phone', tier: 'critical', status: 'present' }],
          },
        },
        { ...audit, quickWins: [] },
      ),
    );
    for (const absent of [en.mvpChanges.sections, en.mvpChanges.palette, en.mvpChanges.businessData]) {
      expect(text).not.toContain(`|${absent}|`);
    }
    expect(text).toContain(en.mvpChanges.empty);
  });

  it('hides a data check that could not run', () => {
    const text = textOf(
      render(
        {
          leadId: 'lead-1',
          fullPreviewUrl: 'x',
          provider: 'deterministic',
          completenessReport: { status: 'unverified', hasCriticalIssues: false, checks: [], checkedAt: '' },
        },
        null,
      ),
    );
    expect(text).not.toContain(`|${en.mvpChanges.businessData}|`);
    expect(text).toContain(`|${en.mvpChanges.copy}|`);
  });

  it('names the LLM that rewrote the copy', () => {
    const text = textOf(render({ ...fullMvp, provider: 'anthropic', modelUsed: 'claude-sonnet-5' }));
    expect(text).toContain('Anthropic API');
    expect(text).toContain(`|${en.mvpChanges.tags.rewritten}|`);
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
