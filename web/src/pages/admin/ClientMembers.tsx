/**
 * Super-admin page: manage members of a single client (tenant).
 *
 * Usage: rendered inside <SuperAdminOnly> in App.tsx at
 *        /admin/clients/:id/members.
 *
 * Accessibility: all interactive cells use IconButton with aria-label;
 * the role <Select> in each row has an implicit label from the column header
 * and an explicit aria-label. Dialog uses aria-labelledby.
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, IconButton, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage } from '../../lib/errors';
import type { Role } from '../../lib/auth';

// ── types ─────────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
}

const ROLES: Role[] = ['OWNER', 'EDITOR', 'VIEWER'];

// ── main page ─────────────────────────────────────────────────────────────────

export default function ClientMembers() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── query ──────────────────────────────────────────────────────────────────
  const {
    data: members = [],
    isLoading,
    error: loadError,
  } = useQuery<Member[]>({
    queryKey: qk.clientMembers(id!),
    queryFn: async () => (await api.get(`/clients/${id}/members`)).data,
    enabled: !!id,
  });

  // ── add member dialog ──────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<Role>('VIEWER');
  const [addError, setAddError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/clients/${id}/members`, { email: addEmail.trim(), role: addRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clientMembers(id!) });
      setAddOpen(false);
      setAddEmail('');
      setAddRole('VIEWER');
      setAddError(null);
    },
    onError: (err) => setAddError(apiErrorMessage(err, t)),
  });

  // ── role change (inline) ───────────────────────────────────────────────────
  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.patch(`/clients/${id}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clientMembers(id!) }),
  });

  // ── remove member dialog ───────────────────────────────────────────────────
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/clients/${id}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clientMembers(id!) });
      setRemoveTarget(null);
      setRemoveError(null);
    },
    onError: (err) => setRemoveError(apiErrorMessage(err, t)),
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
    return <Alert severity="error">{apiErrorMessage(loadError, t)}</Alert>;
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Tooltip title={t('admin.members.back')}>
          <IconButton
            aria-label={t('admin.members.back')}
            onClick={() => navigate('/admin/clients')}
            edge="start"
          >
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Typography variant="h5" component="h1" sx={{ flexGrow: 1 }}>
          {t('admin.members.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={() => { setAddError(null); setAddOpen(true); }}
        >
          {t('admin.members.add')}
        </Button>
      </Stack>

      <TableContainer component={Paper}>
        <Table aria-label={t('admin.members.title')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.members.fields.email')}</TableCell>
              <TableCell>{t('admin.members.fields.displayName')}</TableCell>
              <TableCell>{t('admin.members.fields.role')}</TableCell>
              <TableCell align="right">{t('admin.clients.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {t('admin.members.empty')}
                </TableCell>
              </TableRow>
            )}
            {members.map((m) => (
              <TableRow key={m.userId} hover>
                <TableCell>{m.email}</TableCell>
                <TableCell>{m.displayName}</TableCell>
                <TableCell>
                  {/* Inline role editor: PATCH on change */}
                  <Select
                    size="small"
                    value={m.role}
                    onChange={(e) =>
                      roleMutation.mutate({ userId: m.userId, role: e.target.value as Role })
                    }
                    inputProps={{ 'aria-label': `${t('admin.members.fields.role')} ${m.email}` }}
                  >
                    {ROLES.map((r) => (
                      <MenuItem key={r} value={r}>
                        {t(`admin.members.roles.${r}`)}
                      </MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={t('admin.members.remove')}>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`${t('admin.members.remove')} ${m.email}`}
                      onClick={() => { setRemoveError(null); setRemoveTarget(m); }}
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

      {/* Add member dialog */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        aria-labelledby="add-member-title"
        fullWidth
        maxWidth="xs"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addMutation.mutate();
          }}
        >
          <DialogTitle id="add-member-title">{t('admin.members.addTitle')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {addError && <Alert severity="error">{addError}</Alert>}
              <TextField
                label={t('admin.members.fields.email')}
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
                autoFocus
                fullWidth
                inputProps={{ 'aria-required': true }}
              />
              <Select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as Role)}
                fullWidth
                inputProps={{ 'aria-label': t('admin.members.fields.role') }}
              >
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {t(`admin.members.roles.${r}`)}
                  </MenuItem>
                ))}
              </Select>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>
              {t('invitation.cancel')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={addMutation.isPending || !addEmail.trim()}
              startIcon={addMutation.isPending ? <CircularProgress size={16} /> : undefined}
            >
              {t('admin.members.add')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Remove confirm dialog */}
      <Dialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        aria-labelledby="remove-member-title"
        aria-describedby="remove-member-desc"
      >
        <DialogTitle id="remove-member-title">
          {t('admin.members.removeTitle')}
        </DialogTitle>
        <DialogContent>
          {removeError && <Alert severity="error" sx={{ mb: 2 }}>{removeError}</Alert>}
          <DialogContentText id="remove-member-desc">
            {t('admin.members.removeConfirm', { email: removeTarget?.email ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)} disabled={removeMutation.isPending}>
            {t('invitation.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={removeMutation.isPending}
            startIcon={removeMutation.isPending ? <CircularProgress size={16} /> : undefined}
            onClick={() => removeTarget && removeMutation.mutate(removeTarget.userId)}
          >
            {t('admin.members.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
