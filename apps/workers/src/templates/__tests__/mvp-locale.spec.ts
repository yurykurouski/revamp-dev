import { describe, it, expect } from 'vitest';
import {
  MVP_UI_LANGUAGES,
  getMvpStrings,
  languageDisplayName,
  parseLanguageTag,
  sanitizeLanguageTag,
} from '../mvp-locale.js';

describe('MVP template locale (REV-25)', () => {
  it('reduces site language tags to their primary subtag', () => {
    expect(parseLanguageTag('pl-PL')).toBe('pl');
    expect(parseLanguageTag('EN_us')).toBe('en');
    expect(parseLanguageTag(' lt ')).toBe('lt');
    expect(parseLanguageTag('fil')).toBe('fil');
  });

  it('rejects missing or malformed language tags', () => {
    expect(parseLanguageTag(undefined)).toBeUndefined();
    expect(parseLanguageTag('')).toBeUndefined();
    expect(parseLanguageTag('x')).toBeUndefined();
    expect(parseLanguageTag('"><script>')).toBeUndefined();
    expect(parseLanguageTag('english')).toBeUndefined();
  });

  it('keeps well-formed site language tags as written', () => {
    expect(sanitizeLanguageTag('pl-PL')).toBe('pl-PL');
    expect(sanitizeLanguageTag(' sr-Latn-RS ')).toBe('sr-Latn-RS');
    expect(sanitizeLanguageTag('en_US')).toBe('en-US');
    expect(sanitizeLanguageTag('de')).toBe('de');
  });

  it('rejects malformed site language tags', () => {
    expect(sanitizeLanguageTag(undefined)).toBeUndefined();
    expect(sanitizeLanguageTag('')).toBeUndefined();
    expect(sanitizeLanguageTag('pl-')).toBeUndefined();
    expect(sanitizeLanguageTag('pl"><script>')).toBeUndefined();
    expect(sanitizeLanguageTag('en-toolongsubtag')).toBeUndefined();
  });

  it('returns the dictionary of each supported language', () => {
    expect(getMvpStrings('pl').bookNow).toBe('Umów się');
    expect(getMvpStrings('ru-RU').contactsTitle).toBe('Контакты');
    expect(getMvpStrings('be').reviewsTag).toBe('Водгукі');
    expect(getMvpStrings('lt').servicesTag).toBe('Paslaugos');
    expect(getMvpStrings('en').bookNow).toBe('Book now');
  });

  it('falls back to English for languages without a dictionary', () => {
    expect(getMvpStrings('de')).toBe(getMvpStrings('en'));
    expect(getMvpStrings(undefined)).toBe(getMvpStrings('en'));
  });

  it('keeps every dictionary complete, with the confirmation placeholders intact', () => {
    const englishKeys = Object.keys(getMvpStrings('en')).sort();
    for (const lang of MVP_UI_LANGUAGES) {
      const strings = getMvpStrings(lang);
      expect(Object.keys(strings).sort()).toEqual(englishKeys);
      expect(Object.keys(strings.nicheLabels).sort()).toEqual(Object.keys(strings.nicheCta).sort());
      for (const placeholder of ['{name}', '{service}', '{phone}']) {
        expect(strings.successDetail).toContain(placeholder);
      }
      for (const value of Object.values(strings)) {
        if (typeof value === 'string') expect(value.trim()).not.toBe('');
      }
    }
  });

  it('names languages in English for the LLM instruction', () => {
    expect(languageDisplayName('pl')).toBe('Polish');
    expect(languageDisplayName('be')).toBe('Belarusian');
  });
});
