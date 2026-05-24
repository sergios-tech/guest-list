---
created: 2026-05-23T22:00:00.000Z
title: Guard JSON.parse(localStorage.user) — corrupted state blanks the app
area: ui
files:
  - web/src/lib/auth.tsx:28-32
  - web/src/lib/auth.tsx:19-20
---

## Problem

`AuthProvider` rehydrates the user from `localStorage` in a `useEffect` with no error
handling:

```tsx
useEffect(() => {
  const stored = localStorage.getItem('user');
  if (stored) setUser(JSON.parse(stored));   // ← throws on bad input
  setLoading(false);                          // ← never runs if above throws
}, []);
```

If `localStorage.user` is corrupted, partially written, manually edited via DevTools,
left over from a previous app schema, or set to the literal string `'undefined'` (a
classic JS footgun where someone did `localStorage.setItem('user', String(undefined))`),
`JSON.parse` throws `SyntaxError`. The throw escapes the effect, `setLoading(false)`
never runs, the `Protected` route guard (App.tsx:11) returns `null` forever, and the
user sees a **permanent blank white screen** with no path to `/login` short of clearing
storage from DevTools.

There's a secondary issue at line 19: `createContext<AuthCtx>(null!)` uses a non-null
assertion, so any consumer rendered outside `AuthProvider` (a future test, Storybook,
error-boundary fallback) crashes with `Cannot destructure property 'user' of null`
instead of a clear "useAuth must be used within AuthProvider" error.

## Solution

Wrap the parse in try/catch, recover from corruption by treating it as logged-out, and
log loudly for diagnostics:

```tsx
useEffect(() => {
  try {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  } catch (err) {
    console.warn('Corrupted auth state in localStorage; clearing', err);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  } finally {
    setLoading(false);
  }
}, []);
```

The `finally` makes the loading flag flip unconditional, which is the key correctness
property — a corrupted state should drop the user to `/login`, never blank the app.

While here, harden the context default for the secondary issue:

```tsx
const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
```

This turns an obscure runtime null-destructure into a developer-friendly error at the
exact site of misuse.

Optional: validate the parsed shape (e.g. `typeof parsed?.id === 'string'`) and clear
storage if it doesn't match — defends against an older app version's schema being
loaded by a returning user.
