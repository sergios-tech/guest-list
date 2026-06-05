import { Box, Divider, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { guestTableNumbers, type PrintGuest } from '../../lib/print';

interface CompactGuestListReportProps {
  planName: string;
  guests: PrintGuest[];
}

// Report 2: a denser clone of the Guest list. The header is identical (guest
// name + the set of tables its attendees occupy), but the attendees collapse
// into a single inline "Name table, Name table, …" string instead of a nested
// per-row list — one block per guest. A lone attendee folds into the header as
// "Attendee (Guest)" with no roster line.
export default function CompactGuestListReport({
  planName,
  guests,
}: CompactGuestListReportProps) {
  const { t } = useTranslation();

  // The distinct tables a guest occupies, as the header's trailing summary:
  // singular/plural i18n forms, or the not-seated dash when empty.
  const tableSummary = (tables: number[]) => {
    if (tables.length === 0) return t('print.notSeated');
    if (tables.length === 1) return t('print.tablesSingle', { number: tables[0] });
    return t('print.tablesMulti', { numbers: tables.join(', ') });
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {t('print.compactHeading')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('print.planLabel', { name: planName })}
      </Typography>

      {guests.length === 0 ? (
        <Typography color="text.secondary">{t('print.noGuests')}</Typography>
      ) : (
        <Stack divider={<Divider />} spacing={1}>
          {guests.map((g) => {
            const tables = guestTableNumbers(g);
            const single = g.attendees.length === 1 ? g.attendees[0] : null;

            // Inline "Name N, Name —, …" — built only for multi-attendee guests
            // (a lone attendee already lives in the header). Unseated attendees
            // carry the not-seated dash in place of a table number.
            const roster =
              single || g.attendees.length === 0
                ? null
                : g.attendees
                    .map((a) => {
                      const name = a.isChild
                        ? `${a.fullName} (${t('print.child')})`
                        : a.fullName;
                      const table =
                        a.tableNumber != null ? a.tableNumber : t('print.notSeated');
                      return `${name} ${table}`;
                    })
                    .join(', ');

            return (
              <Box key={g.invitationId} className="print-keep-together" sx={{ py: 0.5 }}>
                <Typography sx={{ fontWeight: 600 }}>
                  {single ? (
                    <>
                      {single.fullName}
                      {single.isChild && (
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: 'text.secondary', ml: 0.5 }}
                        >
                          ({t('print.child')})
                        </Typography>
                      )}
                      <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                        {' '}
                        ({g.guestLabel})
                      </Box>
                    </>
                  ) : (
                    g.guestLabel
                  )}
                  <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                    {', '}
                    {tableSummary(tables)}
                  </Box>
                </Typography>

                {roster && (
                  <Typography
                    variant="body2"
                    sx={{ pl: 3, mt: 0.25, color: 'text.secondary' }}
                  >
                    {roster}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
