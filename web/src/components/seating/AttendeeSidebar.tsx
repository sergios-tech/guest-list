import {
  Box, Chip, Paper, Stack, Typography, Divider,
} from '@mui/material';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import {
  type UnseatedUnit, unseatedUnitDragId, unseatedUnitKey,
} from '../../lib/seating';

interface DraggableUnitChipProps {
  unit: UnseatedUnit;
}

function DraggableUnitChip({ unit }: DraggableUnitChipProps) {
  const { t } = useTranslation();
  const label = unit.kind === 'attendee'
    ? unit.attendeeName
    : t('seating.guestSlot', { index: unit.slotIndex });
  const dragId = unseatedUnitDragId(unit);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });

  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      sx={{
        cursor: 'grab',
        opacity: isDragging ? 0.3 : 1,
        display: 'inline-flex',
      }}
    >
      <Chip
        size="small"
        label={label}
        color={unit.kind === 'attendee' ? 'primary' : 'default'}
        variant={unit.kind === 'attendee' ? 'filled' : 'outlined'}
      />
    </Box>
  );
}

interface AttendeeSidebarProps {
  unseated: UnseatedUnit[];
}

export default function AttendeeSidebar({ unseated }: AttendeeSidebarProps) {
  const { t } = useTranslation();

  // Drop here to unassign whatever is being dragged. The sidebar accepts both
  // unseated chips (no-op) and seated chips (clears the seat).
  const { setNodeRef, isOver } = useDroppable({ id: 'sidebar' });

  // Group by invitation so a household stays visually together.
  const byInvitation = new Map<string, { label: string; units: UnseatedUnit[] }>();
  for (const u of unseated) {
    const bucket = byInvitation.get(u.invitationId) ?? { label: u.invitationLabel, units: [] };
    bucket.units.push(u);
    byInvitation.set(u.invitationId, bucket);
  }
  const groups = Array.from(byInvitation.entries());

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={(theme) => ({
        p: 2,
        height: '100%',
        minHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        backgroundColor: isOver
          ? theme.palette.action.hover
          : theme.palette.background.paper,
        transition: 'background-color 80ms',
      })}
    >
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('seating.unseatedHeader')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {unseated.length === 0
            ? t('seating.allSeated')
            : t('seating.unseatedCount', { count: unseated.length })}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('seating.dragHint')}
      </Typography>
      <Divider />
      <Box sx={{ overflowY: 'auto', flex: 1, pr: 0.5 }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            {t('seating.noConfirmedGuests')}
          </Typography>
        ) : (
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            {groups.map(([invId, { label, units }]) => (
              <Box key={invId}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                  {label}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                  {units.map((u) => (
                    <DraggableUnitChip key={unseatedUnitKey(u)} unit={u} />
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
