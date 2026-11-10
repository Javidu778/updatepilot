'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { authResponseSchema, type AuthResponse, type User } from '@updatepilot/shared';
import { createApiClient, type ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/**
 * Who is signed in, as far as this browser tab knows.
 *
 *   loading        the first check with the API is still running
 *   authenticated  the API accepted the session cookie
 *   anonymous      no valid session. `reason` says why, so the login page can explain
 *   unavailable    the API could not be reached or failed, so the session is unknown
 *
 * The CSRF token lives only in memory (a ref), never in localStorage or a cookie the page
 * can read. After a reload it is fetched again from GET /auth/me.
 *
 * This is for deciding what to SHOW. The API enforces the session on every request.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous'; reason?: 'signed-out' | 'expired' }
  | { status: 'unavailable' };

export type Credentials = { email: string; password: string };

type SessionContextValue = {
  session: SessionState;
  /** A client that sends the cookie and the CSRF token. Use it for every API call. */
  api: ApiClient;
  login: (credentials: Credentials) => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  /** Asks the API again, after an "unavailable" result. */
  retry: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
  /** For tests. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function AuthProvider({ children, baseUrl, fetchImpl }: ProviderProps) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const csrfToken = useRef<string | null>(null);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl,
        fetchImpl,
        getCsrfToken: () => csrfToken.current,
        // A request that needed a session got a 401: the session ended (expired or revoked).
        onUnauthenticated: () => {
          csrfToken.current = null;
          setSession({ status: 'anonymous', reason: 'expired' });
        },
      }),
    [baseUrl, fetchImpl],
  );

  const accept = useCallback((auth: AuthResponse) => {
    csrfToken.current = auth.csrfToken;
    setSession({ status: 'authenticated', user: auth.user });
  }, []);

  const loadSession = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const auth = await api.get('/api/v1/auth/me', {
          schema: authResponseSchema,
          signal,
          handleUnauthenticated: false, // 401 here just means "not signed in"
        });
        accept(auth);
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          csrfToken.current = null;
          setSession({ status: 'anonymous' });
        } else {
          setSession({ status: 'unavailable' });
        }
      }
    },
    [api, accept],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal);
    return () => controller.abort();
  }, [loadSession]);

  const login = useCallback(
    async (credentials: Credentials) => {
      const auth = await api.post('/api/v1/auth/login', {
        body: credentials,
        schema: authResponseSchema,
        handleUnauthenticated: false,
      });
      accept(auth);
    },
    [api, accept],
  );

  const register = useCallback(
    async (credentials: Credentials) => {
      const auth = await api.post('/api/v1/auth/register', {
        body: credentials,
        schema: authResponseSchema,
        handleUnauthenticated: false,
      });
      accept(auth);
    },
    [api, accept],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/v1/auth/logout', { handleUnauthenticated: false });
    } catch (error) {
      // Already signed out on the server is the outcome we wanted. Anything else is reported.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    csrfToken.current = null;
    setSession({ status: 'anonymous', reason: 'signed-out' });
  }, [api]);

  const retry = useCallback(() => {
    setSession({ status: 'loading' });
    void loadSession();
  }, [loadSession]);

  const value = useMemo(
    () => ({ session, api, login, register, logout, retry }),
    [session, api, login, register, logout, retry],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAuth(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
