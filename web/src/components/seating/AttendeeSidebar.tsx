import { useState } from 'react';
import {
  Box, Chip, IconButton, InputAdornment, Paper, Stack, TextField,
  Typography, Divider,
} from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Close';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import {
  type UnseatedUnit, unseatedUnitDragId, unseatedUnitKey,
} from '../../lib/seating';

interface DraggableUnitChipProps {
  unit: UnseatedUnit;
  onHoist?: (invitationId: string) => void;
}

function DraggableUnitChip({ unit, onHoist }: DraggableUnitChipProps) {
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
      // The activation distance (4px) on the page's PointerSensor means a
      // plain click without dragging fires onClick instead of starting a drag.
      onClick={() => onHoist?.(unit.invitationId)}
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
  pinned: string[];        // invitation ids, most recent first
  onHoist?: (invitationId: string) => void;
}

export default function AttendeeSidebar({ unseated, pinned, onHoist }: AttendeeSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // Drop here to unassign whatever is being dragged. The sidebar accepts both
  // unseated chips (no-op) and seated chips (clears the seat).
  const { setNodeRef, isOver } = useDroppable({ id: 'sidebar' });

  // Filter first: a unit passes if either the household label OR the
  // attendee name (when present) contains the query. Case- and
  // diacritic-insensitive via toLocaleLowerCase so 'ivan' matches 'Ivan'.
  const q = query.trim().toLocaleLowerCase();
  const matches = (u: UnseatedUnit) => {
    if (!q) return true;
    if (u.invitationLabel.toLocaleLowerCase().includes(q)) return true;
    if (u.kind === 'attendee' && u.attendeeName.toLocaleLowerCase().includes(q)) return true;
    return false;
  };
  const filtered = unseated.filter(matches);

  // Group by invitation so a household stays visually together.
  const byInvitation = new Map<string, { label: string; units: UnseatedUnit[] }>();
  for (const u of filtered) {
    const bucket = byInvitation.get(u.invitationId) ?? { label: u.invitationLabel, units: [] };
    bucket.units.push(u);
    byInvitation.set(u.invitationId, bucket);
  }

  // Pinned households come first (in pin order), then the rest alphabetically
  // by the order they appeared in the unseated list (already sorted server-side).
  const pinnedSet = new Set(pinned);
  const pinnedEntries: Array<[string, { label: string; units: UnseatedUnit[] }]> = [];
  for (const invId of pinned) {
    const bucket = byInvitation.get(invId);
    if (bucket) pinnedEntries.push([invId, bucket]);
  }
  const restEntries: Array<[string, { label: string; units: UnseatedUnit[] }]> = [];
  for (const [invId, bucket] of byInvitation.entries()) {
    if (!pinnedSet.has(invId)) restEntries.push([invId, bucket]);
  }
  const groups = [...pinnedEntries, ...restEntries];

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
            : query
              ? t('seating.unseatedFiltered', { shown: filtered.length, total: unseated.length })
              : t('seating.unseatedCount', { count: unseated.length })}
        </Typography>
      </Box>
      <TextField
        size="small"
        placeholder={t('seating.searchUnseated')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={unseated.length === 0}
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: query ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={() => setQuery('')}
                aria-label={t('seating.searchClear')}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {t('seating.dragHint')}
      </Typography>
      <Divider />
      <Box sx={{ overflowY: 'auto', flex: 1, pr: 0.5 }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            {query && unseated.length > 0
              ? t('seating.searchNoMatch')
              : t('seating.noConfirmedGuests')}
          </Typography>
        ) : (
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            {groups.map(([invId, { label, units }]) => {
              const isPinned = pinnedSet.has(invId);
              return (
                <Box
                  key={invId}
                  sx={(theme) => (isPinned ? {
                    backgroundColor: theme.palette.action.selected,
                    borderRadius: 1,
                    p: 0.5,
                    mx: -0.5,
                  } : {})}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {isPinned ? (
                      <PushPinIcon fontSize="inherit" sx={{ color: 'primary.main' }} />
                    ) : null}
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                      {label}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                    {units.map((u) => (
                      <DraggableUnitChip
                        key={unseatedUnitKey(u)}
                        unit={u}
                        onHoist={onHoist}
                      />
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
