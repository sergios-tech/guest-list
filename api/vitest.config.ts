import { defineConfig } from 'vitest/config';

// Scope test discovery to the TypeScript specs under src/. Without an explicit
// include, `vitest run` also globs the compiled dist/**/*.spec.js that
// `nest build` emits — those are CommonJS and fail on `require('vitest')`, so a
// plain `npm test` after a build would error on artifacts rather than source.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
