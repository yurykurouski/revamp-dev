import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAuthSession } from '@revamp/shared-types';
import { ApiError, apiClient, authApi, authFetch } from '../client.js';
import { useAuthStore } from '../../store/useAuthStore.js';

const session: IAuthSession = {
  token: 'tok.en.value',
  user: { id: 'u1', email: 'owner@studio.test' },
  organization: { id: 'o1', name: 'Pixel Studio' },
  role: 'owner',
};

const jsonRes = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('authFetch (REV-206)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({ session: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the bearer token and keeps the caller headers', async () => {
    useAuthStore.setState({ session });
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}));
    vi.stubGlobal('fetch', fetchMock);
    await authFetch('http://api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(fetchMock).toHaveBeenCalledWith('http://api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok.en.value' },
      body: '{}',
    });
  });

  it('adds a header object when the caller sent none', async () => {
    useAuthStore.setState({ session });
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}));
    vi.stubGlobal('fetch', fetchMock);
    await authFetch('http://api/x');
    expect(fetchMock).toHaveBeenCalledWith('http://api/x', { headers: { Authorization: 'Bearer tok.en.value' } });
  });

  it('sends the request unchanged when signed out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}));
    vi.stubGlobal('fetch', fetchMock);
    await authFetch('http://api/x', { headers: { Accept: 'application/json' } });
    expect(fetchMock).toHaveBeenCalledWith('http://api/x', { headers: { Accept: 'application/json' } });
  });

  it('signs out when the API answers 401 to a signed-in request, and returns the response', async () => {
    useAuthStore.setState({ session });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ error: { code: 'UNAUTHENTICATED' } }, 401)));
    const res = await authFetch('http://api/x');
    expect(res.status).toBe(401);
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('stays signed in on other errors', async () => {
    useAuthStore.setState({ session });
    for (const status of [400, 403, 404, 500]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, status)));
      await authFetch('http://api/x');
    }
    expect(useAuthStore.getState().session).toEqual(session);
  });

  it('is used by the API client: a lead request carries the token and a 401 signs out', async () => {
    useAuthStore.setState({ session });
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiClient.getLlmProviders()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok.en.value');
    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe('authApi (REV-206)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({ session: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('register posts the body without a token and returns the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: session }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const body = { email: 'owner@studio.test', password: 'correct horse battery', organizationName: 'Pixel Studio' };
    await expect(authApi.register(body)).resolves.toEqual(session);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/auth\/register$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('login posts the credentials and returns the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: session }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(authApi.login({ email: 'owner@studio.test', password: 'x' })).resolves.toEqual(session);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/auth\/login$/);
  });

  it('login keeps the error code, and a wrong password does not touch a session that exists', async () => {
    useAuthStore.setState({ session });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }, 401)),
    );
    await expect(authApi.login({ email: 'a@b.co', password: 'bad' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(useAuthStore.getState().session).toEqual(session);
  });

  it('register reports EMAIL_TAKEN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'EMAIL_TAKEN', message: 'taken' } }, 409)));
    await expect(authApi.register({ email: 'a@b.co', password: 'correct horse battery', organizationName: 'X' })).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });
});
