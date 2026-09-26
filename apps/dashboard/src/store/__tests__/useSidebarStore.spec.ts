import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SIDEBAR_STORAGE_KEY } from '../useSidebarStore.js';

describe('useSidebarStore (REV-46)', () => {
  let storage: Map<string, string>;

  const loadStore = async () => {
    vi.resetModules();
    return (await import('../useSidebarStore.js')).useSidebarStore;
  };

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('starts expanded when nothing is saved', async () => {
    const store = await loadStore();
    expect(store.getState().collapsed).toBe(false);
  });

  it('toggles and persists the collapsed state', async () => {
    const store = await loadStore();
    store.getState().toggleCollapsed();
    expect(store.getState().collapsed).toBe(true);
    expect(storage.get(SIDEBAR_STORAGE_KEY)).toBe('true');

    store.getState().toggleCollapsed();
    expect(store.getState().collapsed).toBe(false);
    expect(storage.get(SIDEBAR_STORAGE_KEY)).toBe('false');
  });

  it('restores the saved state on startup', async () => {
    storage.set(SIDEBAR_STORAGE_KEY, 'true');
    const store = await loadStore();
    expect(store.getState().collapsed).toBe(true);
  });

  it('ignores unexpected saved values', async () => {
    storage.set(SIDEBAR_STORAGE_KEY, 'yes');
    const store = await loadStore();
    expect(store.getState().collapsed).toBe(false);
  });

  it('still toggles when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const store = await loadStore();
    expect(store.getState().collapsed).toBe(false);
    store.getState().toggleCollapsed();
    expect(store.getState().collapsed).toBe(true);
  });
});
