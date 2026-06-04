import { Box, Divider, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { PrintGuest } from '../../lib/print';

interface GuestListReportProps {
  planName: string;
  guests: PrintGuest[];
}

// Report 1: every confirmed guest with their confirmed headcount, then a
// sub-list of named attendees and the table each is seated at (blank when the
// attendee isn't seated in this plan).
export default function GuestListReport({ planName, guests }: GuestListReportProps) {
  const { t } = useTranslation();

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
          {guests.map((g) => (
            <Box key={g.invitationId} className="print-keep-together" sx={{ py: 0.5 }}>
              <Stack direction="row" alignItems="baseline" spacing={1}>
                <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>
                  {g.guestLabel}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('print.confirmed', { count: g.confirmedTotal })}
                </Typography>
              </Stack>

              {g.attendees.length > 0 && (
                <Stack sx={{ pl: 3, mt: 0.5 }} spacing={0.25}>
                  {g.attendees.map((a) => (
                    <Stack
                      key={a.id}
                      direction="row"
                      alignItems="baseline"
                      spacing={1}
                    >
                      <Typography variant="body2" sx={{ flexGrow: 1 }}>
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
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {a.tableNumber != null
                          ? t('seating.tableNumberLabel', { number: a.tableNumber })
                          : t('print.notSeated')}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
