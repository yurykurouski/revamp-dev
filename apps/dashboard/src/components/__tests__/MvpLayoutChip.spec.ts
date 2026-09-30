import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { MvpLayoutChip, layoutRuleOf, rebuildFallbackOf } from '../MvpLayoutChip.js';
import { IMvpProjectDetail } from '../../api/client.js';
import { en } from '../../i18n/locales/en.js';
import { ru } from '../../i18n/locales/ru.js';
import { pl } from '../../i18n/locales/pl.js';
import { lt } from '../../i18n/locales/lt.js';
import { be } from '../../i18n/locales/be.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';

const mvp = (layout?: IMvpProjectDetail['layout']): IMvpProjectDetail => ({
  leadId: 'lead-1',
  fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/demo/index.html',
  layout,
});
const escape = (text: string) => text.replace(/'/g, '&#x27;');
const render = (project: IMvpProjectDetail | null) =>
  renderToStaticMarkup(React.createElement(MvpLayoutChip, { mvp: project }));

describe('MvpLayoutChip (REV-54)', () => {
  afterEach(() => {
    useLanguageStore.getState().setLanguage('en');
  });

  it('shows the layout the MVP was rendered with', () => {
    const html = render(mvp({ variant: 'editorial', reasons: ['rule:professional_niche', 'niche:legal'] }));
    expect(html).toContain('MuiChip');
    expect(html).toContain(en.mvpLayout.variants.editorial);
  });

  it('renders nothing for MVPs generated before layouts existed or with an unknown layout', () => {
    expect(render(null)).toBe('');
    expect(render(mvp())).toBe('');
    expect(render(mvp({ variant: 'masonry' as never, reasons: [] }))).toBe('');
  });

  it('says when the operator picked the layout (REV-84)', () => {
    const html = render(mvp({ variant: 'split', reasons: ['rule:manual', 'images:3'] }));
    expect(html).toContain(en.mvpLayout.variants.split);
    expect(html).toContain(en.mvpLayout.rules.manual);
  });

  it('says when the layout follows the original site (REV-104)', () => {
    const html = render(mvp({ variant: 'split', reasons: ['rule:derived', 'hero:side-right'] }));
    expect(html).toContain(en.mvpLayout.rules.derived.replace("'", '&#x27;'));
    expect(layoutRuleOf(['rule:derived'])).toBe('derived');
  });

  it('shows that the original layout could not be read and the rules chose instead (REV-104)', () => {
    const html = render(mvp({ variant: 'bento', reasons: ['rule:default', 'site_layout:unread'] }));
    expect(html).toContain(en.mvpLayout.rules.default);
    expect(html).toContain(en.mvpLayout.unread.replace("'", '&#x27;'));
    expect(render(mvp({ variant: 'bento', reasons: ['rule:default'] }))).not.toContain(en.mvpLayout.unread.replace("'", '&#x27;'));
  });

  it('follows the interface language', () => {
    useLanguageStore.getState().setLanguage('pl');
    expect(render(mvp({ variant: 'compact', reasons: ['rule:small_brochure'] }))).toContain('Kompaktowy');
  });

  it('reads the rule behind the choice from the reason codes', () => {
    expect(layoutRuleOf(['complexity:COMPLEX', 'rule:image_rich'])).toBe('image_rich');
    expect(layoutRuleOf(['rule:manual', 'images:3'])).toBe('manual');
    expect(layoutRuleOf(['rule:made_up'])).toBeUndefined();
    expect(layoutRuleOf([])).toBeUndefined();
    expect(layoutRuleOf(undefined)).toBeUndefined();
  });

  it('has a label and an explanation for every layout and rule in every language', () => {
    for (const locale of [en, ru, pl, lt, be]) {
      expect(Object.keys(locale.mvpLayout.variants)).toEqual(['original', 'bento', 'split', 'editorial', 'compact']);
      expect(Object.keys(locale.mvpLayout.descriptions)).toEqual(['original', 'bento', 'split', 'editorial', 'compact']);
      expect(Object.keys(locale.mvpLayout.rules)).toHaveLength(9);
      expect(Object.keys(locale.mvpLayout.fallback)).toEqual(['unread', 'no_content', 'low_coverage', 'invalid', 'too_large']);
      expect(locale.mvpLayout.unread.length).toBeGreaterThan(0);
    }
  });

  it('reads the rebuild rule (REV-110)', () => {
    expect(layoutRuleOf(['rule:rebuild'])).toBe('rebuild');
  });

  it('reads why the rebuild fell back, with the coverage it read (REV-110)', () => {
    expect(rebuildFallbackOf(['rebuild:low_coverage', 'coverage:0.72', 'rule:derived'])).toEqual({
      reason: 'rebuild:low_coverage',
      percent: 72,
    });
    expect(rebuildFallbackOf(['rebuild:unread'])).toEqual({ reason: 'rebuild:unread' });
    expect(rebuildFallbackOf(['rebuild:too_large', 'coverage:abc'])).toEqual({ reason: 'rebuild:too_large' });
    expect(rebuildFallbackOf(['rebuild:made_up'])).toBeUndefined();
    expect(rebuildFallbackOf(['rule:rebuild'])).toBeUndefined();
    expect(rebuildFallbackOf([])).toBeUndefined();
    expect(rebuildFallbackOf(undefined)).toBeUndefined();
  });

  it('shows the rebuilt original site with its summary, in the default color (REV-110)', () => {
    const html = render({
      ...mvp({ variant: 'original', reasons: ['rule:rebuild'] }),
      rebuild: {
        coverage: 0.98,
        sections: 17,
        omitted: [{ what: 'embed', reason: 'second_form' }],
        tuning: ['alt:2', 'contrast:1'],
      },
    });
    expect(html).toContain(en.mvpLayout.variants.original);
    expect(html).toContain(en.mvpLayout.rules.rebuild);
    expect(html).toContain('17 sections rebuilt, 1 left out, 2 fixes');
    expect(html).not.toContain('MuiChip-colorWarning');
  });

  it('marks a fallback to the template with a warning chip and says why (REV-110)', () => {
    const html = render(mvp({ variant: 'split', reasons: ['rebuild:low_coverage', 'coverage:0.72', 'rule:derived'] }));
    expect(html).toContain('MuiChip-colorWarning');
    expect(html).toContain(escape(en.mvpLayout.fallback.low_coverage.replace('{{percent}}', '72')));
    const unread = render(mvp({ variant: 'bento', reasons: ['rebuild:unread', 'rule:default'] }));
    expect(unread).toContain('MuiChip-colorWarning');
    expect(unread).toContain(escape(en.mvpLayout.fallback.unread));
  });
});
