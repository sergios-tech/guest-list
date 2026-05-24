---
created: 2026-05-24T08:00:00.000Z
title: Replace `origin: true, credentials: true` CORS with an explicit allowlist
area: api
files:
  - api/src/main.ts:15
---

## Problem

```ts
// api/src/main.ts:15
app.enableCors({ origin: true, credentials: true });
```

`origin: true` reflects the request's `Origin` header back as `Access-Control-Allow-Origin`,
and `credentials: true` instructs browsers to send cookies/HTTP-auth on cross-origin
requests. This is the worst-case CORS config.

Today the impact is bounded because the JWT lives in `localStorage` and is attached
via the `Authorization` header (which is **not** auto-sent cross-origin). But:

- The moment anyone migrates to httpOnly cookies for refresh-token storage (the
  obvious next-step hardening) every page on the internet can issue credentialed
  requests against this API.
- A CSRF token implementation today would still be defeated because the API trusts
  the reflected origin.
- Pre-flight responses are cached by the browser; the reflected `Allow-Origin: *evil*`
  sticks around even after a config tightening.

## Solution

Maintain an explicit whitelist driven by env var:

```ts
// api/src/main.ts
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.enableCors({
  origin: (origin, cb) => {
    // allow same-origin / curl / server-to-server (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
});
```

Set `CORS_ORIGINS=https://guests.example.com,https://www.guests.example.com` in the
production env. In dev, default to `http://localhost:5173,http://localhost:8080`.

Since the production deploy uses nginx as the single ingress on `:8080` (per
`nginx/default.conf`), the API only ever receives same-origin requests from the SPA
in practice — so the failure mode of a too-strict allowlist is loud (CORS error in
console) rather than silent.

Add an integration test: request with `Origin: https://evil.com` → response must NOT
contain `Access-Control-Allow-Origin`.
