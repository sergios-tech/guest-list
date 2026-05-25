import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { SeatView, TableView } from '../../lib/seating';

// Layout constants. Container is sized to fit the seat orbit PLUS the name
// label that hangs below each seat — overflow:visible lets the name extend
// outside if needed without resizing the box.
const CONTAINER = 260;
const CENTER = CONTAINER / 2;
const TABLE_R = 52;
const ORBIT_R = 92;
const SEAT_R = 16;        // seat circle radius
const NAME_W = 96;        // width of the name label box

interface SeatPosition {
  cx: number;
  cy: number;
}

// Pre-compute polar coordinates for N seats evenly spaced around the table.
// Angle starts at the top (12 o'clock) and goes clockwise so the order on
// screen matches the way humans count chairs around a table.
function seatPositions(n: number): SeatPosition[] {
  const out: SeatPosition[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({
      cx: CENTER + ORBIT_R * Math.cos(a),
      cy: CENTER + ORBIT_R * Math.sin(a),
    });
  }
  return out;
}

interface SeatProps {
  seat: SeatView;
  cx: number;
  cy: number;
}

function Seat({ seat, cx, cy }: SeatProps) {
  const { t } = useTranslation();
  const occupied = !!(seat.attendeeId || seat.invitationId);
  const displayName =
    seat.attendeeName
    ?? (seat.invitationLabel && seat.slotIndex != null
      ? `${t('seating.guestSlot', { index: seat.slotIndex })} · ${seat.invitationLabel}`
      : null);

  const dropId = `seat:${seat.id}` as const;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropId });

  // Only occupied seats are draggable — empty seats can only receive drops.
  const dragId = `seat:${seat.id}` as const;
  const drag = useDraggable({ id: dragId, disabled: !occupied });

  const setBothRefs = (el: HTMLDivElement | null) => {
    setDropRef(el);
    drag.setNodeRef(el);
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        // Translate so (cx, cy) is the *center* of the seat circle, with the
        // name label box hanging below it.
        left: cx - NAME_W / 2,
        top: cy - SEAT_R,
        width: NAME_W,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'auto',
      }}
    >
      <Box
        ref={setBothRefs}
        {...(occupied ? drag.attributes : {})}
        {...(occupied ? drag.listeners : {})}
        role={occupied ? 'button' : undefined}
        aria-label={
          occupied
            ? `${t('seating.seatNumberLabel', { number: seat.seatNumber })} — ${displayName ?? ''}`
            : `${t('seating.seatNumberLabel', { number: seat.seatNumber })} ${t('seating.emptySeat')}`
        }
        sx={(theme) => ({
          width: SEAT_R * 2,
          height: SEAT_R * 2,
          borderRadius: '50%',
          border: '2px',
          borderStyle: occupied ? 'solid' : 'dashed',
          borderColor: isOver
            ? theme.palette.primary.main
            : occupied
              ? theme.palette.primary.main
              : theme.palette.divider,
          backgroundColor: isOver
            ? theme.palette.primary.light
            : occupied
              ? theme.palette.primary.main
              : 'transparent',
          color: occupied
            ? theme.palette.primary.contrastText
            : theme.palette.text.disabled,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          cursor: occupied ? 'grab' : 'default',
          opacity: drag.isDragging ? 0.3 : 1,
          transition: 'background-color 80ms, border-color 80ms',
          userSelect: 'none',
        })}
      >
        {seat.seatNumber}
      </Box>
      {displayName ? (
        <Tooltip title={displayName} enterDelay={400}>
          <Typography
            variant="caption"
            sx={{
              mt: 0.5,
              maxWidth: NAME_W,
              textAlign: 'center',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayName}
          </Typography>
        </Tooltip>
      ) : null}
    </Box>
  );
}

interface TableCircleProps {
  table: TableView;
  totalTables: number;
  onEdit: (table: TableView) => void;
}

export default function TableCircle({ table, totalTables, onEdit }: TableCircleProps) {
  const { t } = useTranslation();
  const positions = seatPositions(table.seatCount);

  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        width: CONTAINER,
        height: CONTAINER + 24, // slack for name labels at the bottom seat
        overflow: 'visible',
        p: 1,
      }}
    >
      {/* Edit button — top-right corner, separate from any seat */}
      <IconButton
        size="small"
        onClick={() => onEdit(table)}
        aria-label={t('seating.editTable')}
        sx={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}
      >
        <EditIcon fontSize="small" />
      </IconButton>

      {/* The table itself */}
      <Box
        sx={(theme) => ({
          position: 'absolute',
          left: CENTER - TABLE_R,
          top: CENTER - TABLE_R,
          width: TABLE_R * 2,
          height: TABLE_R * 2,
          borderRadius: '50%',
          backgroundColor: theme.palette.background.default,
          border: `2px solid ${theme.palette.divider}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: theme.shadows[1],
        })}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1 }}>
            {table.tableNumber}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1 }}>
            {t('seating.ofTotal', { total: totalTables })}
          </Typography>
        </Box>
        {table.label ? (
          <Typography variant="caption" sx={{ mt: 0.25, color: 'text.secondary' }}>
            {table.label}
          </Typography>
        ) : null}
      </Box>

      {table.seats.map((seat, i) => {
        const pos = positions[i] ?? positions[0];
        return <Seat key={seat.id} seat={seat} cx={pos.cx} cy={pos.cy} />;
      })}
    </Paper>
  );
}
