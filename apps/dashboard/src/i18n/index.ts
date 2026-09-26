import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en.js';
import { ru } from './locales/ru.js';
import { be } from './locales/be.js';
import { pl } from './locales/pl.js';
import { lt } from './locales/lt.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import type { AppLanguage } from './languages.js';

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
  be: { translation: be },
  pl: { translation: pl },
  lt: { translation: lt },
} as const;

function applyDocumentLanguage(language: AppLanguage) {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

const initialLanguage = useLanguageStore.getState().language;

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  // React escapes rendered text already
  interpolation: { escapeValue: false },
});
applyDocumentLanguage(initialLanguage);

// The language store is the source of truth; i18next and <html lang> follow it
useLanguageStore.subscribe((state, previous) => {
  if (state.language === previous.language) return;
  void i18n.changeLanguage(state.language);
  applyDocumentLanguage(state.language);
});

export default i18n;
