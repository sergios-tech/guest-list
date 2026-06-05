import { Box, Divider, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { guestTableNumbers, type PrintGuest } from '../../lib/print';

interface CompactGuestListReportProps {
  planName: string;
  guests: PrintGuest[];
}

// Report 2: a denser clone of the Guest list. The header is identical (guest
// name + the set of tables its attendees occupy). A lone attendee folds into
// the header as "Attendee (Guest)" with no roster line. When all of a guest's
// attendees share a single table, their names collapse inline into the header.
// When they span more than one table, the per-table breakdown drops onto its
// own indented rows below the header (one row per table), so a wide spread
// stays legible instead of running into one long parenthetical.
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

            // Per-table roster, built only for multi-attendee guests (a lone
            // attendee already lives in the header). Attendees are grouped by
            // table so a shared table isn't repeated per name, with the
            // not-seated dash labelling unseated attendees and seated tables
            // first (ascending).
            let groups: { label: string; names: string }[] | null = null;
            if (!single && g.attendees.length > 0) {
              const byTable = new Map<number | null, string[]>();
              for (const a of g.attendees) {
                byTable.set(a.tableNumber, [...(byTable.get(a.tableNumber) ?? []), a.fullName]);
              }
              const keys = [...byTable.keys()].sort((x, y) => {
                if (x == null) return 1;
                if (y == null) return -1;
                return x - y;
              });
              groups = keys.map((k) => ({
                label: k != null ? String(k) : t('print.notSeated'),
                names: (byTable.get(k) ?? []).join(', '),
              }));
            }

            // One group → fold the names inline into the header. More than one
            // table → drop the breakdown onto indented per-table rows below.
            const inlineRoster = groups && groups.length === 1 ? groups[0].names : null;
            const detailGroups = groups && groups.length > 1 ? groups : null;

            return (
              <Box key={g.invitationId} className="print-keep-together" sx={{ py: 0.5 }}>
                <Typography sx={{ fontWeight: 600 }}>
                  {single ? (
                    <>
                      {single.fullName}
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
                    {inlineRoster && ` (${inlineRoster})`}
                  </Box>
                </Typography>
                {detailGroups && (
                  <Box sx={{ pl: 2, mt: 0.25 }}>
                    {detailGroups.map((grp) => (
                      <Typography
                        key={grp.label}
                        variant="body2"
                        sx={{ color: 'text.secondary' }}
                      >
                        {grp.label}: {grp.names}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
