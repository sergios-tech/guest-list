import { useEffect, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSnackbar } from '../../lib/snackbar';
import { apiErrorMessage } from '../../lib/errors';
import type { PlanDetail, TableView } from '../../lib/seating';

// One dialog component, two modes — `mode` switches between "create a brand
// new plan" and "edit a single table". Keeping them together avoids two
// near-identical dialog files.
type Mode =
  | { kind: 'create' }
  | { kind: 'editTable'; table: TableView; planId: string };

interface ConfigDialogProps {
  open: boolean;
  mode: Mode | null;
  onClose: () => void;
  onPlanCreated?: (plan: PlanDetail) => void;
}

export default function ConfigDialog({ open, mode, onClose, onPlanCreated }: ConfigDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const snackbar = useSnackbar();

  const [name, setName] = useState('');
  const [tableCount, setTableCount] = useState(12);
  const [seatsPerTable, setSeatsPerTable] = useState(8);
  const [label, setLabel] = useState('');
  const [seatCount, setSeatCount] = useState(8);

  useEffect(() => {
    if (!open || !mode) return;
    if (mode.kind === 'create') {
      setName('');
      setTableCount(12);
      setSeatsPerTable(8);
    } else {
      setLabel(mode.table.label ?? '');
      setSeatCount(mode.table.seatCount);
    }
  }, [open, mode]);

  const createPlan = useMutation({
    mutationFn: async () => (await api.post('/seating/plans', {
      name: name.trim(),
      tableCount,
      seatsPerTable,
    })).data as PlanDetail,
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.planCreated'), 'success');
      onPlanCreated?.(plan);
      onClose();
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  const updateTable = useMutation({
    mutationFn: async () => {
      if (!mode || mode.kind !== 'editTable') return;
      await api.patch(`/seating/tables/${mode.table.id}`, {
        label: label.trim() || undefined,
        seatCount,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.tableUpdated'), 'success');
      onClose();
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  if (!mode) return null;

  if (mode.kind === 'create') {
    const valid = name.trim().length > 0
      && tableCount >= 1 && tableCount <= 50
      && seatsPerTable >= 1 && seatsPerTable <= 30;
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>{t('seating.createPlan')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('seating.planName')}
              placeholder={t('seating.planNamePh')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              label={t('seating.tableCount')}
              type="number"
              value={tableCount}
              onChange={(e) => setTableCount(Math.max(1, Math.min(50, Number(e.target.value) || 0)))}
              inputProps={{ min: 1, max: 50 }}
              fullWidth
            />
            <TextField
              label={t('seating.seatsPerTable')}
              type="number"
              value={seatsPerTable}
              onChange={(e) => setSeatsPerTable(Math.max(1, Math.min(30, Number(e.target.value) || 0)))}
              inputProps={{ min: 1, max: 30 }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('invitation.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => createPlan.mutate()}
            disabled={!valid || createPlan.isPending}
          >
            {t('seating.createPlan')}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // editTable mode
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t('seating.editTable')} — {t('seating.tableNumberLabel', { number: mode.table.tableNumber })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('seating.tableLabel')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            fullWidth
          />
          <TextField
            label={t('seating.seatCount')}
            type="number"
            value={seatCount}
            onChange={(e) => setSeatCount(Math.max(1, Math.min(30, Number(e.target.value) || 0)))}
            inputProps={{ min: 1, max: 30 }}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('invitation.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => updateTable.mutate()}
          disabled={updateTable.isPending}
        >
          {t('invitation.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
