import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IAuthSession } from '@revamp/shared-types';
import { AUTH_STORAGE_KEY, parseStoredSession } from '../useAuthStore.js';

const session: IAuthSession = {
  token: 'header.payload.signature',
  user: { id: 'u1', email: 'owner@studio.test', name: 'Ann' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role: 'owner',
};

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
};

const loadStore = async () => {
  vi.resetModules();
  return import('../useAuthStore.js');
};

describe('useAuthStore (REV-206)', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts signed out', async () => {
    const { useAuthStore, getAuthToken } = await loadStore();
    expect(useAuthStore.getState().session).toBeNull();
    expect(getAuthToken()).toBeNull();
  });

  it('signIn keeps the session in memory and in local storage', async () => {
    const { useAuthStore, getAuthToken } = await loadStore();
    useAuthStore.getState().signIn(session);
    expect(useAuthStore.getState().session).toEqual(session);
    expect(getAuthToken()).toBe(session.token);
    expect(JSON.parse(storage.data.get(AUTH_STORAGE_KEY)!)).toEqual(session);
  });

  it('signOut clears memory and local storage', async () => {
    const { useAuthStore, getAuthToken } = await loadStore();
    useAuthStore.getState().signIn(session);
    useAuthStore.getState().signOut();
    expect(useAuthStore.getState().session).toBeNull();
    expect(getAuthToken()).toBeNull();
    expect(storage.data.has(AUTH_STORAGE_KEY)).toBe(false);
  });

  it('restores a stored session after a reload', async () => {
    storage = memoryStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(session) });
    vi.stubGlobal('localStorage', storage);
    const { useAuthStore } = await loadStore();
    expect(useAuthStore.getState().session).toEqual(session);
  });

  it('starts signed out when the stored value is damaged', async () => {
    storage = memoryStorage({ [AUTH_STORAGE_KEY]: '{not json' });
    vi.stubGlobal('localStorage', storage);
    const { useAuthStore } = await loadStore();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('keeps working in memory when local storage throws', async () => {
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const { useAuthStore } = await loadStore();
    expect(() => useAuthStore.getState().signIn(session)).not.toThrow();
    expect(useAuthStore.getState().session).toEqual(session);
  });
});

describe('parseStoredSession (REV-206)', () => {
  it('accepts a complete session', () => {
    expect(parseStoredSession(JSON.stringify(session))).toEqual(session);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['text', 'hello'],
    ['an array', '[]'],
    ['no token', JSON.stringify({ ...session, token: undefined })],
    ['an empty token', JSON.stringify({ ...session, token: '' })],
    ['no user', JSON.stringify({ ...session, user: undefined })],
    ['a user without an email', JSON.stringify({ ...session, user: { id: 'u1' } })],
    ['no organization', JSON.stringify({ ...session, organization: null })],
    ['an unknown role', JSON.stringify({ ...session, role: 'admin' })],
  ])('rejects %s', (_label, raw) => {
    expect(parseStoredSession(raw)).toBeNull();
  });
});
