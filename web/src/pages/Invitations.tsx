import { useMemo, useState, useDeferredValue } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { AgGridReact } from 'ag-grid-react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type {
  CellStyle, ColDef, EditableCallbackParams,
  RowClassParams, RowValueChangedEvent, ValueFormatterParams,
} from 'ag-grid-community';
import {
  Box, CircularProgress, InputAdornment, Stack, TextField, MenuItem,
  Button, ToggleButton, useMediaQuery,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useSnackbar } from '../lib/snackbar';
import { apiErrorMessage } from '../lib/errors';
import { RSVP_STATUSES, STATUS_COLOR, type RsvpStatus } from '../lib/enums';

interface Invitation {
  id: string;
  guestLabel: string;
  plannedCount: number | null;
  status: RsvpStatus | string;
  adults: number | null;
  children: number | null;
  confirmedTotal: number;
  forecast: number | null;
  responseDate: string | null;
  notes: string | null;
  version?: number;
}

interface Stats {
  plannedHeadcount: number;
  confirmedAdults: number;
  confirmedChildren: number;
  confirmedHeadcount: number;
  forecastHeadcount: number;
}

const STATUS_FILTER_OPTIONS = ['', ...RSVP_STATUSES] as const;

const TOTALS_ROW_ID = '__totals__';

// Coerce an AG Grid edited cell value to its payload form. Empty string is
// treated as "cleared" (sent as null so the server actually clears the
// column). `undefined` would be JSON-omitted, which is what the previous
// `nullToUndef` did — and that's how cleared cells silently reverted.
const toPayload = <T,>(v: T | null | undefined | ''): T | null =>
  v === undefined || v === '' || v === null ? null : v;

// Guard non-integer numeric input (paste, NaN, locale comma). Out-of-range
// values fall back to null rather than silently overwriting the DB column.
const toIntOrNull = (v: number | null | undefined | string): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 12) return null;
  return n;
};

function StatusEditor(p: CustomCellEditorProps<Invitation, string>) {
  const { t } = useTranslation();
  return (
    <select
      autoFocus
      value={(p.value as string) ?? ''}
      onChange={(e) => p.onValueChange(e.target.value)}
      style={{
        width: '100%', height: '100%',
        border: 0, outline: 0, background: 'transparent',
        font: 'inherit', padding: '0 8px',
      }}
    >
      {RSVP_STATUSES.map((v) => (
        <option key={v} value={v}>{t(`status.${v}`)}</option>
      ))}
    </select>
  );
}

export default function Invitations() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();
  const snackbar = useSnackbar();
  const { currentClientId } = useAuth();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [q, setQ] = useState('');
  // React batches the heavy work (fetch + grid refresh) so typing stays
  // responsive without firing one request per keystroke.
  const deferredQ = useDeferredValue(q);
  const isPendingSearch = q !== deferredQ;
  const [status, setStatus] = useState('');
  const [inlineEditing, setInlineEditing] = useState(false);

  const { data = [] } = useQuery<Invitation[]>({
    queryKey: qk.invitations(currentClientId!, deferredQ, status),
    queryFn: async () => (await api.get('/invitations', {
      params: { q: deferredQ || undefined, status: status || undefined },
    })).data,
    enabled: !!currentClientId,
    // Keep the previous result mounted while a new fetch runs so the grid
    // doesn't flash empty between keystrokes.
    placeholderData: (prev) => prev,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: qk.statsOverview(currentClientId!),
    queryFn: async () => (await api.get('/stats/overview')).data,
    enabled: !!currentClientId,
  });

  const dateLocale = i18n.language === 'sr' ? 'sr-Latn-RS' : 'en-GB';
  const formatDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
  };

  const isEditable = (p: EditableCallbackParams<Invitation>) =>
    inlineEditing && !p.node.rowPinned;

  const columnDefs = useMemo<ColDef<Invitation>[]>(() => [
    {
      field: 'guestLabel', headerName: t('invitation.guestLabel'),
      flex: 2, minWidth: 160, pinned: 'left' as const,
      cellStyle: { fontWeight: 500 } as CellStyle,
      filter: 'agTextColumnFilter',
      editable: isEditable,
      cellEditor: 'agTextCellEditor',
    },
    {
      field: 'plannedCount', headerName: t('invitation.plannedCount'),
      width: 110, type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      editable: isEditable,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, max: 12, precision: 0 },
    },
    {
      field: 'status', headerName: t('invitation.status'),
      width: 160,
      valueFormatter: (p: ValueFormatterParams<Invitation, string>) =>
        p.value ? t(`status.${p.value}`) : '',
      cellStyle: (p) => {
        if (p.node.rowPinned) return null;
        const color = STATUS_COLOR[p.value as RsvpStatus];
        return color ? { color, fontWeight: 600 } : null;
      },
      filter: 'agTextColumnFilter',
      editable: isEditable,
      cellEditor: StatusEditor,
    },
    {
      field: 'adults', headerName: t('invitation.adults'),
      width: 100, type: 'numericColumn', hide: isMobile,
      filter: 'agNumberColumnFilter',
      editable: isEditable,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, max: 12, precision: 0 },
    },
    {
      field: 'children', headerName: t('invitation.children'),
      width: 100, type: 'numericColumn', hide: isMobile,
      filter: 'agNumberColumnFilter',
      editable: isEditable,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, max: 12, precision: 0 },
    },
    {
      field: 'confirmedTotal', headerName: t('invitation.confirmedTotal'),
      width: 120, type: 'numericColumn',
      cellStyle: { fontWeight: 600 } as CellStyle,
      filter: 'agNumberColumnFilter',
      // Generated column in Postgres — never editable.
      editable: false,
    },
    {
      field: 'forecast', headerName: t('invitation.forecast'),
      width: 110, type: 'numericColumn', hide: isMobile,
      filter: 'agNumberColumnFilter',
      editable: isEditable,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, max: 12, precision: 0 },
    },
    {
      field: 'responseDate', headerName: t('invitation.responseDate'),
      width: 140, hide: isMobile,
      valueFormatter: (p) => formatDate(p.value as string | null),
      filter: 'agTextColumnFilter',
      editable: isEditable,
      cellEditor: 'agDateStringCellEditor',
    },
    {
      field: 'notes', headerName: t('invitation.notes'),
      flex: 1.6, minWidth: 200, hide: isMobile,
      filter: 'agTextColumnFilter',
      cellStyle: { color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as CellStyle,
      editable: isEditable,
      cellEditor: 'agLargeTextCellEditor',
      cellEditorPopup: true,
      cellEditorParams: { maxLength: 1000, rows: 4, cols: 50 },
    },
  ], [t, isMobile, dateLocale, inlineEditing]);

  const pinnedBottomRowData = useMemo<Invitation[]>(() => {
    if (!stats) return [];
    return [{
      id: TOTALS_ROW_ID,
      guestLabel: t('invitation.total'),
      plannedCount: stats.plannedHeadcount,
      status: '',
      adults: stats.confirmedAdults,
      children: stats.confirmedChildren,
      confirmedTotal: stats.confirmedHeadcount,
      forecast: stats.forecastHeadcount,
      responseDate: null,
      notes: null,
    }];
  }, [stats, t]);

  const onRowValueChanged = async (e: RowValueChangedEvent<Invitation>) => {
    const row = e.data;
    if (!row || row.id === TOTALS_ROW_ID) return;
    try {
      await api.patch(`/invitations/${row.id}`, {
        guestLabel: row.guestLabel,
        plannedCount: toIntOrNull(row.plannedCount),
        status: toPayload(row.status as string),
        adults: toIntOrNull(row.adults),
        children: toIntOrNull(row.children),
        forecast: toIntOrNull(row.forecast),
        responseDate: toPayload(row.responseDate),
        notes: toPayload(row.notes),
        version: row.version,
      });
      qc.invalidateQueries({ queryKey: ['invitations'] });
      // Prefix match: invalidates ['stats', 'overview'].
      qc.invalidateQueries({ queryKey: ['stats'] });
    } catch (err) {
      snackbar.show(apiErrorMessage(err, t), 'error');
      qc.invalidateQueries({ queryKey: ['invitations'] });
    }
  };

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1} alignItems={{ sm: 'center' }}
      >
        <TextField
          label={t('invitation.search')}
          value={q} onChange={(e) => setQ(e.target.value)}
          sx={{ maxWidth: { sm: 280 } }}
          InputProps={isPendingSearch ? {
            endAdornment: (
              <InputAdornment position="end">
                <CircularProgress size={16} />
              </InputAdornment>
            ),
          } : undefined}
        />
        <TextField
          select label={t('invitation.status')}
          value={status} onChange={(e) => setStatus(e.target.value)}
          sx={{ maxWidth: { sm: 220 } }}
        >
          {STATUS_FILTER_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s ? t(`status.${s}`) : t('invitation.filter')}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <ToggleButton
          value="inline"
          selected={inlineEditing}
          onChange={() => setInlineEditing((v) => !v)}
          size="small"
          color="primary"
          aria-label={t('invitation.inlineEditing')}
          sx={{ textTransform: 'none', px: 1.5 }}
        >
          <EditIcon fontSize="small" sx={{ mr: 0.5 }} />
          {t('invitation.inlineEditing')}
        </ToggleButton>
        <Button
          startIcon={<AddIcon />}
          onClick={() => nav('/invitations/new')}
        >
          {t('nav.addInvitation')}
        </Button>
      </Stack>

      <Box
        className="ag-theme-material"
        sx={{ flex: 1, minHeight: 400, width: '100%' }}
      >
        <AgGridReact<Invitation>
          // Force a fresh mount when editType toggles. AG Grid Community
          // captures editType at mount and ignores later changes, which
          // would silently route cell-level events away from this handler.
          key={inlineEditing ? 'inline' : 'view'}
          rowData={data}
          columnDefs={columnDefs}
          pinnedBottomRowData={pinnedBottomRowData}
          defaultColDef={{
            sortable: true,
            resizable: true,
            filter: true,
          }}
          rowHeight={44}
          headerHeight={44}
          editType={inlineEditing ? 'fullRow' : undefined}
          singleClickEdit={inlineEditing}
          stopEditingWhenCellsLoseFocus={true}
          onRowClicked={(e) => {
            if (e.node.rowPinned) return;
            if (inlineEditing) return;
            if (e.data) nav(`/invitations/${e.data.id}`);
          }}
          onRowValueChanged={onRowValueChanged}
          getRowStyle={(p: RowClassParams<Invitation>) =>
            p.node.rowPinned
              ? { cursor: 'default' }
              : { cursor: inlineEditing ? 'cell' : 'pointer' }
          }
        />
      </Box>
    </Stack>
  );
}
