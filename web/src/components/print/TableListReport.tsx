import { Box, Divider, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TableView } from '../../lib/seating';
import { groupTableByGuest, type TableMember } from '../../lib/print';

interface TableListReportProps {
  planName: string;
  tables: TableView[];
}

function memberLabel(m: TableMember, guestSlot: (i: number) => string): string {
  return m.kind === 'attendee' ? m.name : guestSlot(m.slotIndex);
}

// Report 2: each table, then the families (named guests) seated at it, then the
// individuals (named attendees / placeholder slots) within each family. The
// table → guest → member grouping comes from groupTableByGuest in lib/print.
export default function TableListReport({ planName, tables }: TableListReportProps) {
  const { t } = useTranslation();
  const guestSlot = (i: number) => t('seating.guestSlot', { index: i });

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {t('print.tablesHeading')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('print.planLabel', { name: planName })}
      </Typography>

      <Stack divider={<Divider />} spacing={1.5}>
        {tables.map((table) => {
          const groups = groupTableByGuest(table);
          return (
            <Box key={table.id} className="print-keep-together" sx={{ py: 0.5 }}>
              <Typography sx={{ fontWeight: 700 }}>
                {t('seating.tableNumberLabel', { number: table.tableNumber })}
                {table.label ? ` — ${table.label}` : ''}
              </Typography>

              {groups.length === 0 ? (
                <Typography
                  variant="body2"
                  sx={{ pl: 3, color: 'text.secondary' }}
                >
                  {t('print.emptyTable')}
                </Typography>
              ) : (
                <Stack sx={{ pl: 3, mt: 0.5 }} spacing={0.75}>
                  {groups.map((grp, gi) => (
                    <Box key={grp.invitationId ?? `g${gi}`}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {grp.guestLabel}
                      </Typography>
                      <Stack sx={{ pl: 2 }} spacing={0.1}>
                        {grp.members.map((m, mi) => (
                          <Typography
                            key={`${m.seatNumber}-${mi}`}
                            variant="body2"
                            sx={{ color: 'text.secondary' }}
                          >
                            {memberLabel(m, guestSlot)}
                          </Typography>
                        ))}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
