/**
 * Dashboard interface languages (REV-24). Pure helpers, free of i18next and DOM access,
 * so language detection and date formatting stay unit-testable.
 */
export const SUPPORTED_LANGUAGES = ['en', 'ru', 'be', 'pl', 'lt'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Each language named in itself, for the switcher */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: 'English',
  ru: 'Русский',
  be: 'Беларуская',
  pl: 'Polski',
  lt: 'Lietuvių',
};

/**
 * Locales tried for dates, first supported wins. English keeps the day-month order the dashboard
 * always used; Chromium ships no Belarusian date data, so Belarusian falls back to ru-BY rather
 * than to the browser default.
 */
export const DATE_LOCALES: Record<AppLanguage, string[]> = {
  en: ['en-GB'],
  ru: ['ru-RU'],
  be: ['be-BY', 'ru-BY'],
  pl: ['pl-PL'],
  lt: ['lt-LT'],
};

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Picks the interface language: the operator's saved choice, else the first supported
 * browser language ("pl-PL" → "pl"), else English.
 */
export function detectLanguage(saved: string | null | undefined, browserLanguages: readonly string[] = []): AppLanguage {
  if (isAppLanguage(saved)) return saved;
  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isAppLanguage(primary)) return primary;
  }
  return 'en';
}

export function formatDate(
  value: string | number | Date,
  language: AppLanguage,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleDateString(DATE_LOCALES[language], options);
}
