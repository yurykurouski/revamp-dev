/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { IOrganizationMembers } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { ApiError, organizationApi } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useAuthStore } from '../../store/useAuthStore.js';
import { TeamPage } from '../TeamPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = { id: 'u1', email: 'owner@studio.test', name: 'Olga Owner' };

const MEMBERS: IOrganizationMembers = {
  members: [
    { userId: 'u1', email: 'owner@studio.test', name: 'Olga Owner', role: 'owner', joinedAt: '2026-11-01T10:00:00.000Z' },
    { userId: 'u2', email: 'oleg@studio.test', role: 'operator', joinedAt: '2026-11-02T10:00:00.000Z' },
    { userId: 'u3', email: 'vera@studio.test', name: 'Vera Viewer', role: 'viewer', joinedAt: '2026-11-03T10:00:00.000Z' },
  ],
  invitations: [{ id: 'i1', email: 'new@studio.test', role: 'viewer', expiresAt: '2026-12-01T10:00:00.000Z', createdAt: '2026-11-22T10:00:00.000Z' }],
};

describe('TeamPage (REV-207)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({
      session: { token: 'tok', user: ME, organization: { id: 'o1', name: 'Pixel Studio' }, role: 'owner' },
    });
    vi.spyOn(organizationApi, 'getMembers').mockResolvedValue(MEMBERS);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

  const mount = async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, { theme: getTheme('light') }, React.createElement(TeamPage)),
        ),
      );
    });
    await flush();
    await flush();
  };

  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="member-row"]')];
  const rowOf = (email: string) => rows().find((r) => r.textContent?.includes(email))!;
  const pending = () => [...container.querySelectorAll<HTMLElement>('[data-testid="invitation-row"]')];
  const button = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text) as HTMLButtonElement | undefined;
  const typeInto = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const choose = async (select: HTMLSelectElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const alert = () => container.querySelector('[role="alert"]')?.textContent ?? '';

  it('lists the members with their role, marks the signed-in user and shows the pending invitations', async () => {
    await mount();
    expect(container.querySelector('h1')!.textContent).toBe(en.team.title);
    expect(rows().map((r) => r.querySelector('select')!.value)).toEqual(['owner', 'operator', 'viewer']);
    expect(rowOf('owner@studio.test').textContent).toContain(en.team.you);
    expect(rowOf('oleg@studio.test').textContent).not.toContain(en.team.you);
    expect(rowOf('vera@studio.test').textContent).toContain('Vera Viewer');
    expect(pending()).toHaveLength(1);
    expect(pending()[0]!.textContent).toContain('new@studio.test');
    expect(pending()[0]!.textContent).toContain(en.team.roles.viewer);
  });

  it('shows an empty state when nothing is pending, and a load failure instead of a blank page', async () => {
    vi.mocked(organizationApi.getMembers).mockResolvedValue({ ...MEMBERS, invitations: [] });
    await mount();
    expect(pending()).toHaveLength(0);
    expect(container.textContent).toContain(en.team.noPending);

    act(() => root.unmount());
    root = createRoot(container);
    vi.mocked(organizationApi.getMembers).mockRejectedValue(new ApiError('boom', 500));
    await mount();
    expect(alert()).toContain(en.team.loadFailed);
  });

  it('changes a role through the API and reloads the list', async () => {
    const change = vi.spyOn(organizationApi, 'changeMemberRole').mockResolvedValue(undefined);
    await mount();
    await choose(rowOf('vera@studio.test').querySelector('select')!, 'operator');
    expect(change).toHaveBeenCalledWith('u3', 'operator');
    expect(organizationApi.getMembers).toHaveBeenCalledTimes(2);
  });

  it('says why a role change was refused (LAST_OWNER) and leaves the list as the server has it', async () => {
    vi.spyOn(organizationApi, 'changeMemberRole').mockRejectedValue(new ApiError('x', 409, 'LAST_OWNER'));
    await mount();
    await choose(rowOf('owner@studio.test').querySelector('select')!, 'viewer');
    await flush();
    expect(alert()).toContain(en.team.errors.LAST_OWNER);
    expect(rowOf('owner@studio.test').querySelector('select')!.value).toBe('owner');
  });

  it('removes a member only after a confirmation', async () => {
    const remove = vi.spyOn(organizationApi, 'removeMember').mockResolvedValue(undefined);
    await mount();
    await act(async () => button(rowOf('oleg@studio.test'), en.team.remove)!.click());
    expect(remove).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('oleg@studio.test');
    await act(async () => button(dialog, en.team.cancel)!.click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => button(rowOf('oleg@studio.test'), en.team.remove)!.click());
    await act(async () => button(document.querySelector<HTMLElement>('[role="dialog"]')!, en.team.confirmRemove)!.click());
    expect(remove).toHaveBeenCalledWith('u2');
  });

  it('creates an invitation and shows its link once, built from the token', async () => {
    const create = vi.spyOn(organizationApi, 'createInvitation').mockResolvedValue({
      invitation: { id: 'i2', email: 'ann@studio.test', role: 'operator', expiresAt: '2026-12-01T10:00:00.000Z', createdAt: '2026-11-22T10:00:00.000Z' },
      token: 'tok_ABC-123',
    });
    await mount();
    await typeInto(container.querySelector<HTMLInputElement>('input[name="inviteEmail"]')!, 'ann@studio.test');
    await choose(container.querySelector<HTMLSelectElement>('select[name="inviteRole"]')!, 'operator');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(create).toHaveBeenCalledWith({ email: 'ann@studio.test', role: 'operator' });
    const link = container.querySelector<HTMLInputElement>('[data-testid="invitation-link"] input')!;
    expect(link.value).toBe(`${window.location.origin}/invite/tok_ABC-123`);
    expect(container.textContent).toContain(en.team.linkHint);
    expect(container.querySelector<HTMLInputElement>('input[name="inviteEmail"]')!.value).toBe('');
    expect(organizationApi.getMembers).toHaveBeenCalledTimes(2);
  });

  it('copies the link', async () => {
    vi.spyOn(organizationApi, 'createInvitation').mockResolvedValue({
      invitation: { id: 'i2', email: 'ann@studio.test', role: 'viewer', expiresAt: 'x', createdAt: 'y' },
      token: 'tok_ABC-123',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await mount();
    await typeInto(container.querySelector<HTMLInputElement>('input[name="inviteEmail"]')!, 'ann@studio.test');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    await act(async () => button(container, en.team.copy)!.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/tok_ABC-123`);
    expect(container.textContent).toContain(en.team.copied);
  });

  it('validates the email before calling the API', async () => {
    const create = vi.spyOn(organizationApi, 'createInvitation');
    await mount();
    await typeInto(container.querySelector<HTMLInputElement>('input[name="inviteEmail"]')!, 'not-an-email');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(create).not.toHaveBeenCalled();
    expect(alert()).toContain(en.team.errors.email);
  });

  it('says ALREADY_MEMBER when the address already belongs to a member', async () => {
    vi.spyOn(organizationApi, 'createInvitation').mockRejectedValue(new ApiError('x', 409, 'ALREADY_MEMBER'));
    await mount();
    await typeInto(container.querySelector<HTMLInputElement>('input[name="inviteEmail"]')!, 'oleg@studio.test');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(alert()).toContain(en.team.errors.ALREADY_MEMBER);
  });

  it('revokes a pending invitation', async () => {
    const revoke = vi.spyOn(organizationApi, 'revokeInvitation').mockResolvedValue(undefined);
    await mount();
    await act(async () => button(pending()[0]!, en.team.revoke)!.click());
    expect(revoke).toHaveBeenCalledWith('i1');
  });
});
