import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { Sidebar, NAV_ITEMS, DRAWER_WIDTH, COLLAPSED_DRAWER_WIDTH } from '../Sidebar.js';
import { en } from '../../i18n/locales/en.js';

const render = (collapsed = false) =>
  renderToStaticMarkup(
    React.createElement(Sidebar, { activeView: 'leads', collapsed, onToggleCollapsed: () => {} }),
  );

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;');
const navButtons = (html: string) =>
  html.match(/<div class="[^"]*MuiListItemButton-root[^>]*>/g) ?? [];

describe('Sidebar (REV-39)', () => {
  it('lists only views that have a page', () => {
    expect(NAV_ITEMS.map((item) => item.view)).toEqual(['leads']);
  });

  it('renders one navigation entry per view', () => {
    const html = render();
    expect(navButtons(html)).toHaveLength(NAV_ITEMS.length);
    expect(html).toContain(escapeHtml(en.sidebar.leads));
  });

  it('drops the placeholder entries and the fake outreach badge', () => {
    const html = render();
    for (const label of ['Site Audits', 'Outreach (HITL)', 'Analytics', 'Settings']) {
      expect(html).not.toContain(label);
    }
    expect(html).not.toContain('MuiChip');
  });

  it('marks the active view as the current page', () => {
    const html = render();
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});

describe('Collapsible sidebar (REV-46)', () => {
  it('shows the product name, labels and a collapse toggle when expanded', () => {
    const html = render(false);
    expect(html).toContain(`width:${DRAWER_WIDTH}px`);
    expect(html).toContain('Revamp SaaS');
    expect(html).toContain('MuiListItemText-root');
    expect(html).toContain(`aria-label="${en.sidebar.collapse}"`);
    expect(html).toContain('aria-expanded="true"');
  });

  it('shows only icons, labelled for assistive tech, when collapsed', () => {
    const html = render(true);
    expect(html).toContain(`width:${COLLAPSED_DRAWER_WIDTH}px`);
    expect(html).not.toContain('Revamp SaaS');
    expect(html).not.toContain('MuiListItemText-root');

    const buttons = navButtons(html);
    expect(buttons).toHaveLength(NAV_ITEMS.length);
    expect(buttons[0]).toContain(`aria-label="${escapeHtml(en.sidebar.leads)}"`);
    expect(html.match(/data-testid="DashboardIcon"/g)).toHaveLength(1);

    expect(html).toContain(`aria-label="${en.sidebar.expand}"`);
    expect(html).toContain('aria-expanded="false"');
  });
});
