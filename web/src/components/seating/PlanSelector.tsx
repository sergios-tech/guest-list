import { useState } from 'react';
import {
  Box, Button, Chip, IconButton, MenuItem, Stack, TextField, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSnackbar } from '../../lib/snackbar';
import { apiErrorMessage } from '../../lib/errors';
import type { PlanSummary } from '../../lib/seating';

interface PlanSelectorProps {
  plans: PlanSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDeleted: () => void;
}

export default function PlanSelector({
  plans, selectedId, onSelect, onCreate, onDeleted,
}: PlanSelectorProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = plans.find((p) => p.id === selectedId);

  const activate = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/seating/plans/${id}/activate`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.activated'), 'success');
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/seating/plans/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.planDeleted'), 'success');
      setConfirmDelete(false);
      onDeleted();
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={{ sm: 'center' }}
    >
      <TextField
        select
        size="small"
        label={t('seating.title')}
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        sx={{ minWidth: 220 }}
        disabled={plans.length === 0}
      >
        {plans.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {p.isActive ? (
                <CheckCircleIcon fontSize="small" color="success" />
              ) : null}
              {p.name}
            </Box>
          </MenuItem>
        ))}
      </TextField>

      {selected && !selected.isActive ? (
        <Button
          size="small"
          variant="outlined"
          onClick={() => activate.mutate(selected.id)}
          disabled={activate.isPending}
        >
          {t('seating.activate')}
        </Button>
      ) : null}
      {selected?.isActive ? (
        <Chip
          icon={<CheckCircleIcon />}
          color="success"
          variant="outlined"
          size="small"
          label={t('seating.active')}
        />
      ) : null}

      {selected ? (
        <Tooltip title={t('seating.deletePlan')}>
          <IconButton
            size="small"
            color="error"
            onClick={() => setConfirmDelete(true)}
            aria-label={t('seating.deletePlan')}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      ) : null}

      <Box sx={{ flexGrow: 1 }} />

      <Button startIcon={<AddIcon />} onClick={onCreate}>
        {t('seating.newPlan')}
      </Button>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t('seating.deletePlan')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('seating.deletePlanConfirm')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t('invitation.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => selected && remove.mutate(selected.id)}
            disabled={remove.isPending}
          >
            {t('invitation.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
