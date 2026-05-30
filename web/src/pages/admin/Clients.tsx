/**
 * Super-admin page: manage tenants (clients).
 *
 * Usage: rendered inside <SuperAdminOnly> in App.tsx at /admin/clients.
 *
 * Accessibility: Dialog uses aria-labelledby/describedby; delete confirmation
 * Dialog carries a visible warning; all interactive controls have explicit
 * labels or button text. Table uses semantic <table> via MUI Table.
 *
 * Performance: no memoisation needed here — the client list is tiny and
 * mutations are infrequent. useQueryClient invalidates only the narrow
 * qk.clients() key so other queries are untouched.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, IconButton, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography, Alert, CircularProgress,
  Stack,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupIcon from '@mui/icons-material/Group';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage } from '../../lib/errors';

// ── types ────────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
  slug: string | null;
  googleSheetId: string | null;
  googleSheetTab: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientFormState {
  name: string;
  slug: string;
  googleSheetId: string;
  googleSheetTab: string;
}

const emptyForm = (): ClientFormState => ({
  name: '',
  slug: '',
  googleSheetId: '',
  googleSheetTab: '',
});

// ── sub-components ────────────────────────────────────────────────────────────

interface ClientDialogProps {
  open: boolean;
  initial?: ClientFormState;
  title: string;
  submitLabel: string;
  loading: boolean;
  error: string | null;
  onSubmit: (data: ClientFormState) => void;
  onClose: () => void;
}

function ClientDialog({
  open, initial, title, submitLabel, loading, error, onSubmit, onClose,
}: ClientDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ClientFormState>(initial ?? emptyForm());

  // Reset form whenever the dialog opens with new initial values.
  // Using a key on the Dialog itself (see call sites) achieves the same
  // effect without needing a separate useEffect.

  const set = (field: keyof ClientFormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="client-dialog-title"
      fullWidth
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle id="client-dialog-title">{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t('admin.clients.fields.name')}
              value={form.name}
              onChange={set('name')}
              required
              autoFocus
              fullWidth
              inputProps={{ 'aria-required': true }}
            />
            <TextField
              label={t('admin.clients.fields.slug')}
              value={form.slug}
              onChange={set('slug')}
              fullWidth
              helperText={t('admin.clients.fields.slugHelp')}
            />
            <TextField
              label={t('admin.clients.fields.googleSheetId')}
              value={form.googleSheetId}
              onChange={set('googleSheetId')}
              fullWidth
            />
            <TextField
              label={t('admin.clients.fields.googleSheetTab')}
              value={form.googleSheetTab}
              onChange={set('googleSheetTab')}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            {t('invitation.cancel')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !form.name.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : undefined}
          >
            {submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Clients() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── query ──────────────────────────────────────────────────────────────────
  const { data: clients = [], isLoading, error: loadError } = useQuery<Client[]>({
    queryKey: qk.clients(),
    queryFn: async () => (await api.get('/clients')).data,
  });

  // ── create dialog ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: ClientFormState) =>
      api.post('/clients', {
        name: data.name,
        ...(data.slug ? { slug: data.slug } : {}),
        ...(data.googleSheetId ? { googleSheetId: data.googleSheetId } : {}),
        ...(data.googleSheetTab ? { googleSheetTab: data.googleSheetTab } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clients() });
      setCreateOpen(false);
      setCreateError(null);
    },
    onError: (err) => setCreateError(apiErrorMessage(err, t)),
  });

  // ── edit dialog ────────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientFormState }) =>
      api.patch(`/clients/${id}`, {
        name: data.name,
        slug: data.slug || null,
        googleSheetId: data.googleSheetId || null,
        googleSheetTab: data.googleSheetTab || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clients() });
      setEditTarget(null);
      setEditError(null);
    },
    onError: (err) => setEditError(apiErrorMessage(err, t)),
  });

  // ── delete dialog ──────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clients() });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err) => setDeleteError(apiErrorMessage(err, t)),
  });

  // ── render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Alert severity="error">{apiErrorMessage(loadError, t)}</Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" component="h1">
          {t('admin.clients.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => { setCreateError(null); setCreateOpen(true); }}
        >
          {t('admin.clients.create')}
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table aria-label={t('admin.clients.title')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.clients.fields.name')}</TableCell>
              <TableCell>{t('admin.clients.fields.slug')}</TableCell>
              <TableCell>{t('admin.clients.fields.googleSheetId')}</TableCell>
              <TableCell>{t('admin.clients.fields.googleSheetTab')}</TableCell>
              <TableCell align="right">{t('admin.clients.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {t('admin.clients.empty')}
                </TableCell>
              </TableRow>
            )}
            {clients.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.slug ?? '—'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.googleSheetId ?? '—'}
                </TableCell>
                <TableCell>{c.googleSheetTab ?? '—'}</TableCell>
                <TableCell align="right">
                  <Tooltip title={t('admin.members.title')}>
                    <IconButton
                      size="small"
                      aria-label={t('admin.members.title')}
                      onClick={() => navigate(`/admin/clients/${c.id}/members`)}
                    >
                      <GroupIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('admin.clients.edit')}>
                    <IconButton
                      size="small"
                      aria-label={t('admin.clients.edit')}
                      onClick={() => {
                        setEditError(null);
                        setEditTarget(c);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('admin.clients.delete')}>
                    <IconButton
                      size="small"
                      aria-label={t('admin.clients.delete')}
                      color="error"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(c);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create dialog — key forces full remount (fresh form) each open */}
      <ClientDialog
        key={createOpen ? 'create-open' : 'create-closed'}
        open={createOpen}
        title={t('admin.clients.createTitle')}
        submitLabel={t('admin.clients.create')}
        loading={createMutation.isPending}
        error={createError}
        onSubmit={(data) => createMutation.mutate(data)}
        onClose={() => setCreateOpen(false)}
      />

      {/* Edit dialog — key forces remount when the target changes */}
      {editTarget && (
        <ClientDialog
          key={`edit-${editTarget.id}`}
          open={!!editTarget}
          initial={{
            name: editTarget.name,
            slug: editTarget.slug ?? '',
            googleSheetId: editTarget.googleSheetId ?? '',
            googleSheetTab: editTarget.googleSheetTab ?? '',
          }}
          title={t('admin.clients.editTitle')}
          submitLabel={t('admin.clients.save')}
          loading={editMutation.isPending}
          error={editError}
          onSubmit={(data) => editMutation.mutate({ id: editTarget.id, data })}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        aria-labelledby="delete-client-title"
        aria-describedby="delete-client-desc"
      >
        <DialogTitle id="delete-client-title">
          {t('admin.clients.deleteTitle')}
        </DialogTitle>
        <DialogContent>
          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}
          <DialogContentText id="delete-client-desc">
            {t('admin.clients.deleteWarning', { name: deleteTarget?.name ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
            {t('invitation.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            startIcon={deleteMutation.isPending ? <CircularProgress size={16} /> : undefined}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            {t('admin.clients.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
