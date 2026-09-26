import { describe, it, expect } from 'vitest';
import { DATE_LOCALES, detectLanguage, formatDate, isAppLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../languages.js';

describe('Dashboard language helpers (REV-24)', () => {
  it('recognises only supported language codes', () => {
    for (const code of SUPPORTED_LANGUAGES) expect(isAppLanguage(code)).toBe(true);
    expect(isAppLanguage('de')).toBe(false);
    expect(isAppLanguage('pl-PL')).toBe(false);
    expect(isAppLanguage(undefined)).toBe(false);
    expect(isAppLanguage(42)).toBe(false);
  });

  it('prefers the saved language', () => {
    expect(detectLanguage('lt', ['pl-PL'])).toBe('lt');
  });

  it('falls back to the first supported browser language', () => {
    expect(detectLanguage(null, ['de-DE', 'be-BY', 'ru'])).toBe('be');
    expect(detectLanguage('xx', ['PL_pl'])).toBe('pl');
  });

  it('defaults to English when nothing matches', () => {
    expect(detectLanguage(undefined, ['de', 'fr-FR'])).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });

  it('names every language in itself', () => {
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    expect(LANGUAGE_NAMES.be).toBe('Беларуская');
  });

  it('formats dates with the active language', () => {
    const date = '2026-03-05T12:00:00.000Z';
    const numeric = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
    expect(formatDate(date, 'en', numeric)).toBe('05/03/2026');
    expect(formatDate(date, 'pl', numeric)).toBe('05.03.2026');
    expect(formatDate(date, 'ru', { day: 'numeric', month: 'short' })).toMatch(/^5 мар/);
    expect(formatDate(date, 'be', { day: 'numeric', month: 'short' })).toMatch(/^5 сак/);
    expect(formatDate(date, 'lt', { day: 'numeric', month: 'short' })).not.toBe(
      formatDate(date, 'en', { day: 'numeric', month: 'short' }),
    );
  });

  it('falls back to a Cyrillic locale for Belarusian dates in browsers without Belarusian data', () => {
    expect(DATE_LOCALES.be).toEqual(['be-BY', 'ru-BY']);
    // Chromium negotiates the chain down to ru-BY; Intl picks the first locale it supports
    const date = new Date('2026-03-05T12:00:00.000Z');
    expect(date.toLocaleDateString(['xx-XX', 'ru-BY'], { day: 'numeric', month: 'short' })).toMatch(/^5 мар/);
  });
});
