import { useMemo } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { flattenAttendees, type PrintGuest } from '../../lib/print';

interface AttendeeListReportProps {
  planName: string;
  guests: PrintGuest[];
}

// Report 4: a flat alphabetical table of every confirmed named attendee — one
// row each, with the family they belong to and the table they're seated at
// (blank when unseated). Unlike GuestListReport this is un-nested, so it reads
// as a single sortable check-in sheet rather than a per-family breakdown.
export default function AttendeeListReport({ planName, guests }: AttendeeListReportProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => flattenAttendees(guests), [guests]);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {t('print.attendeesHeading')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('print.planLabel', { name: planName })}
      </Typography>

      {rows.length === 0 ? (
        <Typography color="text.secondary">{t('print.noGuests')}</Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>{t('print.colAttendee')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('print.colGuest')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  {t('print.colTable')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="print-keep-together">
                  <TableCell>
                    {r.fullName}
                    {r.isChild && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: 'text.secondary', ml: 0.5 }}
                      >
                        ({t('print.child')})
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{r.guestLabel}</TableCell>
                  <TableCell align="right">
                    {/* Bare number — the column header already says "Table". */}
                    {r.tableNumber ?? t('print.notSeated')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
