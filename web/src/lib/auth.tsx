import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { queryClient } from './queryClient';
import { useSnackbar } from './snackbar';

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';

// A tenant the user can access, with the role that applies within it. Roles are
// now per-client, so they live here rather than on the user.
export interface ClientMembership {
  id: string;
  name: string;
  role: Role;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  isSuperAdmin: boolean;
  clients: ClientMembership[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  // Currently-selected tenant: sent as X-Client-Id on every request and used to
  // scope query keys. Null only when the user has no memberships.
  currentClientId: string | null;
  // The user's role WITHIN the current client (null if there is no current one).
  currentRole: Role | null;
  clients: ClientMembership[];
  switchClient: (id: string) => void;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

// Shape of both /auth/login and /auth/google responses.
interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const CLIENT_KEY = 'currentClientId';

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
  const raw = localStorage.getItem(TOKEN_KEY);
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
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(CLIENT_KEY);
  queryClient.clear();
}

// Pick a valid current client: keep the stored one if it is still a membership,
// otherwise fall back to the first membership (or null if there are none).
function resolveClientId(user: AuthUser | null, stored: string | null): string | null {
  if (!user || user.clients.length === 0) return null;
  if (stored && user.clients.some((c) => c.id === stored)) return stored;
  return user.clients[0].id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentClientId, setCurrentClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const snackbar = useSnackbar();
  const { t } = useTranslation();

  // Persist the chosen client so api.ts's request interceptor (which reads
  // localStorage, not React state) sends a matching X-Client-Id header.
  const applyClientId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(CLIENT_KEY, id);
    else localStorage.removeItem(CLIENT_KEY);
    setCurrentClientId(id);
  }, []);

  // Initial rehydrate. Wrapped in try/catch because a partially-written or
  // schema-mismatched localStorage value would throw `SyntaxError`, leaving
  // `loading=true` forever and rendering the app as a blank screen.
  useEffect(() => {
    try {
      const claims = readTokenClaims();
      const stored = localStorage.getItem(USER_KEY);
      if (claims && stored) {
        const parsed = JSON.parse(stored) as AuthUser;
        setUser(parsed);
        setCurrentClientId(resolveClientId(parsed, localStorage.getItem(CLIENT_KEY)));
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

  // After rehydrate, refresh memberships from the server so role/membership
  // changes made by an admin take effect without forcing a re-login.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<AuthUser>('/auth/me');
        if (cancelled) return;
        localStorage.setItem(USER_KEY, JSON.stringify(data));
        setUser(data);
        applyClientId(resolveClientId(data, localStorage.getItem(CLIENT_KEY)));
      } catch {
        // 401s are handled by the api response interceptor (auth:expired).
      }
    })();
    return () => { cancelled = true; };
  }, [applyClientId]);

  // Soft-redirect on 401 from the axios interceptor. Replaces the previous
  // `window.location.assign('/login')` which wiped SPA state (forms, etc.)
  // and gave the user no explanation for the jump.
  useEffect(() => {
    const onExpired = () => {
      const from = location.pathname;
      setUser(null);
      setCurrentClientId(null);
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

  // Both login paths end the same way: clear any previous user's cached queries
  // (so a fresh login on a shared device can't surface the prior user's data),
  // stash the JWT + user, pick a current client, and flip context.
  const persistSession = useCallback((data: AuthResponse) => {
    queryClient.clear();
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
    applyClientId(resolveClientId(data.user, localStorage.getItem(CLIENT_KEY)));
  }, [applyClientId]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
    persistSession(data);
  }, [persistSession]);

  // Exchange a Google ID token (from the GIS button) for our own JWT. The
  // backend rejects with 401 if no app_user matches the verified Google email.
  const loginWithGoogle = useCallback(async (idToken: string) => {
    const { data } = await api.post<AuthResponse>('/auth/google', { idToken });
    persistSession(data);
  }, [persistSession]);

  const logout = useCallback(() => {
    clearStoredAuth();
    setUser(null);
    setCurrentClientId(null);
  }, []);

  const switchClient = useCallback((id: string) => {
    // Drop the cache so the previous tenant's data can't surface under the new
    // client before its queries refetch.
    queryClient.clear();
    applyClientId(id);
  }, [applyClientId]);

  const currentRole = useMemo<Role | null>(() => {
    if (!user || !currentClientId) return null;
    return user.clients.find((c) => c.id === currentClientId)?.role ?? null;
  }, [user, currentClientId]);

  // Memoised so consumers that depend on these functions (e.g. Login's
  // onGoogleCredential, which feeds GoogleLoginButton's init effect) keep a
  // stable identity across AuthProvider re-renders — this component re-renders
  // on every navigation because it consumes useLocation().
  const value = useMemo<AuthCtx>(
    () => ({
      user, loading, currentClientId, currentRole,
      clients: user?.clients ?? [],
      switchClient, login, loginWithGoogle, logout,
    }),
    [user, loading, currentClientId, currentRole, switchClient, login, loginWithGoogle, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
