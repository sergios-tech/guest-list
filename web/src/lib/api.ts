import axios from 'axios';
import { queryClient } from './queryClient';

export const api = axios.create({
  baseURL: '/api',     // nginx routes /api/* to NestJS
});

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  // Current tenant. Read from localStorage (not React state) so this
  // module-level interceptor stays in sync with whatever the auth context last
  // persisted. Endpoints without ClientContextGuard (auth, clients admin)
  // simply ignore it, so sending it unconditionally is safe.
  const clientId = localStorage.getItem('currentClientId');
  if (clientId) cfg.headers['X-Client-Id'] = clientId;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Treat a 401 as a session expiry only when it comes from a normal API call,
    // not from a login attempt itself. Keying on the failed REQUEST's URL (rather
    // than the browser's current path) means a bad password / unknown Google
    // account never tears down auth state or evicts the public `authConfig`
    // query, while a genuine expiry is still caught wherever the user happens to
    // be — robust to trailing slashes, query strings, or a router basename.
    const isAuthAttempt = /\/auth\/(login|google)$/.test(err.config?.url ?? '');
    if (err.response?.status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('currentClientId');
      // Drop cached query data so the next user on a shared device cannot
      // see the previous user's invitation list / stats.
      queryClient.clear();
      // Dispatch instead of `window.location.assign` so AuthProvider can do
      // a React Router navigation that preserves the SnackbarProvider and
      // shows a "session expired" message on the login page.
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(err);
  },
);
