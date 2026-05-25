import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, TextField, Button, Alert,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('owner@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await login(email, password);
      nav('/');
    } catch {
      setError(t('login.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      px: 2, bgcolor: 'background.default',
    }}>
      <Paper elevation={3} sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 380 }}>
        <Stack spacing={2}>
          <Typography variant="h5" align="center">{t('login.title')}</Typography>
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
          <Box sx={{ textAlign: 'center', mt: 1 }}>
            <Button
              size="small" variant="text"
              onClick={() => i18n.changeLanguage(i18n.language.startsWith('en') ? 'sr' : 'en')}
            >
              {i18n.language.startsWith('en') ? 'Srpski' : 'English'}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
