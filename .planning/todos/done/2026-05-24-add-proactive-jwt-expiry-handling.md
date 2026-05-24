---
created: 2026-05-24T08:00:00.000Z
title: Add proactive JWT expiry handling and refresh
area: ui
files:
  - web/src/lib/auth.tsx
  - web/src/lib/api.ts
  - api/src/modules/auth/auth.service.ts
  - api/src/modules/auth/auth.controller.ts
  - api/src/modules/auth/auth.module.ts:16
---

## Problem

The frontend never inspects the JWT `exp` claim. `package.json` doesn't pull
`jwt-decode` either:

```bash
$ grep -rn 'jwt-decode\|jwtDecode' web/src
# (no matches)
```

```tsx
// web/src/lib/auth.tsx (paraphrased)
// Best-effort: if a token is present, decode it lazily by hitting any
// protected endpoint. For now we trust whatever is in localStorage.user.
```

The only signal of expiry is a server 401, which means every long-session user is
guaranteed to hit at least one failed request after the 12h default (`auth.module.ts:16`):

- User opens app at 9am, token expires at 9pm.
- They return next morning, cached UI renders normally (refetchOnWindowFocus is
  disabled in `main.tsx:16`).
- They open an invitation, the GET 401s, the interceptor does a hard redirect to
  `/login` losing any unsaved form state (see also
  `surface-session-expiry-instead-of-hard-redirect`).

There's also no `/auth/refresh` endpoint, so even a perfect expiry warning can only
say "please log in again" rather than silently rotating credentials.

## Solution

Three layered improvements:

1. **Decode `exp` on app boot.** Add `jwt-decode` (~1KB) and pre-check expiry:

   ```ts
   // web/src/lib/auth.tsx
   import { jwtDecode } from 'jwt-decode';

   function readToken(): { sub: string; exp: number } | null {
     const raw = localStorage.getItem('token');
     if (!raw) return null;
     try {
       const payload = jwtDecode<{ sub: string; exp: number }>(raw);
       if (payload.exp * 1000 < Date.now()) return null;
       return payload;
     } catch {
       return null;
     }
   }
   ```

   In `AuthProvider`'s mount effect, if `readToken()` returns null, treat as
   logged-out (clear localStorage, leave `user` null). Prevents the "cached UI
   renders for a logged-out user until first 401" flash.

2. **Proactive expiry warning.** Schedule a snackbar 60s before `exp`:

   ```ts
   useEffect(() => {
     const token = readToken();
     if (!token) return;
     const msUntilWarn = token.exp * 1000 - Date.now() - 60_000;
     if (msUntilWarn <= 0) return;
     const t = setTimeout(() => {
       setSnackbar({
         message: t('auth.expiringWarning'),   // "Your session ends in 1 minute"
         action: { label: t('auth.refresh'), onClick: refresh },
       });
     }, msUntilWarn);
     return () => clearTimeout(t);
   }, [user]);
   ```

3. **Refresh-token flow** (medium scope). Add `POST /auth/refresh` returning a new
   access token. Store the refresh token in an httpOnly cookie (not localStorage —
   immune to XSS). Add an axios interceptor that, on 401, transparently calls
   refresh once before failing.

   Server side:

   ```ts
   @Post('refresh')
   @UseGuards(JwtAuthGuard)
   refresh(@Req() req) {
     return { accessToken: this.auth.signAccess(req.user) };
   }
   ```

   And shorten the access-token lifetime (`expiresIn: '1h'` instead of `12h`) so
   the refresh dance actually does its job. Refresh tokens stay at 7d/30d as
   appropriate.

Recommended order: ship #1 immediately (single afternoon), #2 in the same PR if
you want a polished UX, defer #3 until you have a hardening sprint — it touches
backend + cookie config + nginx and benefits from being its own slice.

Pairs with: `surface-session-expiry-instead-of-hard-redirect`,
`clear-query-cache-on-logout`, `tighten-cors-origin-whitelist`.
