---
created: 2026-05-24T08:00:00.000Z
title: Surface session expiry without losing unsaved work on 401
area: ui
files:
  - web/src/lib/api.ts:13-24
  - web/src/lib/auth.tsx
  - web/src/pages/InvitationDetail.tsx
---

## Problem

The 401 response interceptor does a hard document navigation:

```ts
// web/src/lib/api.ts:13-24
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');   // ← full page reload
      }
    }
    return Promise.reject(err);
  }
);
```

`window.location.assign` discards the entire SPA state — React tree, `QueryClient`
cache, `react-hook-form` state, AG Grid editor state, every in-flight mutation. The
user who left a tab open overnight (JWT default `expiresIn: '12h'`,
`auth.module.ts:16`) returns, clicks Save on a half-edited invitation, gets booted
to `/login` losing every keystroke. No "session expired, please log in again"
message — just an abrupt jump.

## Solution

Three layered changes; pick the ones that fit your appetite for scope:

1. **Soft redirect via React Router** (smallest change). Move the redirect out of the
   interceptor into the `AuthProvider` so it uses `useNavigate()`:

   ```ts
   // api.ts — only sets a flag
   if (err.response?.status === 401) {
     window.dispatchEvent(new CustomEvent('auth:expired'));
   }

   // auth.tsx
   useEffect(() => {
     const onExpired = () => {
       logout();
       navigate('/login', { state: { from: location.pathname, expired: true } });
     };
     window.addEventListener('auth:expired', onExpired);
     return () => window.removeEventListener('auth:expired', onExpired);
   }, [navigate, location]);
   ```

   On the `/login` page, read `location.state.expired` and render a Snackbar/Alert:
   "Your session expired — please sign in again to continue."

2. **Proactive expiry banner.** Decode the JWT `exp` claim on app boot and show a
   warning 60s before expiry (e.g., MUI Snackbar with a "Stay signed in" button that
   calls a `/auth/refresh` endpoint — pairs with the proactive-jwt-expiry TODO if you
   add refresh tokens).

3. **Preserve in-flight form state.** For the InvitationDetail form, persist
   `react-hook-form` state to `sessionStorage` on `beforeunload` and rehydrate after
   re-login. Highest UX value but most code; defer until users actually complain.

Recommended order: ship #1 first (single afternoon of work, 80% of the win), follow
up with #2 when refresh tokens land.

While here, also add `qc.clear()` in the 401 branch (pairs with the
`clear-query-cache-on-logout` TODO) — today the hard reload effectively clears the
cache, but a soft redirect would leak it.
