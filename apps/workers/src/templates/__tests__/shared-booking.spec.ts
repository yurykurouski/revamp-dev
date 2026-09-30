import { describe, expect, it } from 'vitest';
import { getMvpStrings } from '../mvp-locale.js';
import { bookingScript } from '../shared/booking.js';
import { monogramSvg, resolveTrackerUrls, trackerScriptTag } from '../shared/page.js';

const t = getMvpStrings('en');

describe('bookingScript theme variables', () => {
  it('sets only the primary property when only it is given', () => {
    const script = bookingScript({ t, tracker: null, themeVars: { primary: '--rb-primary' } });
    expect(script).toContain("setProperty('--rb-primary', palette.primary)");
    expect(script).not.toContain('undefined');
    expect(script).not.toContain('palette.secondary');
    expect(script).not.toContain('palette.accent');
    expect(script).not.toContain('parseInt');
  });

  it('sets every given property', () => {
    const script = bookingScript({
      t,
      tracker: null,
      themeVars: { primary: '--a', primaryRgb: '--a-rgb', secondary: '--b', accent: '--c' },
    });
    for (const name of ['--a', '--a-rgb', '--b', '--c']) expect(script).toContain(`setProperty('${name}'`);
  });
});

describe('monogramSvg', () => {
  it('escapes its initials', () => {
    expect(monogramSvg('<b', '#000')).toContain('>&lt;</text>');
  });
  it('falls back to R for an empty name', () => {
    expect(monogramSvg('  ', '#000')).toContain('>R</text>');
  });
});

describe('trackerScriptTag', () => {
  it('is empty without a tracker', () => {
    expect(trackerScriptTag(null, 'tok')).toBe('');
  });
  it('escapes the token', () => {
    const tag = trackerScriptTag(resolveTrackerUrls('https://api.example/api/v1'), 'a"b');
    expect(tag).toContain('data-token="a&quot;b"');
  });
});
