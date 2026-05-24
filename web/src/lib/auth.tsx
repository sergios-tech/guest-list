import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { queryClient } from './queryClient';
import { useSnackbar } from './snackbar';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  locale: string;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

// Non-null assertion would mask "useAuth used outside provider" with a
// confusing destructure error. A throwing default surfaces the real cause
// at the misuse site.
const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

interface JwtClaims { sub: string; exp: number }

function readTokenClaims(): JwtClaims | null {
  const raw = localStorage.getItem('token');
  if (!raw) return null;
  try {
    const claims = jwtDecode<JwtClaims>(raw);
    if (!claims?.exp || claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

function clearStoredAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  queryClient.clear();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const snackbar = useSnackbar();
  const { t } = useTranslation();

  // Initial rehydrate. Wrapped in try/catch because a partially-written or
  // schema-mismatched localStorage value would throw `SyntaxError`, leaving
  // `loading=true` forever and rendering the app as a blank screen.
  useEffect(() => {
    try {
      const claims = readTokenClaims();
      const stored = localStorage.getItem('user');
      if (claims && stored) {
        setUser(JSON.parse(stored));
      } else {
        // Token missing, expired, or malformed → treat as logged out.
        clearStoredAuth();
      }
    } catch (err) {
      console.warn('Corrupted auth state in localStorage; clearing', err);
      clearStoredAuth();
    } finally {
      setLoading(false);
    }
  }, []);

  // Soft-redirect on 401 from the axios interceptor. Replaces the previous
  // `window.location.assign('/login')` which wiped SPA state (forms, etc.)
  // and gave the user no explanation for the jump.
  useEffect(() => {
    const onExpired = () => {
      const from = location.pathname;
      setUser(null);
      snackbar.show(t('auth.sessionExpired'), 'warning');
      navigate('/login', { state: { from }, replace: true });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [navigate, location.pathname, snackbar, t]);

  // Proactive expiry warning ~60s before the JWT exp. Lets a user finish
  // typing instead of getting kicked out mid-edit.
  useEffect(() => {
    if (!user) return;
    const claims = readTokenClaims();
    if (!claims) return;
    const msUntilWarn = claims.exp * 1000 - Date.now() - 60_000;
    if (msUntilWarn <= 0) return;
    const handle = window.setTimeout(() => {
      snackbar.show(t('auth.expiringSoon'), 'warning');
    }, msUntilWarn);
    return () => window.clearTimeout(handle);
  }, [user, snackbar, t]);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
  };

  const logout = () => {
    clearStoredAuth();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}
