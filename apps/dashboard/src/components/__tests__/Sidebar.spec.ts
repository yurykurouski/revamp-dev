import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n/index.js';
import { Sidebar, NAV_ITEMS } from '../Sidebar.js';
import { en } from '../../i18n/locales/en.js';

const render = () => renderToStaticMarkup(React.createElement(Sidebar, { activeView: 'leads' }));

describe('Sidebar (REV-39)', () => {
  it('lists only views that have a page', () => {
    expect(NAV_ITEMS.map((item) => item.view)).toEqual(['leads']);
    expect(Object.keys(en.sidebar)).toEqual(['leads']);
  });

  it('renders one navigation entry per view', () => {
    const html = render();
    expect(html.match(/class="[^"]*MuiListItemButton-root/g)).toHaveLength(NAV_ITEMS.length);
    expect(html).toContain(en.sidebar.leads.replace('&', '&amp;'));
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
