import { useQuery } from '@tanstack/react-query';
import { Box, Card, CardContent, Typography, Grid, Skeleton } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useAuth } from '../lib/auth';
import SyncFromGoogleButton from '../components/SyncFromGoogleButton';

interface Stats {
  pending: number;
  confirmedInvites: number;
  notInvited: number;
  declined: number;
  totalInvites: number;
  plannedHeadcount: number;
  confirmedHeadcount: number;
  forecastHeadcount: number;
}

function Tile({ label, value, loading }: { label: string; value?: number; loading?: boolean }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        {loading
          ? <Skeleton variant="text" width="50%" height={48} />
          : <Typography variant="h4" sx={{ fontWeight: 600 }}>{value ?? 0}</Typography>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { currentClientId, currentRole } = useAuth();
  const canSync = currentRole === 'OWNER' || currentRole === 'EDITOR';
  const { data, isLoading } = useQuery<Stats>({
    queryKey: qk.statsOverview(currentClientId!),
    queryFn: async () => (await api.get('/stats/overview')).data,
    enabled: !!currentClientId,
  });

  return (
    <>
      {canSync && (
        <Box sx={{ mb: 2 }}>
          <SyncFromGoogleButton />
        </Box>
      )}
      <Grid container spacing={2}>
      {([
        ['stats.totalInvites',       data?.totalInvites],
        ['stats.confirmedInvites',   data?.confirmedInvites],
        ['stats.pending',            data?.pending],
        ['stats.declined',           data?.declined],
        ['stats.plannedHeadcount',   data?.plannedHeadcount],
        ['stats.confirmedHeadcount', data?.confirmedHeadcount],
        ['stats.forecastHeadcount',  data?.forecastHeadcount],
        ['stats.notInvited',         data?.notInvited],
      ] as Array<[string, number | undefined]>).map(([key, value]) => (
        <Grid key={key} item xs={6} sm={4} md={3}>
          <Tile label={t(key)} value={value} loading={isLoading} />
        </Grid>
      ))}
      </Grid>
    </>
  );
}
