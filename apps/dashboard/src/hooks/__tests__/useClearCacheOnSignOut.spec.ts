/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/useAuthStore.js';
import { useClearCacheOnSignOut } from '../useClearCacheOnSignOut.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  token: 'tok',
  user: { id: 'u1', email: 'owner@studio.test' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role: 'owner' as const,
};

describe('useClearCacheOnSignOut (REV-206)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({ session });
    client = new QueryClient();
    client.setQueryData(['leads'], [{ id: 'l1' }]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const Probe: React.FC = () => {
      useClearCacheOnSignOut(client);
      return null;
    };
    act(() => root.render(React.createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps the cache while signed in', () => {
    act(() => useAuthStore.getState().signIn({ ...session, token: 'other' }));
    expect(client.getQueryData(['leads'])).toEqual([{ id: 'l1' }]);
  });

  it('drops everything cached when the user signs out, so the next user sees none of it', () => {
    act(() => useAuthStore.getState().signOut());
    expect(client.getQueryData(['leads'])).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('stops listening when the component unmounts', () => {
    act(() => root.unmount());
    client.setQueryData(['leads'], [1]);
    useAuthStore.getState().signOut();
    expect(client.getQueryData(['leads'])).toEqual([1]);
    root = createRoot(container);
  });
});
