import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyCaps, ShortcutTitle } from '../KeyCaps.js';

const caps = (html: string) => [...html.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map((m) => m[1]);

describe('KeyCaps (REV-97)', () => {
  it('draws one key cap per key of a registry shortcut', () => {
    expect(caps(renderToStaticMarkup(React.createElement(KeyCaps, { shortcut: 'focusSearch' })))).toEqual(['/']);
    expect(caps(renderToStaticMarkup(React.createElement(KeyCaps, { shortcut: 'addLead' })))).toEqual(['N']);
  });

  it('follows the platform modifier', () => {
    expect(caps(renderToStaticMarkup(React.createElement(KeyCaps, { shortcut: 'approve', mac: true })))).toEqual(['⌘', 'Enter']);
    expect(caps(renderToStaticMarkup(React.createElement(KeyCaps, { shortcut: 'approve', mac: false })))).toEqual(['Ctrl', 'Enter']);
  });

  it('marks which shortcut it shows', () => {
    expect(renderToStaticMarkup(React.createElement(KeyCaps, { shortcut: 'goLeads' }))).toContain('data-key-caps="goLeads"');
  });

  it('puts the keys after the label in a tooltip title', () => {
    const html = renderToStaticMarkup(React.createElement(ShortcutTitle, { label: 'Add lead', shortcut: 'addLead' }));
    expect(html.indexOf('Add lead')).toBeLessThan(html.indexOf('<kbd'));
    expect(caps(html)).toEqual(['N']);
  });
});
