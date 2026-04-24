import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ensureCsrfCookie, fetchMe, loginRequest, logoutRequest, type AuthUser } from '../api/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Boot sequence (task3.md §"Хук useAuth"):
  // 1. GET /auth/csrf — seed csrf_token cookie so a first-time visitor can
  //    POST /auth/login without the CSRF interceptor, and so subsequent
  //    mutating calls go through.
  // 2. GET /auth/me — 200 → signed in, 401 → anonymous. Anything else
  //    propagates so ErrorBoundary (task9) can surface it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureCsrfCookie();
        const me = await fetchMe();
        if (!cancelled) setUser(me);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const next = await loginRequest(username, password);
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // Clear local state even if the request failed — the user tried to
      // leave, respect that; any stale cookies will be 401'd by the next
      // fetchMe on page load.
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside <AuthProvider>');
  return ctx;
}
