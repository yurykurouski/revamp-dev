/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import '../../i18n/index.js';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';
import { buildMvpChangeLog } from '../../utils/mvpChangeLog.js';
import { MvpChangeLog } from '../leadReview/MvpChangeLog.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audit: IAuditDetail = {
  id: 'audit-1',
  leadId: 'lead-1',
  criticalFlaws: [],
  quickWins: [],
  colorPalette: {},
  measurementErrors: [],
  designCritiqueFallback: false,
  lcpSeconds: 4.8,
};

const mvp: IMvpProjectDetail = {
  leadId: 'lead-1',
  fullPreviewUrl: 'about:blank#mvp',
  layout: { variant: 'original', reasons: ['rule:rebuild'] },
  rebuild: {
    coverage: 0.95,
    sections: 4,
    level: 'faithful',
    tuning: ['contrast:3', 'collapse:5', 'booking:appended'],
    facts: [
      { code: 'contrast:3', section: 'Our services', from: '#9a9a9a', to: '#595959', background: '#ffffff', ratioBefore: 2.84, ratioAfter: 7 },
      { code: 'collapse:5', value: 2260 },
    ],
    omitted: Array.from({ length: 8 }, (_, i) => ({ what: 'nav_link' as const, reason: 'other_page', sample: `Page ${i + 1}` })),
  },
  performance: { webVitals: { lcp: 1200, cls: 0 }, score: 100, host: 'localhost:9000', measuredAt: '2026-10-04T10:00:00Z' },
};

describe('MvpChangeLog (REV-119)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    act(() => useLanguageStore.getState().setLanguage('en'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (onShowSection?: (anchor: string) => void) =>
    act(() =>
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('light') },
          React.createElement(MvpChangeLog, { entries: buildMvpChangeLog(mvp, audit)!, onShowSection }),
        ),
      ),
    );

  it('shows the groups in order, each change with its reason and effect', () => {
    render();
    const groups = [...container.querySelectorAll('[data-group]')].map((el) => el.getAttribute('data-group'));
    expect(groups).toEqual(['accessibility', 'readability', 'performance', 'booking', 'design', 'omitted']);
    const contrast = container.querySelector('[data-change="code:contrast:3"]')!;
    expect(contrast.textContent).toContain('Text color changed from #9a9a9a to #595959 on #ffffff');
    expect(contrast.textContent).toContain('Why: Its contrast was 2.8:1');
    expect(contrast.textContent).toContain('For visitors: Readable in bright light');
    expect(contrast.textContent).toContain('Our services');
    expect(container.textContent).toContain('Changes: 6 · Left out: 1');
  });

  it('names an untitled section and lists omissions as what visitors lose, with six samples and the rest counted', () => {
    render();
    expect(container.querySelector('[data-change="code:collapse:5"]')!.textContent).toContain('Untitled section');
    const links = container.querySelector('[data-change="omitted:nav_link:other_page"]')!;
    expect(links.textContent).toContain('Visitors lose: That page, from the menu.');
    expect(links.textContent).toContain('“Page 6”');
    expect(links.textContent).not.toContain('“Page 7”');
    expect(links.textContent).toContain('+2');
  });

  it('scrolls the preview to the change`s section or the booking form', () => {
    const onShowSection = vi.fn();
    render(onShowSection);
    const button = (id: string) =>
      [...container.querySelectorAll(`[data-change="${id}"] button`)].find((b) => b.textContent === 'Show in preview') as HTMLButtonElement;
    act(() => button('code:contrast:3').click());
    act(() => button('code:booking:appended').click());
    expect(onShowSection.mock.calls).toEqual([['s-3'], ['booking']]);
    // A measurement or an omission has nowhere to scroll to
    expect(container.querySelector('[data-change="performance:lcp"] button')).toBeNull();
  });

  it('offers no preview link without a handler', () => {
    render();
    expect(container.querySelector('[data-change="code:contrast:3"] button')).toBeNull();
  });

  it('renders in the operator`s language', () => {
    act(() => useLanguageStore.getState().setLanguage('ru'));
    render();
    expect(container.textContent).toContain('Каждое изменение и его причина');
    expect(container.querySelector('[data-change="code:contrast:3"]')!.textContent).toContain('Почему: Контраст был 2.8:1');
    act(() => useLanguageStore.getState().setLanguage('en'));
  });
});
