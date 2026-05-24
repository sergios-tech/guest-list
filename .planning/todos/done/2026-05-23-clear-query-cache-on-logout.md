---
created: 2026-05-23T22:00:00.000Z
title: Clear TanStack QueryClient on logout (User A's data visible to User B today)
area: ui
files:
  - web/src/lib/auth.tsx:41-45
  - web/src/main.tsx:14-18
  - web/src/lib/api.ts:13-24
---

## Problem

`logout()` only clears localStorage and React state:

```tsx
// web/src/lib/auth.tsx:41-45
const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  setUser(null);
};
```

The TanStack `QueryClient` lives in module memory (`web/src/main.tsx:14`) and is never
cleared. Every previously-fetched invitation list, every stats response, every
attendee list, every detail page — all stay in the cache until a full page reload.

Shared-device leak:

1. User A logs in on a family kiosk, navigates around — queries hydrate.
2. User A clicks Logout. Token gone, state cleared, app redirects.
3. User B sits down, types a different email, logs in. SPA navigates back to
   `/invitations` without a hard reload.
4. TanStack serves A's cached query data **instantly** to B — staleTime is 30s
   (`main.tsx:16`), so the cache is fresh. B sees A's guest list before the
   re-fetch even fires.

The 401 interceptor (`api.ts:13-24`) does a hard `window.location.assign('/login')`
on expiry — that path *does* wipe the cache because it's a full document reload, but
that's an accident of the redirect mechanism, not an explicit policy. The
explicit-logout button skips the full reload and exposes the leak.

## Solution

Call `qc.clear()` and `qc.removeQueries()` on logout. The cleanest factoring is to
expose the `QueryClient` from `main.tsx` and pass it into the auth hook, but a
quick fix is to import the singleton:

```tsx
// web/src/lib/queryClient.ts  (new file)
import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

// web/src/main.tsx
import { queryClient } from './lib/queryClient';
// ...
<QueryClientProvider client={queryClient}>...</QueryClientProvider>

// web/src/lib/auth.tsx
import { queryClient } from './queryClient';
const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  setUser(null);
  queryClient.clear();   // ← wipe all cached queries
};
```

Also apply the same clear inside the 401 response interceptor in `api.ts` so an
expired-token flow can't accidentally retain cached data even if the redirect ever
changes from full-reload to SPA-navigation:

```ts
// web/src/lib/api.ts:18
import { queryClient } from './queryClient';
// inside the interceptor's 401 branch:
queryClient.clear();
localStorage.removeItem('token');
// ... existing redirect
```

If a future feature wants to preserve a *specific* cached entity across logout (e.g. a
locale preference query), use `removeQueries({ queryKey: [...] })` selectively
instead.
