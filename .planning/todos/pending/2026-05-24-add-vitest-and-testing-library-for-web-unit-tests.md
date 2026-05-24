---
created: 2026-05-24T22:44:58.527Z
title: Add Vitest and Testing Library for web unit tests
area: testing
files:
  - web/package.json
  - web/vite.config.ts
  - web/src/lib/api.ts
  - web/src/lib/auth.tsx
  - web/src/App.tsx
---

## Problem

`web/` has no unit test runner. README and CLAUDE.md both flag the gap
("add Vitest + Testing Library for the web if asked"). Without it, the
following non-trivial logic is unverified in isolation:

- `web/src/lib/api.ts` — axios instance that injects JWT from `localStorage`
  and has a 401 response interceptor that bounces to `/login`. No
  in-app refresh-token flow.
- `web/src/lib/auth.tsx` — React auth context; `Protected` route guard
  in `App.tsx`.
- TanStack Query client in `main.tsx` — `staleTime: 30s`, refetch-on-focus
  disabled. Worth a snapshot test that the config doesn't regress.
- i18n persistence via `i18next-browser-languagedetector`.
- AG Grid columns with `hide: isMobile` — viewport-conditional visibility.
- `react-i18next` translation keys — would benefit from a "no missing key"
  smoke test against `web/src/i18n/locales/{en,sr}.json`.

## Solution

TBD. Sketch:

- `npm i -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`
- Vite-native config: extend `web/vite.config.ts` with a `test` block
  (`environment: 'jsdom'`, `globals: true`, `setupFiles: ['./src/test/setup.ts']`).
- `src/test/setup.ts`: `@testing-library/jest-dom/vitest`, polyfill
  `IntersectionObserver`/`ResizeObserver` if AG Grid components show up
  in tests.
- Add npm scripts: `"test": "vitest"`, `"test:run": "vitest run"`,
  `"test:ui": "vitest --ui"`, `"coverage": "vitest run --coverage"`.
- First targets (highest ROI): `lib/api.ts` 401-interceptor behavior,
  `lib/auth.tsx` token-from-storage flow, `Protected` redirect when
  unauthenticated, i18n key-coverage test.

Out of scope for this todo: full component coverage. Goal is "scaffolding
+ 3-5 high-value tests on the auth/api boundary", not a coverage target.
