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

            // Inline roster, built only for multi-attendee guests (a lone
            // attendee already lives in the header). Attendees are grouped by
            // table so a shared table isn't repeated per name: a single group
            // renders as bare names (the header already states the table),
            // several groups as "<table>: a, b; <table>: c" with the not-seated
            // dash labelling unseated attendees, seated tables first (ascending).
            let roster: string | null = null;
            if (!single && g.attendees.length > 0) {
              const byTable = new Map<number | null, string[]>();
              for (const a of g.attendees) {
                const name = a.isChild
                  ? `${a.fullName} (${t('print.child')})`
                  : a.fullName;
                byTable.set(a.tableNumber, [...(byTable.get(a.tableNumber) ?? []), name]);
              }
              const keys = [...byTable.keys()].sort((x, y) => {
                if (x == null) return 1;
                if (y == null) return -1;
                return x - y;
              });
              roster =
                keys.length === 1
                  ? (byTable.get(keys[0] ?? null) ?? []).join(', ')
                  : keys
                      .map((k) => {
                        const tableLabel = k != null ? k : t('print.notSeated');
                        return `${tableLabel}: ${(byTable.get(k) ?? []).join(', ')}`;
                      })
                      .join('; ');
            }

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
                    {roster && ` (${roster})`}
                  </Box>
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
