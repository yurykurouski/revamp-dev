import { create } from 'zustand';
import { ORGANIZATION_ROLES, type IAuthContext, type IAuthSession } from '@revamp/shared-types';

export const AUTH_STORAGE_KEY = 'revamp_auth_session';

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The session saved in local storage, or null when it is missing or not a complete session (REV-206) */
export function parseStoredSession(raw: string | null): IAuthSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<IAuthSession> | null;
    if (!value || typeof value !== 'object') return null;
    const { token, user, organization, role } = value;
    if (!isText(token) || !isText(user?.id) || !isText(user?.email)) return null;
    if (!isText(organization?.id) || !isText(organization?.name)) return null;
    if (!(ORGANIZATION_ROLES as readonly unknown[]).includes(role)) return null;
    return value as IAuthSession;
  } catch {
    return null;
  }
}

function readSession(): IAuthSession | null {
  try {
    return parseStoredSession(localStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

interface AuthState {
  session: IAuthSession | null;
  signIn: (session: IAuthSession) => void;
  /** Takes the user, organization and role the server says are current (REV-207); the token stays. No-op when signed out */
  updateSession: (context: IAuthContext) => void;
  signOut: () => void;
}

/**
 * Who is signed in (REV-206). The token lives in local storage so a reload keeps the session; it expires on the
 * server after 7 days, and a 401 from the API signs out (`authFetch`).
 */
const persist = (session: IAuthSession): void => {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the session lasts until the tab closes
  }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  session: readSession(),
  signIn: (session) => {
    persist(session);
    set({ session });
  },
  updateSession: (context) => {
    const current = get().session;
    if (!current) return;
    const next = { ...context, token: current.token };
    persist(next);
    set({ session: next });
  },
  signOut: () => {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Ignore in non-browser env
    }
    set({ session: null });
  },
}));

/** The token to send with a request, or null when signed out */
export const getAuthToken = (): string | null => useAuthStore.getState().session?.token ?? null;
