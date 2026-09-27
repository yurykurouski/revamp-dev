import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { ROUTES, activeRailPage, leadPath, openedInApp } from '../paths.js';
import { APP_ROUTES } from '../AppRoutes.js';

describe('dashboard routes (REV-76)', () => {
  const leafPath = (pathname: string) => {
    const matches = matchRoutes(APP_ROUTES, pathname) ?? [];
    const leaf = matches[matches.length - 1]!;
    return { route: leaf.route, params: leaf.params };
  };

  it('has the queue at home, All leads, a lead and Settings', () => {
    expect(leafPath('/').route.index).toBe(true);
    expect(leafPath('/leads').route.path).toBe(ROUTES.leads);
    expect(leafPath('/settings').route.path).toBe(ROUTES.settings);

    const lead = leafPath('/leads/66f1c0ffee');
    expect(lead.route.path).toBe(ROUTES.lead);
    expect(lead.params.id).toBe('66f1c0ffee');
  });

  it('opens a lead on top of All leads, so the list stays mounted behind it', () => {
    const matches = matchRoutes(APP_ROUTES, '/leads/abc')!;
    expect(matches.map((m) => m.route.path)).toEqual([ROUTES.queue, ROUTES.leads, ROUTES.lead]);
  });

  it('sends unknown paths to the catch-all route', () => {
    expect(leafPath('/nowhere').route.path).toBe('*');
    expect(leafPath('/leads/abc/extra').route.path).toBe('*');
  });

  it('builds lead URLs with the id encoded', () => {
    expect(leadPath('abc123')).toBe('/leads/abc123');
    expect(leadPath('a/b')).toBe('/leads/a%2Fb');
  });

  it('marks the rail entry of the current page', () => {
    expect(activeRailPage('/')).toBe('queue');
    expect(activeRailPage('/leads')).toBe('leads');
    expect(activeRailPage('/leads/')).toBe('leads');
    expect(activeRailPage('/leads/abc')).toBe('leads');
    expect(activeRailPage('/settings')).toBe('settings');
    expect(activeRailPage('/leadsx')).toBeNull();
    expect(activeRailPage('/unknown')).toBeNull();
  });

  it('trusts only in-app paths as the page a lead was opened from', () => {
    expect(openedInApp({ from: '/' })).toBe(true);
    expect(openedInApp({ from: '/settings' })).toBe(true);
    expect(openedInApp(null)).toBe(false);
    expect(openedInApp({})).toBe(false);
    expect(openedInApp({ from: 'https://evil.example' })).toBe(false);
    expect(openedInApp({ from: '//evil.example' })).toBe(false);
    expect(openedInApp({ from: 42 })).toBe(false);
  });
});
