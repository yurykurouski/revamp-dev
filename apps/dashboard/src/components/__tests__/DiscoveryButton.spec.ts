import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { DiscoveryButton } from '../DiscoveryButton.js';
import { DiscoveryIndicator } from '../../hooks/useDiscovery.js';
import { en } from '../../i18n/locales/en.js';

const render = (indicator: DiscoveryIndicator, newCount = 0) =>
  renderToStaticMarkup(React.createElement(DiscoveryButton, { indicator, newCount, onClick: () => {} }));

const ariaLabel = (html: string) => html.match(/<button[^>]*aria-label="([^"]*)"/)?.[1];
const badge = (html: string) => html.match(/<span class="[^"]*MuiBadge-badge[^"]*"[^>]*>([^<]*)<\/span>/);

describe('DiscoveryButton (REV-40)', () => {
  it('looks like a plain "Find businesses" button without a search', () => {
    const html = render('idle');
    expect(ariaLabel(html)).toBe(en.header.findBusinesses);
    expect(html).not.toContain('discovery-progress');
    expect(badge(html)).toBeNull();
    expect(html).toContain('MuiButton-colorPrimary');
  });

  it('exposes its D shortcut (REV-97)', () => {
    expect(render('idle')).toMatch(/<button[^>]*aria-keyshortcuts="D"/);
  });

  it('shows a spinner while the search runs in the background', () => {
    const html = render('running');
    expect(ariaLabel(html)).toBe(en.header.discoveryRunning);
    expect(html).toContain('discovery-progress');
    expect(html).toContain('MuiCircularProgress');
    expect(badge(html)).toBeNull();
  });

  it('shows the number of new businesses when the results are ready', () => {
    const html = render('ready', 7);
    expect(ariaLabel(html)).toBe(en.header.discoveryReady.replace('{{count}}', '7'));
    expect(html).not.toContain('discovery-progress');
    expect(badge(html)?.[0]).toContain('MuiBadge-colorSuccess');
    expect(badge(html)?.[1]).toBe('7');
    expect(html).toContain('MuiButton-colorSuccess');
  });

  it('shows a dot when the finished search found nothing new', () => {
    const html = render('ready', 0);
    expect(badge(html)?.[0]).toContain('MuiBadge-dot');
    expect(badge(html)?.[0]).not.toContain('MuiBadge-invisible');
  });

  it('shows an error state when the search failed', () => {
    const html = render('failed');
    expect(ariaLabel(html)).toBe(en.header.discoveryFailed);
    expect(badge(html)?.[0]).toContain('MuiBadge-colorError');
    expect(badge(html)?.[0]).toContain('MuiBadge-dot');
    expect(html).toContain('MuiButton-colorError');
  });
});
