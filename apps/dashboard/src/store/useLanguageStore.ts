import { create } from 'zustand';
import { AppLanguage, detectLanguage } from '../i18n/languages.js';

interface LanguageState {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
}

export const LANGUAGE_STORAGE_KEY = 'revamp_language';

function getInitialLanguage(): AppLanguage {
  try {
    const browserLanguages = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
    return detectLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY), browserLanguages);
  } catch {
    // Local storage access error fallback
    return 'en';
  }
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: getInitialLanguage(),
  setLanguage: (language) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore in non-browser env
    }
    set({ language });
  },
}));
