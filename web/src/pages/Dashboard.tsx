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

type Tone = 'default' | 'confirmed' | 'pending' | 'declined' | 'planned' | 'forecast';

interface TonePalette {
  bg: string;
  fg: string;
  labelFg: string;
}

const tonePalettes: Record<Tone, TonePalette | null> = {
  default: null,
  confirmed: { bg: '#1b5e20', fg: '#ffffff', labelFg: 'rgba(255,255,255,0.85)' },
  pending: { bg: '#c62828', fg: '#ffffff', labelFg: 'rgba(255,255,255,0.85)' },
  declined: { bg: '#455a64', fg: '#ffffff', labelFg: 'rgba(255,255,255,0.85)' },
  planned: { bg: '#1565c0', fg: '#ffffff', labelFg: 'rgba(255,255,255,0.85)' },
  forecast: { bg: '#6a1b9a', fg: '#ffffff', labelFg: 'rgba(255,255,255,0.85)' },
};

function Tile({ label, value, loading, tone = 'default' }: { label: string; value?: number; loading?: boolean; tone?: Tone }) {
  const palette: TonePalette | null = tonePalettes[tone];
  return (
    <Card sx={{ height: '100%', bgcolor: palette?.bg, color: palette?.fg }}>
      <CardContent>
        <Typography variant="overline" sx={{ color: palette?.labelFg ?? 'text.secondary' }}>{label}</Typography>
        {loading
          ? <Skeleton variant="text" width="50%" height={48} sx={{ bgcolor: palette ? 'rgba(255,255,255,0.2)' : undefined }} />
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
        ['stats.totalInvites',       data?.totalInvites,      'default'],
        ['stats.confirmedInvites',   data?.confirmedInvites,  'confirmed'],
        ['stats.pending',            data?.pending,           'pending'],
        ['stats.declined',           data?.declined,          'declined'],
        ['stats.plannedHeadcount',   data?.plannedHeadcount,  'planned'],
        ['stats.confirmedHeadcount', data?.confirmedHeadcount,'confirmed'],
        ['stats.forecastHeadcount',  data?.forecastHeadcount, 'forecast'],
        ['stats.notInvited',         data?.notInvited,        'default'],
      ] as Array<[string, number | undefined, Tone]>).map(([key, value, tone]) => (
        <Grid key={key} item xs={6} sm={4} md={3}>
          <Tile label={t(key)} value={value} loading={isLoading} tone={tone} />
        </Grid>
      ))}
      </Grid>
    </>
  );
}
