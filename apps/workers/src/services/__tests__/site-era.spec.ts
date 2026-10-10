import { describe, it, expect } from 'vitest';
import { SITE_DATED_SIGNS } from '@revamp/shared-types';
import { SiteEraSchema } from '@revamp/validation';
import { readSiteEra } from '../site-era.service.js';

const now = new Date('2026-06-01T00:00:00Z');
const MODERN = '<html><head><title>x</title><meta name="viewport" content="width=device-width"></head><body><p>Hello</p></body></html>';

describe('readSiteEra (REV-114)', () => {
  it('scores a table layout page with legacy tags and no viewport as dated', () => {
    const era = readSiteEra({
      html: '<html><body><table><tr><td><table></table></td></tr></table><font>x</font></body></html>',
      now,
    });
    expect(era.signs).toEqual(['table_layout', 'no_viewport', 'legacy_tags']);
    expect(era.score).toBe(5);
    expect(era.dated).toBe(true);
  });

  it('gives a modern page score 0', () => {
    const era = readSiteEra({ html: MODERN, contentWidth: 1200, fullBleedShare: 0, bodyFont: 'Inter, sans-serif', now });
    expect(era).toMatchObject({ score: 0, dated: false, signs: [], contentWidth: 1200 });
  });

  it('is not dated at 2 and is dated at 3', () => {
    const two = readSiteEra({ html: '<html><body><p>x</p></body></html>', now });
    expect(two.signs).toEqual(['no_viewport']);
    expect(two.score).toBe(2);
    expect(two.dated).toBe(false);
    const three = readSiteEra({ html: '<html><body><center>x</center></body></html>', now });
    expect(three.score).toBe(3);
    expect(three.dated).toBe(true);
  });

  it('reads narrow_fixed from the content width and the full-bleed share', () => {
    const narrow = (contentWidth?: number, fullBleedShare?: number) =>
      readSiteEra({ html: MODERN, contentWidth, fullBleedShare, now }).signs.includes('narrow_fixed');
    expect(narrow(1000, 0.2)).toBe(true);
    expect(narrow(1001, 0.2)).toBe(false);
    expect(narrow(900, 0.5)).toBe(false);
    expect(narrow(undefined)).toBe(false);
  });

  it('flags the browser default font only as the first family', () => {
    const flagged = (family: string) => readSiteEra({ html: MODERN, bodyFont: family, now }).signs.includes('default_font');
    expect(flagged('Times')).toBe(true);
    expect(flagged('"Times New Roman", serif')).toBe(true);
    expect(flagged('serif')).toBe(true);
    expect(flagged('Georgia, serif')).toBe(false);
    expect(flagged('Montserrat')).toBe(false);
  });

  it('flags the body font when it is the browser default', () => {
    const flagged = (body: string) => readSiteEra({ html: MODERN, bodyFont: body, now }).signs.includes('default_font');
    expect(flagged('Montserrat, sans-serif')).toBe(false);
    expect(flagged('"Times New Roman", serif')).toBe(true);
  });

  it('flags a stale copyright year', () => {
    const era = readSiteEra({ html: MODERN.replace('Hello', '© 2015 Acme'), now });
    expect(era.signs).toEqual(['stale_copyright']);
    expect(era.score).toBe(1);
  });

  it('always passes the schema with signs in SITE_DATED_SIGNS order', () => {
    const era = readSiteEra({
      html: '<html><body><frameset></frameset><table><tr><td><table></table></td></tr></table><center>© 2010</center></body></html>',
      contentWidth: 800,
      fullBleedShare: 0,
      bodyFont: 'Times',
      now,
    });
    expect(SiteEraSchema.safeParse(era).success).toBe(true);
    const order = era.signs.map((s) => SITE_DATED_SIGNS.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(era.signs.length).toBeGreaterThan(4);
  });
});
