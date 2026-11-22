/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import type { IAuthSession } from '@revamp/shared-types';
import i18n from '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { ApiError, authApi } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useAuthStore } from '../../store/useAuthStore.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';
import { AuthPage } from '../AuthPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: IAuthSession = {
  token: 'tok',
  user: { id: 'u1', email: 'owner@studio.test' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role: 'owner',
};

const Where: React.FC = () => React.createElement('div', { 'data-testid': 'where' }, useLocation().pathname);

describe('AuthPage (REV-206)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({ session: null });
    useLanguageStore.getState().setLanguage('en');
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

  const mount = async (mode: 'login' | 'register', entry: string | { pathname: string; state?: unknown } = '/login') => {
    await act(async () => {
      root.render(
        React.createElement(
          ThemeProvider,
          { theme: getTheme('dark', 'en') },
          React.createElement(
            MemoryRouter,
            { initialEntries: [entry] },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, { path: '/login', element: React.createElement(AuthPage, { mode: 'login' }) }),
              React.createElement(Route, { path: '/register', element: React.createElement(AuthPage, { mode: 'register' }) }),
              React.createElement(Route, { path: '*', element: React.createElement(Where) }),
            ),
          ),
        ),
      );
    });
    await flush();
    expect(mode).toBeTruthy();
  };

  const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const type = async (name: string, value: string) => {
    const el = field(name);
    expect(el, name).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => {
      document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  };
  const where = () => document.querySelector('[data-testid="where"]')?.textContent;
  const alert = () => document.querySelector('[role="alert"]')?.textContent ?? '';

  it('login: shows the title, an email and a password field and a link to registration', async () => {
    await mount('login');
    expect(document.querySelector('h1')!.textContent).toBe(en.auth.signInTitle);
    expect(field('email').type).toBe('email');
    expect(field('password').type).toBe('password');
    expect(field('organizationName')).toBeNull();
    const link = document.querySelector<HTMLAnchorElement>('a[href="/register"]');
    expect(link?.textContent).toBe(en.auth.goRegister);
  });

  it('login: sends the trimmed lowercase email, stores the session and goes to the queue', async () => {
    const login = vi.spyOn(authApi, 'login').mockResolvedValue(session);
    await mount('login');
    await type('email', '  Owner@Studio.Test ');
    await type('password', 'correct horse battery');
    await submit();
    expect(login).toHaveBeenCalledWith({ email: 'owner@studio.test', password: 'correct horse battery' });
    expect(useAuthStore.getState().session).toEqual(session);
    expect(where()).toBe('/');
  });

  it('login: goes back to the page the user came from', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(session);
    await mount('login', { pathname: '/login', state: { from: '/leads/abc' } });
    await type('email', 'owner@studio.test');
    await type('password', 'x');
    await submit();
    expect(where()).toBe('/leads/abc');
  });

  it('login: ignores a "from" that is not a path of the app', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(session);
    await mount('login', { pathname: '/login', state: { from: 'https://evil.example/' } });
    await type('email', 'owner@studio.test');
    await type('password', 'x');
    await submit();
    expect(where()).toBe('/');
  });

  it('login: validates before calling the API', async () => {
    const login = vi.spyOn(authApi, 'login');
    await mount('login');
    await type('email', 'not-an-email');
    await type('password', 'x');
    await submit();
    expect(login).not.toHaveBeenCalled();
    expect(alert()).toContain(en.auth.errors.email);
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('login: shows the wrong-password message and stays signed out', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError('x', 401, 'INVALID_CREDENTIALS'));
    await mount('login');
    await type('email', 'owner@studio.test');
    await type('password', 'bad');
    await submit();
    expect(alert()).toBe(en.auth.errors.INVALID_CREDENTIALS);
    expect(useAuthStore.getState().session).toBeNull();
    expect(where()).toBeUndefined();
  });

  it('login: says the server could not be reached when the request fails', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new TypeError('Failed to fetch'));
    await mount('login');
    await type('email', 'owner@studio.test');
    await type('password', 'x');
    await submit();
    expect(alert()).toBe(en.auth.errors.network);
  });

  it('login: disables the button while the request runs, so a double click sends one request', async () => {
    let finish: (s: IAuthSession) => void = () => undefined;
    const login = vi.spyOn(authApi, 'login').mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await mount('login');
    await type('email', 'owner@studio.test');
    await type('password', 'x');
    await submit();
    await submit();
    expect(login).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => finish(session));
  });

  it('register: shows the studio name, optional name and a password hint', async () => {
    await mount('register', '/register');
    expect(document.querySelector('h1')!.textContent).toBe(en.auth.registerTitle);
    for (const name of ['email', 'password', 'organizationName', 'name']) expect(field(name), name).not.toBeNull();
    expect(document.body.textContent).toContain(en.auth.passwordHint);
    expect(document.querySelector('a[href="/login"]')?.textContent).toBe(en.auth.goSignIn);
  });

  it('register: sends the studio and omits an empty name, then signs in', async () => {
    const register = vi.spyOn(authApi, 'register').mockResolvedValue(session);
    await mount('register', '/register');
    await type('email', 'Owner@Studio.Test');
    await type('password', 'correct horse battery');
    await type('organizationName', ' Pixel Studio ');
    await submit();
    expect(register).toHaveBeenCalledWith({
      email: 'owner@studio.test',
      password: 'correct horse battery',
      organizationName: 'Pixel Studio',
    });
    expect(useAuthStore.getState().session).toEqual(session);
    expect(where()).toBe('/');
  });

  it('register: sends the name when given', async () => {
    const register = vi.spyOn(authApi, 'register').mockResolvedValue(session);
    await mount('register', '/register');
    await type('email', 'owner@studio.test');
    await type('password', 'correct horse battery');
    await type('organizationName', 'Pixel Studio');
    await type('name', 'Ann');
    await submit();
    expect(register.mock.calls[0]![0]).toMatchObject({ name: 'Ann' });
  });

  it.each([
    ['a password of 9 characters', { password: '123456789' }, en.auth.errors.passwordShort],
    ['no studio name', { organizationName: '  ' }, en.auth.errors.organizationName],
  ])('register: rejects %s before calling the API', async (_label, override, message) => {
    const register = vi.spyOn(authApi, 'register');
    await mount('register', '/register');
    const values = { email: 'owner@studio.test', password: 'correct horse battery', organizationName: 'Pixel', ...override };
    for (const [name, value] of Object.entries(values)) await type(name, value);
    await submit();
    expect(register).not.toHaveBeenCalled();
    expect(alert()).toContain(message);
  });

  it('register: shows EMAIL_TAKEN', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(new ApiError('x', 409, 'EMAIL_TAKEN'));
    await mount('register', '/register');
    await type('email', 'owner@studio.test');
    await type('password', 'correct horse battery');
    await type('organizationName', 'Pixel');
    await submit();
    expect(alert()).toBe(en.auth.errors.EMAIL_TAKEN);
  });

  it('redirects a signed-in user away from the sign-in page', async () => {
    useAuthStore.setState({ session });
    await mount('login');
    expect(where()).toBe('/');
  });

  it('shows the page in the chosen language', async () => {
    useLanguageStore.getState().setLanguage('pl');
    await act(async () => void i18n.changeLanguage('pl'));
    await mount('login');
    expect(document.querySelector('h1')!.textContent).not.toBe(en.auth.signInTitle);
    await act(async () => void i18n.changeLanguage('en'));
  });
});
