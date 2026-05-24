import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Paper, Stack, TextField, MenuItem, Button, Box, Typography,
  IconButton, Divider, Checkbox, FormControlLabel, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useForm, Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDebouncedCallback } from 'use-debounce';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useSnackbar } from '../lib/snackbar';
import { apiErrorMessage } from '../lib/errors';
import { RSVP_STATUSES, ACCOMMODATION_TYPES, type RsvpStatus, type AccommodationType } from '../lib/enums';
import { AccommodationChip, StatusChip } from '../components/Chips';

interface Attendee {
  id: string; fullName: string; isChild: boolean; dietaryNotes?: string | null;
}

interface InvitationForm {
  guestLabel: string;
  plannedCount: number | null;
  status: RsvpStatus | '';
  adults: number | null;
  children: number | null;
  forecast: number | null;
  responseDate: string | null;
  accommodation: AccommodationType;
  declineReason: string | null;
  notes: string | null;
  version: number | null;
}

// Reject NaN / non-integer / out-of-range silently rather than letting the
// pasted value sail through `Number()` and end up as `null` in the payload
// (which would then either trip a DB CHECK or overwrite a valid prior value).
const toIntOrNull = (raw: string): number | null => {
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 12 ? n : null;
};

export default function InvitationDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const snackbar = useSnackbar();
  const isNew = !id;
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const { control, handleSubmit, reset, watch } = useForm<InvitationForm>({
    defaultValues: {
      guestLabel: '', plannedCount: null, status: 'POZVAN',
      adults: null, children: null, forecast: null, responseDate: null,
      accommodation: 'NONE', declineReason: null, notes: null, version: null,
    },
  });
  const status = watch('status');

  const { data: invitation } = useQuery({
    queryKey: id ? qk.invitation(id) : ['invitation', 'new'],
    queryFn: async () => (await api.get(`/invitations/${id}`)).data,
    enabled: !isNew,
  });

  useEffect(() => {
    if (invitation) {
      // Reset only known form fields. The API response includes audit columns
      // (createdBy, createdAt, attendees, …) which the global ValidationPipe
      // rejects when spread into a PATCH body (`forbidNonWhitelisted: true`).
      reset({
        guestLabel: invitation.guestLabel,
        plannedCount: invitation.plannedCount,
        status: invitation.status,
        adults: invitation.adults,
        children: invitation.children,
        forecast: invitation.forecast,
        responseDate: invitation.responseDate,
        accommodation: invitation.accommodation,
        declineReason: invitation.declineReason,
        notes: invitation.notes,
        version: invitation.version ?? 0,
      });
    }
  }, [invitation, reset]);

  const save = useMutation({
    mutationFn: async (data: InvitationForm) => {
      // Explicit whitelist of fields the API actually accepts.
      const isDeclined = data.status === 'ODBIJENO';
      const payload = {
        guestLabel: data.guestLabel,
        plannedCount: data.plannedCount ?? undefined,
        status: data.status || undefined,
        adults: isDeclined ? 0 : (data.adults ?? undefined),
        children: isDeclined ? 0 : (data.children ?? undefined),
        forecast: data.forecast ?? undefined,
        responseDate: data.responseDate ?? undefined,
        accommodation: data.accommodation,
        declineReason: data.declineReason ?? undefined,
        notes: data.notes ?? undefined,
        ...(isNew ? {} : { version: data.version ?? 0 }),
      };
      if (isNew) return (await api.post('/invitations', payload)).data;
      return (await api.patch(`/invitations/${id}`, payload)).data;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (!isNew) qc.invalidateQueries({ queryKey: qk.invitation(id!) });
      snackbar.show(t(isNew ? 'invitation.created' : 'invitation.updated'), 'success');
      if (isNew) nav(`/invitations/${saved.id}`, { replace: true });
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        // Optimistic-concurrency conflict: someone else saved first. Refetch
        // so the user sees the latest values before retrying.
        if (!isNew) qc.invalidateQueries({ queryKey: qk.invitation(id!) });
      }
      snackbar.show(apiErrorMessage(err, t), 'error');
    },
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/invitations/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      snackbar.show(t('invitation.deleted'), 'success');
      nav('/invitations');
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <IconButton onClick={() => nav('/invitations')} aria-label={t('invitation.back')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6">
          {isNew ? t('nav.addInvitation') : (invitation?.guestLabel ?? '…')}
        </Typography>
        {!isNew && invitation?.status && <StatusChip value={invitation.status} />}
        {!isNew && invitation?.accommodation && <AccommodationChip value={invitation.accommodation} />}
        <Box sx={{ flex: 1 }} />
        {!isNew && (
          <Tooltip title={t('invitation.delete')}>
            <IconButton color="error" onClick={() => setConfirmDeleteOpen(true)}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box
          component="form" onSubmit={handleSubmit((d) => save.mutate(d))}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
          }}
        >
          <Controller name="guestLabel" control={control}
            render={({ field }) => (
              <TextField {...field} label={t('invitation.guestLabel')} required
                sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }} />
            )} />
          <Controller name="status" control={control}
            render={({ field }) => (
              <TextField {...field} select label={t('invitation.status')}>
                {RSVP_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{t(`status.${s}`)}</MenuItem>
                ))}
              </TextField>
            )} />
          <Controller name="plannedCount" control={control}
            render={({ field }) => (
              <TextField {...field} type="number" label={t('invitation.plannedCount')}
                inputProps={{ min: 0, max: 12, step: 1 }}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(toIntOrNull(e.target.value))} />
            )} />
          <Controller name="adults" control={control}
            render={({ field }) => (
              <TextField {...field} type="number" label={t('invitation.adults')}
                inputProps={{ min: 0, max: 12, step: 1 }}
                disabled={status === 'ODBIJENO'}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(toIntOrNull(e.target.value))} />
            )} />
          <Controller name="children" control={control}
            render={({ field }) => (
              <TextField {...field} type="number" label={t('invitation.children')}
                inputProps={{ min: 0, max: 12, step: 1 }}
                disabled={status === 'ODBIJENO'}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(toIntOrNull(e.target.value))} />
            )} />
          <Controller name="forecast" control={control}
            render={({ field }) => (
              <TextField {...field} type="number" label={t('invitation.forecast')}
                inputProps={{ min: 0, max: 12, step: 1 }}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(toIntOrNull(e.target.value))} />
            )} />
          <Controller name="responseDate" control={control}
            render={({ field }) => (
              <TextField {...field} type="date" label={t('invitation.responseDate')}
                InputLabelProps={{ shrink: true }}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value || null)} />
            )} />
          <Controller name="accommodation" control={control}
            render={({ field }) => (
              <TextField {...field} select label={t('invitation.accommodation')}>
                {ACCOMMODATION_TYPES.map((a) => (
                  <MenuItem key={a} value={a}>{t(`accommodation.${a}`)}</MenuItem>
                ))}
              </TextField>
            )} />
          {status === 'ODBIJENO' && (
            <Controller name="declineReason" control={control}
              render={({ field }) => (
                <TextField {...field}
                  label={t('invitation.declineReason')} multiline minRows={2}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || null)}
                  sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }} />
              )} />
          )}
          <Controller name="notes" control={control}
            render={({ field }) => (
              <TextField {...field} label={t('invitation.notes')} multiline minRows={2}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value || null)}
                sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }} />
            )} />

          <Box sx={{ gridColumn: { xs: '1', sm: '1 / -1' }, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={() => nav('/invitations')}>
              {t('invitation.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('invitation.save')}
            </Button>
          </Box>
        </Box>
      </Paper>

      <Dialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
      >
        <DialogTitle>{t('invitation.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('invitation.deleteConfirm', { label: invitation?.guestLabel ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)}>
            {t('invitation.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setConfirmDeleteOpen(false);
              remove.mutate();
            }}
            disabled={remove.isPending}
          >
            {t('invitation.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {!isNew && <AttendeeList invitationId={id!} />}
    </Stack>
  );
}

function AttendeeList({ invitationId }: { invitationId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const snackbar = useSnackbar();
  const [draft, setDraft] = useState<{ fullName: string; isChild: boolean }>({
    fullName: '', isChild: false,
  });

  const { data: attendees = [] } = useQuery<Attendee[]>({
    queryKey: qk.attendees(invitationId),
    queryFn: async () =>
      (await api.get(`/attendees/by-invitation/${invitationId}`)).data,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: qk.attendees(invitationId) });

  const add = useMutation({
    mutationFn: async () =>
      (await api.post('/attendees', { invitationId, ...draft })).data,
    onSuccess: () => { setDraft({ fullName: '', isChild: false }); refresh(); },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });
  const update = useMutation({
    mutationFn: async (a: Attendee) =>
      (await api.patch(`/attendees/${a.id}`, {
        fullName: a.fullName, isChild: a.isChild, dietaryNotes: a.dietaryNotes,
      })).data,
    onSuccess: refresh,
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });
  const del = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/attendees/${id}`)).data,
    onSuccess: refresh,
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {t('invitation.attendees')}
      </Typography>
      <Stack spacing={1.5} divider={<Divider />}>
        {attendees.map((a) => (
          <AttendeeRow
            key={a.id}
            attendee={a}
            onUpdate={(next) => update.mutate(next)}
            onDelete={() => del.mutate(a.id)}
          />
        ))}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <TextField
            placeholder={t('invitation.fullName')}
            value={draft.fullName}
            onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
            sx={{ flex: 1 }}
          />
          <FormControlLabel
            control={<Checkbox checked={draft.isChild}
              onChange={(e) => setDraft({ ...draft, isChild: e.target.checked })} />}
            label={t('invitation.isChild')}
          />
          <Button
            startIcon={<AddIcon />}
            onClick={() => draft.fullName.trim() && add.mutate()}
            disabled={!draft.fullName.trim() || add.isPending}
          >
            {t('invitation.addAttendee')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

interface AttendeeRowProps {
  attendee: Attendee;
  onUpdate: (next: Attendee) => void;
  onDelete: () => void;
}

function AttendeeRow({ attendee, onUpdate, onDelete }: AttendeeRowProps) {
  const { t } = useTranslation();
  // Local state isolates each keystroke from network IO; the debounced
  // callback fires one PATCH after typing settles (previously every
  // keystroke fired a request — ~12 PATCHes to type "Alice Edited").
  const [fullName, setFullName] = useState(attendee.fullName);

  useEffect(() => {
    setFullName(attendee.fullName);
  }, [attendee.fullName]);

  const debouncedUpdate = useDebouncedCallback((value: string) => {
    if (value === attendee.fullName) return;
    onUpdate({ ...attendee, fullName: value });
  }, 500);

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1} alignItems={{ sm: 'center' }}
    >
      <TextField
        value={fullName}
        onChange={(e) => {
          setFullName(e.target.value);
          debouncedUpdate(e.target.value);
        }}
        onBlur={() => {
          debouncedUpdate.flush();
        }}
        sx={{ flex: 1 }}
      />
      <FormControlLabel
        control={<Checkbox checked={attendee.isChild}
          onChange={(e) => onUpdate({ ...attendee, isChild: e.target.checked })} />}
        label={t('invitation.isChild')}
      />
      <IconButton color="error" onClick={onDelete} aria-label="delete">
        <DeleteIcon />
      </IconButton>
    </Stack>
  );
}
