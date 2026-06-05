import { Box, Divider, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { guestTableNumbers, type PrintGuest } from '../../lib/print';

interface GuestListReportProps {
  planName: string;
  guests: PrintGuest[];
}

// Report 1: every confirmed guest with the set of tables their attendees occupy
// summarised on the header row ("tables: 3, 15", or "—" when none are seated).
// A guest with a single attendee collapses to "Attendee (Guest)" with no
// sub-list; guests with several attendees still list each one and their table.
export default function GuestListReport({ planName, guests }: GuestListReportProps) {
  const { t } = useTranslation();

  // The distinct tables a guest occupies, rendered as the header's trailing
  // summary: singular/plural i18n forms, or the not-seated dash when empty.
  const tableSummary = (tables: number[]) => {
    if (tables.length === 0) return t('print.notSeated');
    if (tables.length === 1) return t('print.tablesSingle', { number: tables[0] });
    return t('print.tablesMulti', { numbers: tables.join(', ') });
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {t('print.guestsHeading')}
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
            // One attendee → fold their name into the header and drop the
            // sub-list; the nested rows only earn their keep for groups.
            const single = g.attendees.length === 1 ? g.attendees[0] : null;

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

                {g.attendees.length > 1 && (
                  <Stack sx={{ pl: 3, mt: 0.5 }} spacing={0.25}>
                    {g.attendees.map((a) => (
                      // Single concatenated column: table number first, then the
                      // attendee name ("3 Mida"); the not-seated dash stands in
                      // for the number when the attendee has no seat.
                      <Typography key={a.id} variant="body2">
                        {a.tableNumber != null ? a.tableNumber : t('print.notSeated')}{' '}
                        {a.fullName}
                        {a.isChild && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ color: 'text.secondary', ml: 0.5 }}
                          >
                            ({t('print.child')})
                          </Typography>
                        )}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
