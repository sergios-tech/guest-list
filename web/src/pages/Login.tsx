import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, TextField, Button, Alert,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { apiErrorMessage, apiErrorStatus } from '../lib/errors';
import GoogleLoginButton from '../components/GoogleLoginButton';
import logoUrl from '../assets/Sergio_s_Tech_Logo_Official_Vector.svg';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login, loginWithGoogle } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('owner@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Shared scaffold for both login paths: toggle busy, clear any prior error,
  // run the auth call, navigate home on success, and map a failure to a message.
  const runLogin = useCallback(
    async (action: () => Promise<void>, mapError: (err: unknown) => string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        nav('/');
      } catch (err) {
        setError(mapError(err));
      } finally {
        setBusy(false);
      }
    },
    [nav],
  );

  const submit = () => runLogin(() => login(email, password), () => t('login.error'));

  const year = new Date().getFullYear();

  // The GIS button hands us a Google ID token; trade it for our JWT. Memoised so
  // its identity is stable across re-renders — GoogleLoginButton's init effect
  // depends on it. The server returns a single generic 401 for any rejected
  // Google login ("existing users only"), surfaced as the friendly "ask the
  // owner" hint; non-401 failures (network, 429, 5xx) get the real error instead.
  const onGoogleCredential = useCallback(
    (idToken: string) =>
      runLogin(
        () => loginWithGoogle(idToken),
        (err) =>
          apiErrorStatus(err) === 401 ? t('login.googleNoAccount') : apiErrorMessage(err, t),
      ),
    [runLogin, loginWithGoogle, t],
  );

  return (
    <Box sx={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      px: 2, bgcolor: 'background.default',
    }}>
      <Paper elevation={3} sx={{ width: '100%', maxWidth: 380, overflow: 'hidden' }}>
        {/* Full-bleed masthead: the app title on a filled primary rectangle. */}
        <Box sx={{
          bgcolor: 'primary.main', color: 'primary.contrastText',
          py: 1.5, px: 2, textAlign: 'center',
        }}>
          <Typography variant="h6" component="h1" sx={{
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
          }}>
            {t('app.title')}
          </Typography>
        </Box>
        {/* Logo sits below the title bar, with a small gap beneath it. */}
        <Box
          component="img"
          src={logoUrl}
          alt=""
          sx={{
            height: 56, width: 'auto', mx: 'auto', display: 'block',
            mt: { xs: 3, sm: 4 }, mb: 1,
          }}
        />
        <Stack spacing={2} sx={{ p: { xs: 3, sm: 4 } }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('login.email')} type="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <TextField
            label={t('login.password')} type="password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoComplete="current-password"
          />
          <Button onClick={submit} disabled={busy}>{t('login.submit')}</Button>
          {/* The "or" divider lives inside GoogleLoginButton so it disappears
              together with the button when GIS is unavailable. */}
          <GoogleLoginButton onCredential={onGoogleCredential} disabled={busy} />
          <Box sx={{ textAlign: 'center', mt: 1 }}>
            <Button
              size="small" variant="text"
              onClick={() => i18n.changeLanguage(i18n.language.startsWith('en') ? 'sr' : 'en')}
            >
              {i18n.language.startsWith('en') ? 'Srpski' : 'English'}
            </Button>
          </Box>
          <Typography variant="caption" align="center" sx={{ color: 'text.secondary' }}>
            © {year} Sergio's Tech
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
