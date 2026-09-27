import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { MvpLayoutChip, layoutRuleOf } from '../MvpLayoutChip.js';
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
      expect(Object.keys(locale.mvpLayout.variants)).toEqual(['bento', 'split', 'editorial', 'compact']);
      expect(Object.keys(locale.mvpLayout.descriptions)).toEqual(['bento', 'split', 'editorial', 'compact']);
      expect(Object.keys(locale.mvpLayout.rules)).toHaveLength(7);
    }
  });
});
