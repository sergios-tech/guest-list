// Shared throttler names so the @Throttle override keys (auth.controller.ts)
// can't drift from the throttler definitions (app.module.ts). A bare string key
// that doesn't match a configured throttler is silently ignored — e.g. the old
// `@Throttle({ default: ... })` matched nothing and left the global limits in
// force. Referencing these consts means a rename is a single edit that fails to
// compile everywhere it isn't updated, instead of silently reverting limits.
export const THROTTLER = {
  SHORT: 'short',
  LONG: 'long',
} as const;
