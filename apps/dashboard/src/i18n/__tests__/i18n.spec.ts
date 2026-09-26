import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../index.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';
import { getTheme } from '../../theme/theme.js';

describe('i18next wiring (REV-24)', () => {
  afterEach(() => {
    useLanguageStore.getState().setLanguage('en');
  });

  it('starts in the store language with English fallback', () => {
    expect(i18n.language).toBe(useLanguageStore.getState().language);
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('follows language changes made through the store', () => {
    useLanguageStore.getState().setLanguage('pl');
    expect(i18n.language).toBe('pl');
    expect(i18n.t('header.newAudit')).toBe('Nowy audyt strony');

    useLanguageStore.getState().setLanguage('be');
    expect(i18n.t('inspector.violations', { count: 3 })).toBe('Парушэнняў: 3');
  });

  it('interpolates without HTML-escaping (React escapes rendered text)', () => {
    expect(i18n.t('email.testSent', { email: 'a&b@example.com' })).toBe('Test email sent to a&b@example.com');
  });
});

describe('MUI locale texts (REV-24)', () => {
  const gridText = (language: Parameters<typeof getTheme>[1]) =>
    (getTheme('light', language).components as Record<string, { defaultProps?: { localeText?: Record<string, unknown> } }>)
      .MuiDataGrid?.defaultProps?.localeText?.noRowsLabel;

  it('localises DataGrid texts where MUI ships them', () => {
    expect(gridText('en')).toBe('No rows');
    expect(gridText('pl')).toBe('Brak danych');
    expect(gridText('ru')).toBe('Нет строк');
    expect(gridText('be')).toBeTruthy();
    expect(gridText('be')).not.toBe('No rows');
  });

  it('keeps English MUI texts for Lithuanian, which MUI does not ship', () => {
    expect(gridText('lt')).toBe('No rows');
  });

  it('keeps the theme palette regardless of language', () => {
    expect(getTheme('dark', 'ru').palette.mode).toBe('dark');
    expect(getTheme('light', 'pl').palette.primary.main).toBe(getTheme('light').palette.primary.main);
  });
});
