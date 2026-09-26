import 'i18next';
import type { en } from './locales/en.js';

// Typed t() keys, checked against the English source dictionary
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
