import { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, FormControlLabel, Checkbox,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSnackbar } from '../../lib/snackbar';
import { apiErrorMessage } from '../../lib/errors';

interface AutoFillButtonProps {
  planId: string;
  hasSeated: boolean;
}

export default function AutoFillButton({ planId, hasSeated }: AutoFillButtonProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clearExisting, setClearExisting] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => (await api.post(
      `/seating/plans/${planId}/auto-fill`,
      { clearExisting },
    )).data as { assignedCount: number; unseated: Array<{ invitationId: string; count: number }> },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.autoFillDone', { count: data.assignedCount }), 'success');
      const stillUnseated = data.unseated.reduce((s, u) => s + u.count, 0);
      if (stillUnseated > 0) {
        snackbar.show(
          t('seating.autoFillSomeUnseated', { count: stillUnseated }),
          'warning',
        );
      }
      setOpen(false);
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  return (
    <>
      <Button
        startIcon={<AutoFixHighIcon />}
        variant="contained"
        onClick={() => setOpen(true)}
      >
        {t('seating.autoFill')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{t('seating.autoFillConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            {t('seating.autoFillConfirm')}
          </DialogContentText>
          <FormControlLabel
            control={
              <Checkbox
                checked={clearExisting}
                onChange={(e) => setClearExisting(e.target.checked)}
                disabled={!hasSeated}
              />
            }
            label={t('seating.clearExisting')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>
            {t('invitation.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('seating.autoFillRunning') : t('seating.autoFill')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
