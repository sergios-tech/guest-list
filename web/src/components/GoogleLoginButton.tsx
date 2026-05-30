import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Divider } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';

// Minimal shape of the parts of Google Identity Services we touch. GIS ships no
// types, and pulling in @types/google.accounts for two calls isn't worth it.
interface GoogleCredentialResponse {
  credential?: string; // the Google-signed ID token (a JWT); absent on error/abort
}
interface GoogleIdApi {
  initialize(opts: {
    client_id: string;
    callback: (resp: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    opts: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      shape?: 'rectangular' | 'pill';
      width?: number;
      locale?: string;
    },
  ): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

interface Props {
  /** Called with the Google ID token once the user picks an account. */
  onCredential: (idToken: string) => void;
  /** Disable rendering while a parent sign-in is in flight. */
  disabled?: boolean;
}

/**
 * Renders Google's official "Sign in with Google" button (preceded by an "or"
 * divider). The client id is fetched at runtime from GET /api/auth/config (it's
 * public — only used as the token audience), so changing it never requires a
 * frontend rebuild.
 *
 * Google renders the button into our div; on selection it hands back an ID
 * token which we forward via `onCredential`. The backend verifies it. If GIS or
 * the config can't load, the whole component (divider included) renders nothing
 * and the password form stands alone.
 */
export default function GoogleLoginButton({ onCredential, disabled }: Props) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Latches true while a credential is being processed, so a double-fire from
  // GIS can't kick off two parallel /auth/google posts. Reset when the parent
  // sign-in finishes (disabled → false); on success the parent navigates away.
  const inFlight = useRef(false);
  // GIS loads via an async <script> in index.html, so it may not be on
  // `window` yet when this mounts. Poll briefly until it appears.
  const [gisReady, setGisReady] = useState(Boolean(window.google?.accounts?.id));
  // Set when GIS hasn't loaded within ~10s (ad-blocker, slow link, CSP). We hide
  // the button rather than spinning forever, but keep polling so a late load
  // still recovers.
  const [gisFailed, setGisFailed] = useState(false);

  const { data: config, isError: configFailed } = useQuery<{ googleClientId: string }>({
    queryKey: qk.authConfig(),
    queryFn: async () => (await api.get('/auth/config')).data,
    staleTime: Infinity, // the client id is immutable for the app's lifetime
  });
  const clientId = config?.googleClientId;

  useEffect(() => {
    if (gisReady) return;
    const handle = window.setInterval(() => {
      if (window.google?.accounts?.id) {
        setGisReady(true);
        setGisFailed(false); // recovered from a slow load
        window.clearInterval(handle);
      }
    }, 100);
    // Give up *displaying* after ~10s if the script is blocked, but keep the
    // interval running so a script that arrives at 10.1s still un-hides the
    // button instead of requiring a full page reload.
    const timeout = window.setTimeout(() => setGisFailed(true), 10_000);
    return () => {
      window.clearInterval(handle);
      window.clearTimeout(timeout);
    };
  }, [gisReady]);

  // Re-arm the double-fire latch once a parent sign-in attempt finishes
  // (busy → false, e.g. after a rejected login) so the user can retry.
  useEffect(() => {
    if (!disabled) inFlight.current = false;
  }, [disabled]);

  // Initialise GIS once ready. Kept separate from rendering so a locale change
  // re-renders the button WITHOUT resetting GIS's global callback/client state.
  useEffect(() => {
    if (!gisReady || !clientId) return;
    window.google!.accounts.id.initialize({
      client_id: clientId,
      callback: (resp) => {
        // Ignore credential-less responses (FedCM/abort) and guard a double-fire.
        if (!resp.credential || inFlight.current) return;
        inFlight.current = true;
        onCredential(resp.credential);
      },
    });
  }, [gisReady, clientId, onCredential]);

  // Render (and re-render on locale change) the official button into our div.
  useEffect(() => {
    const el = containerRef.current;
    if (!gisReady || !clientId || !el) return;
    // Clear any prior button first so a locale change re-renders in place rather
    // than appending a second iframe.
    el.replaceChildren();
    window.google!.accounts.id.renderButton(el, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      // Match the surrounding full-width controls. GIS clamps width to [200, 400];
      // fall back to 320 before the container has measured.
      width: Math.min(400, Math.max(200, el.offsetWidth || 320)),
      // GIS expects an ISO locale; i18next gives us 'en' / 'sr'.
      locale: i18n.language.startsWith('en') ? 'en' : 'sr',
    });
  }, [gisReady, clientId, i18n.language]);

  // GIS unavailable or the public config never loaded → render nothing (no
  // dangling "or" divider); the password login still works.
  if (gisFailed || configFailed) return null;

  const divider = (
    <Divider sx={{ color: 'text.secondary', fontSize: 13 }}>
      {t('login.orContinueWith')}
    </Divider>
  );

  // Until GIS + config are ready, show the divider + a spinner so the layout
  // doesn't jump when the button appears.
  if (!gisReady || !clientId) {
    return (
      <>
        {divider}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
          <CircularProgress size={20} />
        </Box>
      </>
    );
  }

  // While a sign-in is in flight, block clicks and dim the button — the GIS
  // iframe is injected imperatively, so `disabled` can't gate it any other way.
  return (
    <>
      {divider}
      <Box
        ref={containerRef}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: disabled ? 'none' : 'auto',
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </>
  );
}
