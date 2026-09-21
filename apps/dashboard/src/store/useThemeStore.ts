import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'revamp_theme_mode';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Local storage access error fallback
  }

  return 'light';
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: getInitialTheme(),
  toggleTheme: () =>
    set((state) => {
      const nextMode = state.mode === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(STORAGE_KEY, nextMode);
        document.documentElement.setAttribute('data-theme', nextMode);
      } catch {
        // Ignore in non-browser env
      }
      return { mode: nextMode };
    }),
  setTheme: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
      document.documentElement.setAttribute('data-theme', mode);
    } catch {
      // Ignore in non-browser env
    }
    set({ mode });
  },
}));
