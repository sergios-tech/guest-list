import { useMemo, useState } from 'react';
import {
  Box, Button, CircularProgress, Paper, Stack, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useAuth } from '../lib/auth';
import type { PlanSummary } from '../lib/seating';
import type { PrintData } from '../lib/print';
import GuestListReport from '../components/print/GuestListReport';
import AttendeeListReport from '../components/print/AttendeeListReport';
import TableListReport from '../components/print/TableListReport';
import LayoutReport from '../components/print/LayoutReport';

type ReportKind = 'guests' | 'attendees' | 'tables' | 'layout';

export default function Print() {
  const { t } = useTranslation();
  const { currentClientId } = useAuth();
  const [report, setReport] = useState<ReportKind>('guests');

  // Print always targets the client's active plan (decided up front): resolve
  // its id from the plan list, then pull the denormalised print payload.
  const { data: plans = [], isLoading: plansLoading } = useQuery<PlanSummary[]>({
    queryKey: qk.seatingPlans(currentClientId!),
    queryFn: async () => (await api.get('/seating/plans')).data,
    enabled: !!currentClientId,
  });

  const activeId = useMemo(() => plans.find((p) => p.isActive)?.id ?? null, [plans]);

  const { data, isLoading: dataLoading } = useQuery<PrintData>({
    queryKey: activeId
      ? qk.seatingPrint(currentClientId!, activeId)
      : ['seating', 'print', 'none'],
    queryFn: async () => (await api.get(`/seating/plans/${activeId}/print`)).data,
    enabled: !!activeId && !!currentClientId,
  });

  if (plansLoading || (activeId && dataLoading)) {
    return (
      <Stack alignItems="center" sx={{ p: 4 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (!activeId || !data) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">{t('print.noActivePlan')}</Typography>
      </Paper>
    );
  }

  return (
    // .print-area is revealed (everything else blanked) by the @media print
    // rules in index.css; .print-hide drops the toolbar from the paper output.
    <Box className="print-area">
      <Stack
        className="print-hide"
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 2 }}
      >
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t('print.title')}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={report}
          onChange={(_, v: ReportKind | null) => v && setReport(v)}
          aria-label={t('print.title')}
        >
          <ToggleButton value="guests">{t('print.reportGuests')}</ToggleButton>
          <ToggleButton value="attendees">{t('print.reportAttendees')}</ToggleButton>
          <ToggleButton value="tables">{t('print.reportTables')}</ToggleButton>
          <ToggleButton value="layout">{t('print.reportLayout')}</ToggleButton>
        </ToggleButtonGroup>
        <Button
          variant="contained"
          startIcon={<PrintIcon />}
          onClick={() => window.print()}
        >
          {t('print.printButton')}
        </Button>
      </Stack>

      {report === 'guests' && (
        <GuestListReport planName={data.plan.name} guests={data.guests} />
      )}
      {report === 'attendees' && (
        <AttendeeListReport planName={data.plan.name} guests={data.guests} />
      )}
      {report === 'tables' && (
        <TableListReport planName={data.plan.name} tables={data.plan.tables} />
      )}
      {report === 'layout' && <LayoutReport plan={data.plan} />}
    </Box>
  );
}
