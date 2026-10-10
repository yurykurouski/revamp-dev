import { describe, it, expect } from 'vitest';
import { MVP_PAGE_FAILURES } from '@revamp/shared-types';
import { en } from '../../i18n/locales/en.js';
import {
  brandColors,
  colorContrast,
  currentFontChoice,
  generationFailureText,
  isModelDesigned,
  MvpText,
  pageResultText,
  seedColors,
  versionsNewestFirst,
} from '../mvpPage.js';

const theme = {
  primary: '#0a5c8a',
  accent: '#f2a900',
  bg: '#ffffff',
  surface: '#f5f7fa',
  text: '#111111',
  fontHeading: '"DM Serif Display", serif',
  fontBody: 'Inter, sans-serif',
};
const white = { primary: '#0a5c8a', accent: '#f2a900', bg: '#ffffff', surface: '#ffffff' };

/** The English text of a key, or undefined when the key is missing */
const english = (key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);

describe('model-designed page helpers (REV-140)', () => {
  it('tells a model-designed page by its theme', () => {
    expect(isModelDesigned({ theme })).toBe(true);
    expect(isModelDesigned({})).toBe(false);
    expect(isModelDesigned(null)).toBe(false);
  });

  it('seeds the colors from the saved controls over the theme, lowercase', () => {
    expect(seedColors({ theme, controls: { primary: '#AA0000' } })).toEqual({
      primary: '#aa0000',
      accent: '#f2a900',
      bg: '#ffffff',
      surface: '#f5f7fa',
      text: '#111111',
    });
  });

  it('has no colors to seed without a theme, also for an MVP of the previous generator', () => {
    expect(seedColors({})).toBeNull();
    expect(seedColors({ controls: { primary: '#aa0000' } })).toBeNull();
  });

  it('offers the brand colors that are valid, once each, in order', () => {
    expect(brandColors({ colorPalette: { primary: '#0A5C8A', secondary: 'red', accent: '#0a5c8a' } })).toEqual(['#0a5c8a']);
    expect(brandColors({ colorPalette: { primary: '#111111', secondary: '#222222', accent: '#333333' } })).toEqual([
      '#111111',
      '#222222',
      '#333333',
    ]);
    expect(brandColors(null)).toEqual([]);
  });

  it('accepts text at the AA boundary and refuses it just below', () => {
    expect(colorContrast({ ...white, text: '#767676' })).toEqual({ onBg: 4.54, onSurface: 4.54, valid: true, ok: true });
    const low = colorContrast({ ...white, text: '#777777' });
    expect(low.ok).toBe(false);
    expect(low.valid).toBe(true);
  });

  it('measures each background on its own', () => {
    const result = colorContrast({ ...white, surface: '#555555', text: '#111111' });
    expect(result.onBg).toBeGreaterThan(4.5);
    expect(result.onSurface).toBeLessThan(4.5);
    expect(result.ok).toBe(false);
  });

  it('measures nothing while a color is half typed', () => {
    expect(colorContrast({ ...white, text: '#12' })).toEqual({ valid: false, ok: false });
    expect(colorContrast({ ...white, bg: '' })).toEqual({ valid: false, ok: false });
  });

  it('finds the saved font pairing, or the page fonts', () => {
    expect(currentFontChoice({ controls: { fontHeading: 'Lora', fontBody: 'Lato' } })).toBe('editorial');
    expect(currentFontChoice({ controls: { fontHeading: 'Lora', fontBody: 'Inter' } })).toBeNull();
    expect(currentFontChoice({ controls: { primary: '#111111' } })).toBeNull();
    expect(currentFontChoice(undefined)).toBeNull();
  });

  it('lists the versions newest first, the highest number being the published one', () => {
    const version = (n: number) => ({ n, kind: 'change' as const, storagePath: `v/s/versions/${n}.html`, createdAt: '2026-10-10T10:00:00.000Z' });
    const listed = versionsNewestFirst([version(1), version(3), version(2)]);
    expect(listed.map((v) => [v.n, v.current])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect(versionsNewestFirst(undefined)).toEqual([]);
  });

  it('says what each answer means', () => {
    expect(pageResultText('change', { applied: true, version: 4 })).toEqual({ key: 'mvpPage.outcome.changed', values: { n: 4 } });
    expect(pageResultText('controls', { applied: true })).toEqual({ key: 'mvpPage.outcome.controls' });
    expect(pageResultText('restore', { applied: true, version: 5 })).toEqual({ key: 'mvpPage.outcome.restored', values: { n: 5 } });
    expect(pageResultText('change', { applied: false, reason: 'unchanged' })).toEqual({ key: 'mvpPage.outcome.unchanged' });
    expect(pageResultText('change', { applied: false, reason: 'invalid_page', message: 'm' })).toEqual({
      key: 'mvpPage.outcome.refused.invalid_page',
      values: { message: 'm' },
    });
  });

  it('explains a page failure by its reason, and any older failure generically', () => {
    expect(generationFailureText({ code: 'MVP_PAGE_UNAVAILABLE', reason: 'call_failed' })).toEqual({ key: 'mvpFailure.page.call_failed' });
    expect(generationFailureText({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'rebuild:flat' })).toEqual({ key: 'mvpFailure.page.previous' });
    expect(generationFailureText({ code: 'MVP_PAGE_UNAVAILABLE', reason: 'grouping:call_failed' })).toEqual({ key: 'mvpFailure.page.previous' });
  });

  it('every key the helpers return exists in English', () => {
    const texts: MvpText[] = [
      ...MVP_PAGE_FAILURES.map((reason) => generationFailureText({ code: 'MVP_PAGE_UNAVAILABLE', reason })),
      generationFailureText({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'x' }),
      ...[...MVP_PAGE_FAILURES, 'unusable_version' as const].map((reason) =>
        pageResultText('change', { applied: false, reason, message: 'm' }),
      ),
      pageResultText('change', { applied: false, reason: 'unchanged' }),
      ...(['change', 'controls', 'restore'] as const).map((action) => pageResultText(action, { applied: true, version: 1 })),
    ];
    for (const { key } of texts) expect(typeof english(key), key).toBe('string');
  });
});
