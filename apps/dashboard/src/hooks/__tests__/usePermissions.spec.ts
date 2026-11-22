/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type { OrganizationRole } from '@revamp/shared-types';
import { useAuthStore } from '../../store/useAuthStore.js';
import { usePermissions } from '../usePermissions.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessionAs = (role: OrganizationRole) => ({
  token: 'tok',
  user: { id: 'u1', email: 'a@studio.test' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role,
});

describe('usePermissions (REV-207)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: ReturnType<typeof usePermissions>;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const Probe: React.FC = () => {
      seen = usePermissions();
      return null;
    };
    act(() => root.render(React.createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each<[OrganizationRole, boolean, boolean]>([
    ['owner', true, true],
    ['operator', true, false],
    ['viewer', false, false],
  ])('%s: canWrite=%s, canManageMembers=%s', (role, write, manage) => {
    act(() => useAuthStore.setState({ session: sessionAs(role) }));
    expect(seen).toEqual({ role, canWrite: write, canManageMembers: manage });
  });

  it('can do nothing when signed out', () => {
    act(() => useAuthStore.setState({ session: null }));
    expect(seen).toEqual({ role: undefined, canWrite: false, canManageMembers: false });
  });

  it('follows a role change at once', () => {
    act(() => useAuthStore.setState({ session: sessionAs('viewer') }));
    expect(seen.canWrite).toBe(false);
    act(() => useAuthStore.setState({ session: sessionAs('operator') }));
    expect(seen.canWrite).toBe(true);
  });
});
