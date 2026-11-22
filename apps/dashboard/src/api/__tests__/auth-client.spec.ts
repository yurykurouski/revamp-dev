import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAuthSession } from '@revamp/shared-types';
import { ApiError, apiClient, authApi, authFetch, invitationApi, organizationApi } from '../client.js';
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

describe('session refresh and member calls (REV-207)', () => {
  const context = { user: session.user, organization: session.organization, role: 'viewer' as const };
  const setup = () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    useAuthStore.setState({ session });
  };
  beforeEach(setup);
  afterEach(() => vi.unstubAllGlobals());

  it('authApi.me sends the token and returns the current context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: context }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(authApi.me()).resolves.toEqual(context);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/auth\/me$/);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok.en.value');
  });

  it('updateSession takes a changed role and organization from the server and keeps the token', () => {
    useAuthStore.getState().updateSession(context);
    expect(useAuthStore.getState().session).toEqual({ ...context, token: 'tok.en.value' });
  });

  it('updateSession does nothing when signed out (a late answer must not sign anyone in)', () => {
    useAuthStore.setState({ session: null });
    useAuthStore.getState().updateSession(context);
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('refreshes the role after a 403 and keeps the user signed in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, 403))
      .mockResolvedValueOnce(jsonRes({ success: true, data: context }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await authFetch('http://api/x', { method: 'POST' });
    expect(res.status).toBe(403);
    await vi.waitFor(() => expect(useAuthStore.getState().session?.role).toBe('viewer'));
    expect(fetchMock.mock.calls[1]![0]).toMatch(/\/auth\/me$/);
  });

  it('does not loop when the refresh itself fails, and runs one refresh at a time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, 403));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([authFetch('http://api/a', { method: 'POST' }), authFetch('http://api/b', { method: 'POST' }), authFetch('http://api/c', { method: 'POST' })]);
    await new Promise((r) => setTimeout(r, 20));
    const refreshes = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/me'));
    expect(refreshes).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(useAuthStore.getState().session?.role).toBe('owner');
  });

  it('does not refresh on other errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}, 404));
    vi.stubGlobal('fetch', fetchMock);
    await authFetch('http://api/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['getMembers', () => organizationApi.getMembers(), 'GET', '/organization/members', undefined],
    ['createInvitation', () => organizationApi.createInvitation({ email: 'a@b.co', role: 'viewer' }), 'POST', '/organization/invitations', { email: 'a@b.co', role: 'viewer' }],
    ['revokeInvitation', () => organizationApi.revokeInvitation('i 1'), 'DELETE', '/organization/invitations/i%201', undefined],
    ['changeMemberRole', () => organizationApi.changeMemberRole('u/2', 'operator'), 'PATCH', '/organization/members/u%2F2', { role: 'operator' }],
    ['removeMember', () => organizationApi.removeMember('u2'), 'DELETE', '/organization/members/u2', undefined],
  ])('%s calls the right route with the token', async (_name, call, method, path, body) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: { members: [], invitations: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await call();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).endsWith(path)).toBe(true);
    expect((init?.method ?? 'GET')).toBe(method);
    expect(init.headers.Authorization).toBe('Bearer tok.en.value');
    if (body) expect(JSON.parse(init.body)).toEqual(body);
  });

  it('member calls that answer { success: true } without data resolve', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: true })));
    await expect(organizationApi.removeMember('u2')).resolves.toBeUndefined();
    await expect(organizationApi.changeMemberRole('u2', 'viewer')).resolves.toBeUndefined();
    await expect(organizationApi.revokeInvitation('i1')).resolves.toBeUndefined();
  });

  it('member calls keep the error code, e.g. LAST_OWNER', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'LAST_OWNER', message: 'An organization needs at least one owner' } }, 409)));
    await expect(organizationApi.removeMember('u1')).rejects.toMatchObject({ name: 'ApiError', status: 409, code: 'LAST_OWNER' });
  });

  it('invitationApi.preview needs no token; accept sends it', async () => {
    const preview = { organizationName: 'Pixel', email: 'a@b.co', role: 'viewer', expiresAt: 'x' };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ success: true, data: preview })).mockResolvedValueOnce(jsonRes({ success: true, data: session }));
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ session: null });
    await expect(invitationApi.preview('abc_DEF-1')).resolves.toEqual(preview);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/invitations\/abc_DEF-1$/);
    expect(fetchMock.mock.calls[0]![1]?.headers?.Authorization).toBeUndefined();
    useAuthStore.setState({ session });
    await expect(invitationApi.accept('abc_DEF-1')).resolves.toEqual(session);
    expect(fetchMock.mock.calls[1]![0]).toMatch(/\/invitations\/abc_DEF-1\/accept$/);
    expect(fetchMock.mock.calls[1]![1].method).toBe('POST');
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer tok.en.value');
  });

  it('register sends the invitation token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: session }, 201));
    vi.stubGlobal('fetch', fetchMock);
    await authApi.register({ email: 'a@b.co', password: 'correct horse battery', invitationToken: 'abc_DEF-1' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ email: 'a@b.co', password: 'correct horse battery', invitationToken: 'abc_DEF-1' });
  });
});
