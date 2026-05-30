import { useEffect, useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Link, Stack, TextField, Typography,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useAuth } from '../lib/auth';
import { useSnackbar } from '../lib/snackbar';
import { apiErrorMessage } from '../lib/errors';

interface ConnectionStatus {
  connected: boolean;
  googleAccount?: string | null;
  connectedAt?: string;
}

interface SyncRowError {
  rowNumber: number;
  guestLabel: string;
  message: string;
}

interface SyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  skipped: number;
  unknownStatuses: number;
  demotedConfirmed: number;
  attendeesCreated: number;
  attendeesRemoved: number;
  deleted: number;
  errors: SyncRowError[];
}

// The exact word the user must type to unlock the destructive clean sync.
// Trimmed + upper-cased on compare so a stray space or mobile auto-capitalisation
// ("Delete", "DELETE ") still matches.
const CLEAN_CONFIRM_WORD = 'DELETE';

export default function SyncFromGoogleButton() {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const qc = useQueryClient();
  const { currentClientId } = useAuth();
  const [dialogStep, setDialogStep] = useState<'closed' | 'choose' | 'confirmClean'>('closed');
  const [cleanConfirmText, setCleanConfirmText] = useState('');
  const [errorDetail, setErrorDetail] = useState<SyncRowError[] | null>(null);

  const closeDialog = () => {
    setDialogStep('closed');
    setCleanConfirmText('');
  };

  const cleanConfirmed = cleanConfirmText.trim().toUpperCase() === CLEAN_CONFIRM_WORD;

  const { data: status, isLoading: statusLoading } = useQuery<ConnectionStatus>({
    queryKey: qk.googleSyncStatus(currentClientId!),
    queryFn: async () => (await api.get('/google-sync/status')).data,
    enabled: !!currentClientId,
  });

  // Detect the OAuth callback bounce-back. The API redirects the browser to
  // `/?googleConnected=1` or `/?googleConnectError=<msg>` after the consent
  // round-trip. We surface that as a snackbar, refresh the status query, and
  // clean the URL so a refresh doesn't replay the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('googleConnected');
    const errorMsg = params.get('googleConnectError');
    if (!connected && !errorMsg) return;
    if (connected) {
      snackbar.show(t('sync.connectSuccess'), 'success');
      qc.invalidateQueries({ queryKey: qk.googleSyncStatus(currentClientId!) });
    } else if (errorMsg) {
      snackbar.show(t('sync.connectError', { message: errorMsg }), 'error');
    }
    params.delete('googleConnected');
    params.delete('googleConnectError');
    const next = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (next ? `?${next}` : ''),
    );
  }, [qc, snackbar, t]);

  const beginConnect = useMutation({
    mutationFn: async () => (await api.get<{ url: string }>('/google-sync/oauth/url')).data,
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  const disconnect = useMutation({
    mutationFn: async () => api.delete('/google-sync/connection'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.googleSyncStatus(currentClientId!) });
      snackbar.show(t('sync.disconnected'), 'success');
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  const runSync = useMutation({
    mutationFn: async (mode: 'continue' | 'clean') =>
      (await api.post<SyncResult>('/google-sync/run', { mode })).data,
    onSuccess: (data, mode) => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: qk.statsOverview(currentClientId!) });
      closeDialog();
      // One interpolation payload for every variant; the with-errors strings add
      // errorCount. (Clean reports renamed + attendeesRemoved; continue never
      // deletes, so those read 0 there.)
      const vars = {
        deleted: data.deleted,
        inserted: data.inserted,
        updated: data.updated,
        renamed: data.renamed,
        attendees: data.attendeesCreated,
        attendeesRemoved: data.attendeesRemoved,
      };
      const withErrors = data.errors.length > 0;
      const key = mode === 'clean'
        ? (withErrors ? 'sync.completedCleanWithErrors' : 'sync.completedClean')
        : (withErrors ? 'sync.completedWithErrors' : 'sync.completed');
      snackbar.show(
        t(key, withErrors ? { ...vars, errorCount: data.errors.length } : vars),
        withErrors ? 'warning' : 'success',
      );
      if (withErrors) setErrorDetail(data.errors);
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  if (statusLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (!status?.connected) {
    return (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Button
          variant="outlined"
          startIcon={<GoogleIcon />}
          onClick={() => beginConnect.mutate()}
          disabled={beginConnect.isPending}
        >
          {t('sync.connectGoogle')}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {t('sync.notConnectedHelp')}
        </Typography>
      </Stack>
    );
  }

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Button
          variant="contained"
          startIcon={<CloudSyncIcon />}
          onClick={() => setDialogStep('choose')}
        >
          {t('sync.syncFromGoogleSheet')}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {t('sync.connected', { email: status.googleAccount ?? '' })}
          {' · '}
          <Link
            component="button"
            type="button"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            underline="hover"
          >
            {t('sync.disconnect')}
          </Link>
        </Typography>
      </Stack>

      <Dialog
        open={dialogStep !== 'closed'}
        // Don't let a backdrop click / Escape dismiss the dialog while a sync is
        // running — the mutation would keep going invisibly. Gate close on pending.
        onClose={runSync.isPending ? undefined : closeDialog}
        maxWidth="sm"
        fullWidth
      >
        {dialogStep === 'choose' ? (
          // Wrapped in a form so pressing Enter triggers the default (Continue)
          // submit button — satisfying "the default button should be Continue".
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!runSync.isPending) runSync.mutate('continue');
            }}
          >
            <DialogTitle>{t('sync.modeTitle')}</DialogTitle>
            <DialogContent>
              <DialogContentText>{t('sync.modeBody')}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={closeDialog} disabled={runSync.isPending}>
                {t('invitation.cancel')}
              </Button>
              <Button
                type="button"
                color="error"
                onClick={() => setDialogStep('confirmClean')}
                disabled={runSync.isPending}
              >
                {t('sync.modeClean')}
              </Button>
              <Button type="submit" variant="contained" disabled={runSync.isPending}>
                {runSync.isPending ? t('sync.syncing') : t('sync.modeContinue')}
              </Button>
            </DialogActions>
          </form>
        ) : (
          // Enter submits the destructive action only when the typed word matches.
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (cleanConfirmed && !runSync.isPending) runSync.mutate('clean');
            }}
          >
            <DialogTitle>{t('sync.cleanConfirmTitle')}</DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>{t('sync.cleanConfirmBody')}</DialogContentText>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={cleanConfirmText}
                onChange={(e) => setCleanConfirmText(e.target.value)}
                placeholder={t('sync.cleanConfirmPlaceholder')}
              />
            </DialogContent>
            <DialogActions>
              <Button
                type="button"
                onClick={() => { setDialogStep('choose'); setCleanConfirmText(''); }}
                disabled={runSync.isPending}
              >
                {t('sync.back')}
              </Button>
              <Button
                type="submit"
                variant="contained"
                color="error"
                disabled={!cleanConfirmed || runSync.isPending}
              >
                {runSync.isPending ? t('sync.syncing') : t('sync.cleanConfirmButton')}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!errorDetail}
        onClose={() => setErrorDetail(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('sync.errorsHeader')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {errorDetail?.slice(0, 25).map((e, i) => (
              <Typography key={i} variant="body2">
                <strong>{t('sync.rowLabel', { row: e.rowNumber })}</strong>
                {' — '}
                {e.guestLabel || '(blank)'}: {e.message}
              </Typography>
            ))}
            {errorDetail && errorDetail.length > 25 && (
              <Typography variant="caption" color="text.secondary">
                {t('sync.errorsTruncated', { count: errorDetail.length - 25 })}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setErrorDetail(null)}>
            {t('sync.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
