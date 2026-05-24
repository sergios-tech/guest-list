import axios from 'axios';
import { queryClient } from './queryClient';

export const api = axios.create({
  baseURL: '/api',     // nginx routes /api/* to NestJS
});

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Drop cached query data so the next user on a shared device cannot
      // see the previous user's invitation list / stats.
      queryClient.clear();
      // Dispatch instead of `window.location.assign` so AuthProvider can do
      // a React Router navigation that preserves the SnackbarProvider and
      // shows a "session expired" message on the login page.
      if (window.location.pathname !== '/login') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }
    return Promise.reject(err);
  },
);
