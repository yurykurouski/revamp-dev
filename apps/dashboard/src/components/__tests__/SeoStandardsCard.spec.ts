import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import type { IMvpStandards, IStandardsChecks } from '@revamp/shared-types';
import { STANDARDS_CHECKS } from '@revamp/shared-types';
import { SeoStandardsCard } from '../SeoStandardsCard.js';
import { en } from '../../i18n/locales/en.js';
import { ru } from '../../i18n/locales/ru.js';
import { pl } from '../../i18n/locales/pl.js';
import { lt } from '../../i18n/locales/lt.js';
import { be } from '../../i18n/locales/be.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';

const original: IStandardsChecks = {
  https: true, viewport: true, title: true, metaDescription: false, singleH1: false, favicon: true, structuredData: false, openGraph: false,
};
const mvp: IMvpStandards = {
  checks: { https: true, viewport: true, title: true, metaDescription: true, singleH1: true, favicon: true, structuredData: true, openGraph: true },
  score: 100,
};

const render = (standardsChecks?: IStandardsChecks, standards?: IMvpStandards) =>
  renderToStaticMarkup(React.createElement(SeoStandardsCard, { audit: { standardsChecks }, mvp: { standards } }));
/** The rendered text without tags, entities decoded, so assertions read like the screen */
const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '|')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const stateOf = (html: string, testId: string) => new RegExp(`data-testid="${testId}" data-state="(\\w+)"`).exec(html)?.[1];

describe('SeoStandardsCard (REV-118)', () => {
  afterEach(() => {
    useLanguageStore.getState().setLanguage('en');
  });

  it('shows every check for the original and the MVP, and the two scores', () => {
    const html = render(original, mvp);
    const text = textOf(html);
    expect(text).toContain(en.seo.title);
    for (const check of STANDARDS_CHECKS) expect(text).toContain(`|${en.seo.checks[check]}|`);
    expect(stateOf(html, 'seo-original-metaDescription')).toBe('failed');
    expect(stateOf(html, 'seo-mvp-metaDescription')).toBe('passed');
    expect(stateOf(html, 'seo-original-https')).toBe('passed');
    // The MVP's HTTPS depends on where it is deployed: orange, not green
    expect(stateOf(html, 'seo-mvp-https')).toBe('hosting');
    expect(html).toContain(`aria-label="${en.seo.hostingDependent}"`);
    expect(html).toMatch(/data-testid="seo-original-score"[^>]*>60\/100</);
    expect(html).toMatch(/data-testid="seo-mvp-score"[^>]*>100\/100</);
    expect(text).toContain(en.seo.httpsNote.replace(/'/g, "'"));
    expect(html).toContain(`aria-label="${en.seo.failed}"`);
  });

  it('shows the original alone, saying the MVP is checked when published', () => {
    const html = render(original);
    expect(html).not.toContain('seo-mvp-');
    expect(textOf(html)).toContain(en.seo.noMvp);
  });

  it('marks the checks an older audit did not read and leaves its score out of the comparison', () => {
    const before: IStandardsChecks = { ...original };
    delete before.metaDescription;
    delete before.singleH1;
    const html = render(before, mvp);
    expect(stateOf(html, 'seo-original-singleH1')).toBe('unknown');
    expect(html).toContain('data-testid="seo-older-audit"');
    expect(html).not.toMatch(/data-testid="seo-original-score"[^>]*>\d/);
  });

  it('says the standards were not measured when neither page was checked', () => {
    const text = textOf(render());
    expect(text).toContain(en.seo.notMeasured);
    expect(text).not.toContain(en.seo.checks.https);
  });

  it('is labelled in every language', () => {
    for (const [code, locale] of [['ru', ru], ['pl', pl], ['lt', lt], ['be', be]] as const) {
      useLanguageStore.getState().setLanguage(code);
      const text = textOf(render(original, mvp));
      expect(text).toContain(locale.seo.title);
      expect(text).toContain(locale.seo.checks.metaDescription);
    }
  });
});
