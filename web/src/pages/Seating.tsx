import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Grid, Paper, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useAuth } from '../lib/auth';
import { useSnackbar } from '../lib/snackbar';
import { apiErrorMessage } from '../lib/errors';
import type {
  PlanDetail, PlanSummary, SeatView, TableView, UnseatedUnit,
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
  const { currentClientId } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfigDialogMode>(null);
  const [activeDrag, setActiveDrag] = useState<{ id: string; label: string } | null>(null);
  // Invitation ids pinned to the top of the unseated sidebar, most recent
  // first. Resets when the plan changes since pins are plan-specific intent.
  const [pinned, setPinned] = useState<string[]>([]);
  const [confirmUnseatAll, setConfirmUnseatAll] = useState(false);

  // Cap so a long session of clicking guest names doesn't grow the list
  // unboundedly — the recent-pins pattern only stays useful when bounded.
  const MAX_PINNED = 10;

  function hoistHousehold(invitationId: string) {
    setPinned((prev) =>
      [invitationId, ...prev.filter((x) => x !== invitationId)].slice(0, MAX_PINNED),
    );
  }

  // Slight activation distance prevents accidental drags when the user just
  // means to tap a chip — important on touch screens.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const { data: plans = [], isLoading: plansLoading } = useQuery<PlanSummary[]>({
    queryKey: qk.seatingPlans(currentClientId!),
    queryFn: async () => (await api.get('/seating/plans')).data,
    enabled: !!currentClientId,
  });

  const { data: plan, isLoading: planLoading } = useQuery<PlanDetail>({
    queryKey: selectedId ? qk.seatingPlan(currentClientId!, selectedId) : ['seating', 'plan', 'none'],
    queryFn: async () => (await api.get(`/seating/plans/${selectedId}`)).data,
    enabled: !!selectedId && !!currentClientId,
  });

  const { data: unseated = [] } = useQuery<UnseatedUnit[]>({
    queryKey: selectedId ? qk.seatingUnseated(currentClientId!, selectedId) : ['seating', 'unseated', 'none'],
    queryFn: async () => (await api.get(`/seating/plans/${selectedId}/unseated`)).data,
    enabled: !!selectedId && !!currentClientId,
  });

  // When the plan list arrives (or changes), keep the selection sensible:
  // prefer the currently-active plan, fall back to the first.
  useEffect(() => {
    if (plansLoading) return;
    if (selectedId && plans.some((p) => p.id === selectedId)) return;
    const active = plans.find((p) => p.isActive);
    setSelectedId((active ?? plans[0])?.id ?? null);
  }, [plans, plansLoading, selectedId]);

  // Pins are plan-specific — wipe them when the user switches plan.
  useEffect(() => {
    setPinned([]);
  }, [selectedId]);

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

  const unseatAll = useMutation<{ clearedCount: number }>({
    mutationFn: async () => {
      if (!plan) return { clearedCount: 0 };
      return (await api.post(`/seating/plans/${plan.id}/unseat-all`, {})).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.unseatAllDone', { count: data.clearedCount }), 'success');
      setConfirmUnseatAll(false);
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });

  // A single per-seat mutation is in flight only briefly, but bulk unseatAll
  // racing with an in-flight assign can silently re-occupy a seat. Compute a
  // single "is any seat-level mutation in flight" flag so we can block the
  // dangerous combinations: unseatAll is disabled when seats are moving, and
  // new assignments/clears are dropped while unseatAll is running.
  const isSeatMutating = assign.isPending || swap.isPending || clearSeat.isPending;
  const isUnseatingAll = unseatAll.isPending;

  const addTable = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      // Default the new table's seat count to whatever's most common in the
      // plan — keeps the layout uniform when the user just wants "one more
      // like the others". Falls back to 8 if the plan has no tables yet.
      const counts = new Map<number, number>();
      for (const tbl of plan.tables) {
        counts.set(tbl.seatCount, (counts.get(tbl.seatCount) ?? 0) + 1);
      }
      let mode = 8;
      let best = 0;
      for (const [c, n] of counts) {
        if (n > best) { best = n; mode = c; }
      }
      await api.post(`/seating/plans/${plan.id}/tables`, { seatCount: mode });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seating'] });
      snackbar.show(t('seating.tableAdded'), 'success');
    },
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
        if (s.attendeeName) {
          // Mirror the seat's two-line display: append the family/guest label
          // unless it would merely echo the attendee's own name.
          return s.invitationLabel && s.invitationLabel !== s.attendeeName
            ? `${s.attendeeName} · ${s.invitationLabel}`
            : s.attendeeName;
        }
        return s.invitationLabel && s.slotIndex != null
          ? `${t('seating.guestSlot', { index: s.slotIndex })} · ${s.invitationLabel}`
          : '…';
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
    // unseatAll is in flight: ignore the drop so we don't race a bulk clear
    // with a single assignment that would silently survive.
    if (isUnseatingAll) return;
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

  // Click-to-unseat with an Undo snackbar. The snapshot is captured at click
  // time because by the time the user clicks Undo, the seat's row has been
  // refetched and the attendee/slot fields are null.
  function handleClickUnseat(seatId: string) {
    if (!plan || isUnseatingAll) return;
    let prev: SeatView | undefined;
    for (const tbl of plan.tables) {
      prev = tbl.seats.find((s) => s.id === seatId);
      if (prev) break;
    }
    if (!prev || !(prev.attendeeId || prev.invitationId)) return;
    const snapshot = {
      attendeeId: prev.attendeeId,
      invitationId: prev.invitationId,
      slotIndex: prev.slotIndex,
    };
    clearSeat.mutate(seatId, {
      onSuccess: () => {
        snackbar.show(t('seating.seatCleared'), 'success', {
          action: {
            label: t('seating.undo'),
            onClick: () => {
              if (snapshot.attendeeId) {
                assign.mutate({
                  seatId,
                  body: { attendeeId: snapshot.attendeeId },
                });
              } else if (snapshot.invitationId && snapshot.slotIndex != null) {
                assign.mutate({
                  seatId,
                  body: {
                    invitationId: snapshot.invitationId,
                    slotIndex: snapshot.slotIndex,
                  },
                });
              }
            },
          },
        });
      },
    });
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
              {/* key={selectedId} so switching plans remounts the sidebar and
                  drops its local search query — pins are wiped above for the
                  same reason. */}
              <AttendeeSidebar
                key={selectedId}
                unseated={unseated}
                pinned={pinned}
                onHoist={hoistHousehold}
              />
            </Grid>
            <Grid item xs={12} md={9} lg={9.5}>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6" sx={{ flexGrow: 1 }}>
                    {plan.name}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${plan.tables.length} × ${plan.tables[0]?.seatCount ?? 0}`}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addTable.mutate()}
                    disabled={addTable.isPending}
                  >
                    {t('seating.addTable')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<EventSeatIcon />}
                    onClick={() => setConfirmUnseatAll(true)}
                    disabled={!hasSeated || isUnseatingAll || isSeatMutating}
                  >
                    {t('seating.unseatAll')}
                  </Button>
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
                      onHoist={hoistHousehold}
                      onUnseat={handleClickUnseat}
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

      <Dialog open={confirmUnseatAll} onClose={() => setConfirmUnseatAll(false)}>
        <DialogTitle>{t('seating.unseatAllConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('seating.unseatAllConfirm')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmUnseatAll(false)}>{t('invitation.cancel')}</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => unseatAll.mutate()}
            disabled={unseatAll.isPending}
          >
            {t('seating.unseatAll')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
