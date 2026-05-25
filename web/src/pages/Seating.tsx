import { useEffect, useMemo, useState } from 'react';
import {
  Box, Chip, CircularProgress, Grid, Paper, Stack, Typography,
} from '@mui/material';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useSnackbar } from '../lib/snackbar';
import { apiErrorMessage } from '../lib/errors';
import type {
  PlanDetail, PlanSummary, TableView, UnseatedUnit,
} from '../lib/seating';
import PlanSelector from '../components/seating/PlanSelector';
import ConfigDialog from '../components/seating/ConfigDialog';
import AttendeeSidebar from '../components/seating/AttendeeSidebar';
import TableCircle from '../components/seating/TableCircle';
import AutoFillButton from '../components/seating/AutoFillButton';

type ConfigDialogMode =
  | null
  | { kind: 'create' }
  | { kind: 'editTable'; table: TableView; planId: string };

// Decode a drag source id (`attendee:<id>`, `slot:<inv>:<idx>`, `seat:<id>`)
// into a structured shape used by both the drag-end handler and the overlay.
type DragSource =
  | { kind: 'attendee'; attendeeId: string }
  | { kind: 'slot'; invitationId: string; slotIndex: number }
  | { kind: 'seat'; seatId: string };

function decodeSource(raw: string): DragSource | null {
  if (raw.startsWith('attendee:')) {
    return { kind: 'attendee', attendeeId: raw.slice('attendee:'.length) };
  }
  if (raw.startsWith('seat:')) {
    return { kind: 'seat', seatId: raw.slice('seat:'.length) };
  }
  if (raw.startsWith('slot:')) {
    const [, invId, idxStr] = raw.split(':');
    const idx = Number(idxStr);
    if (invId && Number.isInteger(idx)) {
      return { kind: 'slot', invitationId: invId, slotIndex: idx };
    }
  }
  return null;
}

export default function Seating() {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfigDialogMode>(null);
  const [activeDrag, setActiveDrag] = useState<{ id: string; label: string } | null>(null);

  // Slight activation distance prevents accidental drags when the user just
  // means to tap a chip — important on touch screens.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const { data: plans = [], isLoading: plansLoading } = useQuery<PlanSummary[]>({
    queryKey: qk.seatingPlans(),
    queryFn: async () => (await api.get('/seating/plans')).data,
  });

  const { data: plan, isLoading: planLoading } = useQuery<PlanDetail>({
    queryKey: selectedId ? qk.seatingPlan(selectedId) : ['seating', 'plan', 'none'],
    queryFn: async () => (await api.get(`/seating/plans/${selectedId}`)).data,
    enabled: !!selectedId,
  });

  const { data: unseated = [] } = useQuery<UnseatedUnit[]>({
    queryKey: selectedId ? qk.seatingUnseated(selectedId) : ['seating', 'unseated', 'none'],
    queryFn: async () => (await api.get(`/seating/plans/${selectedId}/unseated`)).data,
    enabled: !!selectedId,
  });

  // When the plan list arrives (or changes), keep the selection sensible:
  // prefer the currently-active plan, fall back to the first.
  useEffect(() => {
    if (plansLoading) return;
    if (selectedId && plans.some((p) => p.id === selectedId)) return;
    const active = plans.find((p) => p.isActive);
    setSelectedId((active ?? plans[0])?.id ?? null);
  }, [plans, plansLoading, selectedId]);

  // ------------- mutations -------------

  const assign = useMutation({
    mutationFn: async (
      v: { seatId: string; body: { attendeeId?: string; invitationId?: string; slotIndex?: number } },
    ) => (await api.post(`/seating/seats/${v.seatId}/assign`, v.body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seating'] }),
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  const clearSeat = useMutation({
    mutationFn: async (seatId: string) =>
      (await api.delete(`/seating/seats/${seatId}/assignment`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seating'] }),
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  const swap = useMutation({
    mutationFn: async (v: { seatAId: string; seatBId: string }) =>
      (await api.post('/seating/seats/swap', v)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seating'] }),
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  // ------------- drag handlers -------------

  // Resolve the label shown in the DragOverlay so the user sees what they're
  // dragging. For seats, look it up in the plan; for unseated, look it up in
  // the unseated list.
  function resolveDragLabel(src: DragSource): string {
    if (src.kind === 'attendee') {
      const u = unseated.find((x) => x.kind === 'attendee' && x.attendeeId === src.attendeeId);
      return u && u.kind === 'attendee' ? u.attendeeName : '…';
    }
    if (src.kind === 'slot') {
      const inv = unseated.find(
        (x) => x.kind === 'slot' && x.invitationId === src.invitationId && x.slotIndex === src.slotIndex,
      );
      const label = inv?.invitationLabel ?? '';
      return `${t('seating.guestSlot', { index: src.slotIndex })} · ${label}`;
    }
    // seat
    if (!plan) return '…';
    for (const tbl of plan.tables) {
      const s = tbl.seats.find((x) => x.id === src.seatId);
      if (s) {
        return s.attendeeName
          ?? (s.invitationLabel && s.slotIndex != null
            ? `${t('seating.guestSlot', { index: s.slotIndex })} · ${s.invitationLabel}`
            : '…');
      }
    }
    return '…';
  }

  function onDragStart(e: DragStartEvent) {
    const src = decodeSource(String(e.active.id));
    if (!src) return;
    setActiveDrag({ id: String(e.active.id), label: resolveDragLabel(src) });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    if (!e.over) return;
    const activeIdRaw = String(e.active.id);
    const overIdRaw = String(e.over.id);
    if (activeIdRaw === overIdRaw) return;

    const src = decodeSource(activeIdRaw);
    if (!src) return;

    if (overIdRaw === 'sidebar') {
      // Drop on sidebar: clear the seat if dragging from a seat. Unseated
      // chips dropped back onto the sidebar are a no-op.
      if (src.kind === 'seat') {
        clearSeat.mutate(src.seatId);
      }
      return;
    }

    if (overIdRaw.startsWith('seat:')) {
      const targetSeatId = overIdRaw.slice('seat:'.length);
      if (src.kind === 'seat') {
        // Seat→seat: always use swap. Swap handles empty targets by moving the
        // assignment, and occupied targets by exchanging them.
        swap.mutate({ seatAId: src.seatId, seatBId: targetSeatId });
        return;
      }
      // Sidebar→seat: assign. Overwrites existing assignment (displaced unit
      // re-appears in the sidebar after the unseated query refetches).
      if (src.kind === 'attendee') {
        assign.mutate({ seatId: targetSeatId, body: { attendeeId: src.attendeeId } });
      } else {
        assign.mutate({
          seatId: targetSeatId,
          body: { invitationId: src.invitationId, slotIndex: src.slotIndex },
        });
      }
    }
  }

  // ------------- derived view state -------------

  const hasSeated = useMemo(() => {
    if (!plan) return false;
    return plan.tables.some((t) => t.seats.some((s) => s.attendeeId || s.invitationId));
  }, [plan]);

  // ------------- render -------------

  if (plansLoading) {
    return (
      <Stack alignItems="center" sx={{ p: 4 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <PlanSelector
        plans={plans}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={() => setDialog({ kind: 'create' })}
        onDeleted={() => setSelectedId(null)}
      />

      {plans.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('seating.noPlans')}</Typography>
        </Paper>
      ) : !plan || planLoading ? (
        <Stack alignItems="center" sx={{ p: 4 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
            <Grid item xs={12} md={3} lg={2.5}>
              <AttendeeSidebar unseated={unseated} />
            </Grid>
            <Grid item xs={12} md={9} lg={9.5}>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h6" sx={{ flexGrow: 1 }}>
                    {plan.name}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${plan.tables.length} × ${plan.tables[0]?.seatCount ?? 0}`}
                  />
                  <AutoFillButton planId={plan.id} hasSeated={hasSeated} />
                </Stack>
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 3,
                    alignContent: 'flex-start',
                  }}
                >
                  {plan.tables.map((table) => (
                    <TableCircle
                      key={table.id}
                      table={table}
                      totalTables={plan.tables.length}
                      onEdit={(t) => setDialog({ kind: 'editTable', table: t, planId: plan.id })}
                    />
                  ))}
                </Box>
              </Stack>
            </Grid>
          </Grid>

          <DragOverlay>
            {activeDrag ? (
              <Chip
                label={activeDrag.label}
                color="primary"
                sx={{ cursor: 'grabbing', boxShadow: 4 }}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <ConfigDialog
        open={dialog != null}
        mode={dialog}
        onClose={() => setDialog(null)}
        onPlanCreated={(p) => setSelectedId(p.id)}
      />
    </Stack>
  );
}
