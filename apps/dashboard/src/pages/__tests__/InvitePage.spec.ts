/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import type { IAuthSession, IInvitationPreview } from '@revamp/shared-types';
import '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { ApiError, authApi, invitationApi } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useAuthStore } from '../../store/useAuthStore.js';
import { InvitePage } from '../InvitePage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW: IInvitationPreview = { organizationName: 'Pixel Studio', email: 'ann@studio.test', role: 'operator', expiresAt: '2026-12-01T00:00:00.000Z' };
const joined = (role: IAuthSession['role'] = 'operator'): IAuthSession => ({
  token: 'joined-token',
  user: { id: 'u9', email: 'ann@studio.test' },
  organization: { id: 'o-pixel', name: 'Pixel Studio' },
  role,
});
const own: IAuthSession = {
  token: 'old-token',
  user: { id: 'u9', email: 'ann@studio.test' },
  organization: { id: 'o-old', name: 'Old Studio' },
  role: 'owner',
};

const Where: React.FC = () => React.createElement('div', { 'data-testid': 'where' }, useLocation().pathname);

describe('InvitePage (REV-207)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({ session: null });
    vi.spyOn(invitationApi, 'preview').mockResolvedValue(PREVIEW);
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

  const mount = async (path = '/invite/abc_DEF-1') => {
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('light') },
          React.createElement(
            MemoryRouter,
            { initialEntries: [path] },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, { path: '/invite/:token', element: React.createElement(InvitePage) }),
              React.createElement(Route, { path: '*', element: React.createElement(Where) }),
            ),
          ),
        ),
      );
    });
    await flush();
    await flush();
  };

  const field = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const type = async (name: string, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(name), value);
      field(name).dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  };
  const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
  const alert = () => container.querySelector('[role="alert"]')?.textContent ?? '';
  const where = () => document.querySelector('[data-testid="where"]')?.textContent;
  const body = () => container.textContent ?? '';

  it('asks the API about the token in the link and shows the studio, the role and the address', async () => {
    await mount();
    expect(invitationApi.preview).toHaveBeenCalledWith('abc_DEF-1');
    expect(container.querySelector('h1')!.textContent).toBe(en.invite.title);
    expect(body()).toContain('Pixel Studio');
    expect(body()).toContain(en.team.roles.operator);
    expect(body()).toContain('ann@studio.test');
  });

  it.each([
    ['INVITATION_NOT_FOUND', en.invite.errors.INVITATION_NOT_FOUND],
    ['INVITATION_EXPIRED', en.invite.errors.INVITATION_EXPIRED],
  ] as const)('%s shows its message and a way to the sign-in page, without a form', async (code, message) => {
    vi.mocked(invitationApi.preview).mockRejectedValue(new ApiError('x', code === 'INVITATION_EXPIRED' ? 410 : 404, code));
    await mount();
    expect(alert()).toBe(message);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('a[href="/login"]')?.textContent).toBe(en.invite.goSignIn);
  });

  it('says the server could not be reached when the preview fails for another reason', async () => {
    vi.mocked(invitationApi.preview).mockRejectedValue(new TypeError('Failed to fetch'));
    await mount();
    expect(alert()).toBe(en.invite.errors.network);
  });

  describe('signed out: create an account', () => {
    it('registers with the invited address and the token, signs in and goes to the app', async () => {
      const register = vi.spyOn(authApi, 'register').mockResolvedValue(joined());
      await mount();
      expect(field('email').value).toBe('ann@studio.test');
      expect(field('email').readOnly).toBe(true);
      expect(field('organizationName')).toBeNull();
      await type('password', 'correct horse battery');
      await type('name', ' Ann ');
      await submit();
      expect(register).toHaveBeenCalledWith({ email: 'ann@studio.test', password: 'correct horse battery', name: 'Ann', invitationToken: 'abc_DEF-1' });
      expect(useAuthStore.getState().session).toEqual(joined());
      expect(where()).toBe('/');
    });

    it('omits an empty name and refuses a short password before calling the API', async () => {
      const register = vi.spyOn(authApi, 'register').mockResolvedValue(joined());
      await mount();
      await type('password', 'short');
      await submit();
      expect(register).not.toHaveBeenCalled();
      expect(alert()).toBe(en.invite.errors.passwordShort);
      await type('password', 'correct horse battery');
      await submit();
      expect(register).toHaveBeenCalledWith({ email: 'ann@studio.test', password: 'correct horse battery', invitationToken: 'abc_DEF-1' });
    });

    it('points an owner of an existing account to "I already have an account" (EMAIL_TAKEN)', async () => {
      vi.spyOn(authApi, 'register').mockRejectedValue(new ApiError('x', 409, 'EMAIL_TAKEN'));
      await mount();
      await type('password', 'correct horse battery');
      await submit();
      expect(alert()).toBe(en.invite.errors.EMAIL_TAKEN);
      expect(useAuthStore.getState().session).toBeNull();
    });

    it('shows an expired invitation found at registration and stays signed out', async () => {
      vi.spyOn(authApi, 'register').mockRejectedValue(new ApiError('x', 410, 'INVITATION_EXPIRED'));
      await mount();
      await type('password', 'correct horse battery');
      await submit();
      expect(alert()).toBe(en.invite.errors.INVITATION_EXPIRED);
      expect(useAuthStore.getState().session).toBeNull();
    });

    it('disables the button while the request runs: one request for a double submit', async () => {
      let finish: (s: IAuthSession) => void = () => undefined;
      const register = vi.spyOn(authApi, 'register').mockReturnValue(new Promise((resolve) => (finish = resolve)));
      await mount();
      await type('password', 'correct horse battery');
      await submit();
      await submit();
      expect(register).toHaveBeenCalledTimes(1);
      expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      await act(async () => finish(joined()));
    });
  });

  describe('signed out: I already have an account', () => {
    const switchToLogin = () => act(async () => button(en.invite.haveAccount)!.click());

    it('signs in with the invited address, then accepts the invitation and uses the session of the invited studio', async () => {
      const login = vi.spyOn(authApi, 'login').mockResolvedValue(own);
      const accept = vi.spyOn(invitationApi, 'accept').mockResolvedValue(joined());
      await mount();
      await switchToLogin();
      expect(field('name')).toBeNull();
      await type('password', 'my old password');
      await submit();
      expect(login).toHaveBeenCalledWith({ email: 'ann@studio.test', password: 'my old password' });
      expect(accept).toHaveBeenCalledWith('abc_DEF-1');
      expect(useAuthStore.getState().session).toEqual(joined());
      expect(where()).toBe('/');
    });

    it('shows a wrong password and does not try to accept', async () => {
      vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError('x', 401, 'INVALID_CREDENTIALS'));
      const accept = vi.spyOn(invitationApi, 'accept');
      await mount();
      await switchToLogin();
      await type('password', 'wrong');
      await submit();
      expect(alert()).toBe(en.invite.errors.INVALID_CREDENTIALS);
      expect(accept).not.toHaveBeenCalled();
      expect(useAuthStore.getState().session).toBeNull();
    });

    it('shows why accepting failed after a successful sign-in (ALREADY_MEMBER) and keeps the user signed in', async () => {
      vi.spyOn(authApi, 'login').mockResolvedValue(own);
      vi.spyOn(invitationApi, 'accept').mockRejectedValue(new ApiError('x', 409, 'ALREADY_MEMBER'));
      await mount();
      await switchToLogin();
      await type('password', 'my old password');
      await submit();
      expect(useAuthStore.getState().session).toEqual(own);
    });
  });

  describe('signed in', () => {
    it('with the invited address offers Join, and joining switches to the invited studio', async () => {
      useAuthStore.setState({ session: own });
      const accept = vi.spyOn(invitationApi, 'accept').mockResolvedValue(joined());
      await mount();
      expect(container.querySelector('form input[name="password"]')).toBeNull();
      await act(async () => button('Join Pixel Studio')!.click());
      await flush();
      expect(accept).toHaveBeenCalledWith('abc_DEF-1');
      expect(useAuthStore.getState().session).toEqual(joined());
      expect(where()).toBe('/');
    });

    it('shows ALREADY_MEMBER and INVITATION_EMAIL_MISMATCH from the accept call', async () => {
      useAuthStore.setState({ session: own });
      const accept = vi.spyOn(invitationApi, 'accept').mockRejectedValueOnce(new ApiError('x', 409, 'ALREADY_MEMBER'));
      await mount();
      await act(async () => button('Join Pixel Studio')!.click());
      await flush();
      expect(alert()).toBe(en.invite.errors.ALREADY_MEMBER);
      accept.mockRejectedValueOnce(new ApiError('x', 403, 'INVITATION_EMAIL_MISMATCH'));
      await act(async () => button('Join Pixel Studio')!.click());
      await flush();
      expect(alert()).toBe(en.invite.errors.INVITATION_EMAIL_MISMATCH);
    });

    it('with another address says so and offers to sign out, without a Join button', async () => {
      useAuthStore.setState({ session: { ...own, user: { id: 'u5', email: 'bob@studio.test' } } });
      await mount();
      expect(body()).toContain('bob@studio.test');
      expect(body()).toContain('ann@studio.test');
      expect(button('Join Pixel Studio')).toBeUndefined();
      await act(async () => button(en.invite.switchAccount)!.click());
      expect(useAuthStore.getState().session).toBeNull();
      expect(field('password')).not.toBeNull();
    });

    it('compares addresses ignoring letter case', async () => {
      useAuthStore.setState({ session: { ...own, user: { id: 'u9', email: 'ANN@Studio.Test' } } });
      await mount();
      expect(button('Join Pixel Studio')).toBeDefined();
    });
  });
});
