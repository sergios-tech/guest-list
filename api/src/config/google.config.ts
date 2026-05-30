// Single source of truth for the Google OAuth client id. Both the Sheets-sync
// OAuth flow (google-oauth.service.ts) and the Google login flow
// (auth.service.ts) read it from here so the value can't drift between two
// process.env reads.
//
// The client id is PUBLIC by design: it ships to the browser (GIS button) and
// is only used as the `audience` when verifying Google-signed ID tokens.
//
// Like getJwtSecret(), this FAILS FAST in production: an unset client id would
// otherwise boot healthily but break every Google login (audience pinned to a
// placeholder no real token carries) and serve the placeholder to the SPA — a
// silent outage the CI healthcheck can't catch. In non-production we fall back
// to the dev placeholder so local work and tests don't need the env var.
export function getGoogleClientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (v && v.trim()) return v.trim();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID must be set in production — it is the audience used ' +
        'to verify Google ID tokens and is served to the SPA for the GIS button.',
    );
  }
  return 'dev-google-client-id';
}
