import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { IconRail, RAIL_PAGES, RAIL_WIDTH } from '../IconRail.js';
import type { RailPage } from '../../routes/paths.js';
import type { DiscoveryIndicator } from '../../hooks/useDiscovery.js';

const render = ({
  activePage = 'queue' as RailPage | null,
  needsYouCount = 0,
  discovery = 'idle' as DiscoveryIndicator,
} = {}) =>
  renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(IconRail, { activePage, needsYouCount, discovery, onOpenDiscovery: () => {} }),
    ),
  );

/** The opening tag of the rail entry with this data-rail value */
const entry = (html: string, key: string) => html.match(new RegExp(`<[a-z]+[^>]*data-rail="${key}"[^>]*>`))?.[0] ?? '';

describe('IconRail (REV-76)', () => {
  it('is a 64px labelled navigation landmark', () => {
    const html = render();
    expect(RAIL_WIDTH).toBe(64);
    expect(html).toContain(`<nav`);
    expect(html).toContain(`aria-label="${en.rail.label}"`);
    expect(html).toContain('width:64px');
  });

  it('links Review queue, All leads and Settings to their routes', () => {
    const html = render();
    expect(RAIL_PAGES.map((p) => p.page)).toEqual(['queue', 'leads', 'settings']);
    expect(entry(html, 'queue')).toContain('href="/"');
    expect(entry(html, 'leads')).toContain('href="/leads"');
    expect(entry(html, 'settings')).toContain('href="/settings"');
  });

  it('gives every entry an aria-label, including Discovery, which is a button', () => {
    const html = render();
    expect(entry(html, 'queue')).toContain(`aria-label="${en.rail.queue}"`);
    expect(entry(html, 'leads')).toContain(`aria-label="${en.rail.leads}"`);
    expect(entry(html, 'settings')).toContain(`aria-label="${en.rail.settings}"`);
    expect(entry(html, 'discovery')).toMatch(/^<button/);
    expect(entry(html, 'discovery')).toContain(`aria-label="${en.rail.discovery}"`);
  });

  it.each(['queue', 'leads', 'settings'] as const)('marks only %s as the current page when it is active', (page) => {
    const html = render({ activePage: page });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(entry(html, page)).toContain('aria-current="page"');
  });

  it('marks nothing when the page is not on the rail', () => {
    expect(render({ activePage: null })).not.toContain('aria-current');
  });

  it('shows the Needs-you count on the Review queue entry', () => {
    const html = render({ needsYouCount: 4 });
    expect(entry(html, 'queue')).toContain(`aria-label="${en.rail.queueWithCount.replace('{{count}}', '4')}"`);
    expect(html).toMatch(/MuiBadge-badge[^"]*"[^>]*>4</);
  });

  it('hides the badge when nothing needs the operator', () => {
    const html = render({ needsYouCount: 0 });
    expect(html).toMatch(/MuiBadge-invisible/);
    expect(entry(html, 'queue')).toContain(`aria-label="${en.rail.queue}"`);
  });

  it('reports a background discovery search', () => {
    expect(render({ discovery: 'running' })).toContain('MuiCircularProgress');
    expect(entry(render({ discovery: 'ready' }), 'discovery')).toContain(`aria-label="${en.rail.discoveryReady}"`);
    expect(entry(render({ discovery: 'failed' }), 'discovery')).toContain(`aria-label="${en.header.discoveryFailed}"`);
  });

  it('shows the operator avatar', () => {
    expect(render()).toContain(`>${en.header.operatorInitials}</div>`);
  });
});
