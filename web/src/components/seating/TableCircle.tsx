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

// Rectangle (head-table) geometry. Seats line the top and bottom long edges;
// the short ends stay empty. Unlike the circle — whose seats spread over a full
// 360° orbit — a straight row gives each seat far less room, so the horizontal
// span (and the table block, and the Paper container) GROW with the seats-per-
// row to guarantee a minimum spacing. A 12-seat banquet table therefore renders
// wider than a 6-seat one, which is also how a real room is laid out.
const RECT_H = 80;           // table-block height (rows always fit the 2 long edges)
const RECT_ROW_OFFSET = 68;  // vertical distance from center to each seat row
const SEAT_PITCH = 46;       // min center-to-center spacing along a row (> seat ø of 32)
const RECT_MIN_W = 140;      // table-block width floor so small tables still read as a table

// Shared single-line truncation for the seat's name labels: clamp to the label
// width and ellipsize overflow. Both the attendee name and the family sub-label
// build on this so the truncation behaviour can't drift between them.
const truncatedLabelSx = {
  maxWidth: NAME_W,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

interface SeatPosition {
  cx: number;
  cy: number;
}

// Pre-compute polar coordinates for N seats evenly spaced around the table.
// Angle starts at the top (12 o'clock) and goes clockwise so the order on
// screen matches the way humans count chairs around a table.
function seatPositions(n: number, cx: number, cy: number): SeatPosition[] {
  const out: SeatPosition[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({
      cx: cx + ORBIT_R * Math.cos(a),
      cy: cy + ORBIT_R * Math.sin(a),
    });
  }
  return out;
}

// Head-table layout for rectangular tables: split the seats across the top and
// bottom long edges, leaving the short ends empty. Odd counts give the extra
// seat to the TOP row (top = ceil(n/2), bottom = floor(n/2)), so seat numbers
// fill 1..top left-to-right along the top, then top+1..n left-to-right below —
// matching the order chairs are counted at a real head table.
function rectSeatPositions(
  n: number, cx: number, cy: number, halfW: number,
): SeatPosition[] {
  const top = Math.ceil(n / 2);
  const rows = [
    { count: top, cy: cy - RECT_ROW_OFFSET },
    { count: n - top, cy: cy + RECT_ROW_OFFSET },
  ];
  const out: SeatPosition[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      // Spread evenly across the edge; a lone seat sits centered.
      const frac = row.count === 1 ? 0.5 : i / (row.count - 1);
      out.push({ cx: cx - halfW + frac * (halfW * 2), cy: row.cy });
    }
  }
  return out;
}

interface SeatProps {
  seat: SeatView;
  cx: number;
  cy: number;
  onHoist?: (invitationId: string) => void;
  onUnseat?: (seatId: string) => void;
}

function Seat({ seat, cx, cy, onHoist, onUnseat }: SeatProps) {
  const { t } = useTranslation();
  const occupied = !!(seat.attendeeId || seat.invitationId);
  const displayName =
    seat.attendeeName
    ?? (seat.invitationLabel && seat.slotIndex != null
      ? `${t('seating.guestSlot', { index: seat.slotIndex })} · ${seat.invitationLabel}`
      : null);

  // The small grey family/guest label shown beneath the attendee name.
  // Shown only for named attendees, and suppressed when it would merely
  // echo the name above (single-person invitations where attendee == family).
  const familyLabel: string | null =
    seat.attendeeName && seat.invitationLabel && seat.invitationLabel !== seat.attendeeName
      ? seat.invitationLabel
      : null;

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
      <Tooltip
        title={occupied && onUnseat ? t('seating.clickToUnseat') : ''}
        enterDelay={400}
        disableHoverListener={!occupied || !onUnseat}
      >
        <Box
          ref={setBothRefs}
          {...(occupied ? drag.attributes : {})}
          {...(occupied ? drag.listeners : {})}
          onClick={(e) => {
            // PointerSensor's 4px activation distance means a clean click
            // without dragging fires this handler instead of starting a drag.
            e.stopPropagation();
            if (occupied && onUnseat) onUnseat(seat.id);
          }}
          role={occupied ? 'button' : undefined}
          aria-label={
            occupied
              ? `${t('seating.seatNumberLabel', { number: seat.seatNumber })} — ${displayName ?? ''}${familyLabel ? `, ${familyLabel}` : ''}`
              : `${t('seating.seatNumberLabel', { number: seat.seatNumber })} ${t('seating.emptySeat')}`
          }
          sx={(theme) => ({
          // Circles sit on the low layer; name labels (z 5) always paint above
          // them, including over adjacent seats' circles at high density.
          position: 'relative',
          zIndex: 1,
          width: SEAT_R * 2,
          height: SEAT_R * 2,
          borderRadius: '50%',
          border: '2px',
          borderStyle: occupied ? 'solid' : 'dashed',
          borderColor: isOver
            ? theme.palette.primary.main
            : occupied
              ? 'rgb(0, 255, 0)'
              : theme.palette.divider,
          backgroundColor: isOver
            ? theme.palette.primary.light
            : occupied
              ? 'rgb(128, 255, 128)'
              : 'transparent',
          color: occupied
            ? theme.palette.common.white
            : theme.palette.text.disabled,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          cursor: occupied ? (onUnseat ? 'pointer' : 'grab') : 'default',
          opacity: drag.isDragging ? 0.3 : 1,
          transition: 'background-color 80ms, border-color 80ms',
          userSelect: 'none',
        })}
        >
          {seat.seatNumber}
        </Box>
      </Tooltip>
      {displayName ? (
        <Tooltip
          title={onHoist && seat.householdInvitationId
            ? `${displayName} — ${t('seating.pinHousehold')}`
            : displayName}
          enterDelay={400}
        >
          <Typography
            variant="caption"
            onClick={(e) => {
              // Stop propagation so the click doesn't bubble to the drag
              // handler on the seat circle above.
              e.stopPropagation();
              if (onHoist && seat.householdInvitationId) {
                onHoist(seat.householdInvitationId);
              }
            }}
            sx={{
              ...truncatedLabelSx,
              position: 'relative',
              zIndex: 5,
              mt: 0.5,
              fontWeight: 500,
              cursor: onHoist && seat.householdInvitationId ? 'pointer' : 'default',
              '&:hover': onHoist && seat.householdInvitationId ? {
                textDecoration: 'underline',
              } : undefined,
            }}
          >
            {displayName}
          </Typography>
        </Tooltip>
      ) : null}
      {familyLabel ? (
        <Tooltip title={familyLabel} enterDelay={400}>
          <Typography
            variant="caption"
            sx={{
              ...truncatedLabelSx,
              position: 'relative',
              zIndex: 5,
              fontSize: 6,
              lineHeight: 1,
              color: 'text.secondary',
            }}
          >
            {familyLabel}
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
  onHoist?: (invitationId: string) => void;
  onUnseat?: (seatId: string) => void;
}

export default function TableCircle({
  table, totalTables, onEdit, onHoist, onUnseat,
}: TableCircleProps) {
  const { t } = useTranslation();
  const isRect = table.shape === 'rectangle';

  // Rectangle geometry is seat-count-driven so the seat circles never overlap;
  // circles keep their fixed square footprint. `perRowMax` is the wider (top)
  // row; the seat row, the table block, and the whole Paper all widen with it.
  const perRowMax = isRect ? Math.ceil(table.seatCount / 2) : table.seatCount;
  const rowSpan = isRect ? Math.max(0, perRowMax - 1) * SEAT_PITCH : 0;
  const seatHalfW = rowSpan / 2;
  const containerW = isRect
    ? Math.max(CONTAINER, rowSpan + NAME_W + 24) // + label margins so neighbours don't collide
    : CONTAINER;
  const cx = containerW / 2;
  const cy = CENTER;
  const tableW = isRect ? Math.max(RECT_MIN_W, rowSpan + SEAT_R * 2) : TABLE_R * 2;
  const tableH = isRect ? RECT_H : TABLE_R * 2;
  const positions = isRect
    ? rectSeatPositions(table.seatCount, cx, cy, seatHalfW)
    : seatPositions(table.seatCount, cx, cy);

  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        // Own stacking context so the seat-circle (z 1) vs name-label (z 5)
        // layering below is resolved per-table and never leaks into MUI's
        // app-bar / modal layers (z 1100+).
        isolation: 'isolate',
        width: containerW,
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
        sx={{ position: 'absolute', top: 4, right: 4, zIndex: 20 }}
      >
        <EditIcon fontSize="small" />
      </IconButton>

      {/* The table itself */}
      <Box
        sx={(theme) => ({
          position: 'absolute',
          left: cx - tableW / 2,
          top: cy - tableH / 2,
          width: tableW,
          height: tableH,
          borderRadius: isRect ? '12px' : '50%',
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
        return (
          <Seat
            key={seat.id}
            seat={seat}
            cx={pos.cx}
            cy={pos.cy}
            onHoist={onHoist}
            onUnseat={onUnseat}
          />
        );
      })}
    </Paper>
  );
}
