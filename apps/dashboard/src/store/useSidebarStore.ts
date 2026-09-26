import { create } from 'zustand';

interface SidebarState {
  collapsed: boolean;
  toggleCollapsed: () => void;
}

export const SIDEBAR_STORAGE_KEY = 'revamp_sidebar_collapsed';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    // No storage (tests, private mode): start expanded
    return false;
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: getInitialCollapsed(),
  toggleCollapsed: () =>
    set((state) => {
      const collapsed = !state.collapsed;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
      } catch {
        // Ignore in non-browser env
      }
      return { collapsed };
    }),
}));
