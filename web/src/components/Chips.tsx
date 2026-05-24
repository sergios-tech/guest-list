import { Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { RsvpStatus, AccommodationType } from '../lib/enums';
import { STATUS_COLOR } from '../lib/enums';

// Map enum codes to MUI chip semantic colours for the detail page; the grid
// uses STATUS_COLOR directly so cell text inherits the same hue family.
const STATUS_MUI_COLOR: Record<RsvpStatus, 'default' | 'primary' | 'success' | 'warning' | 'error'> = {
  NIJE_POZVAN: 'default',
  POZVAN: 'warning',
  ODBIJENO: 'error',
  POTVRDJEN_DOLAZAK: 'success',
};

export function StatusChip({ value }: { value: RsvpStatus | string }) {
  const { t } = useTranslation();
  const code = value as RsvpStatus;
  return (
    <Chip
      size="small"
      color={STATUS_MUI_COLOR[code] ?? 'default'}
      label={t(`status.${value}`)}
      sx={STATUS_COLOR[code] ? { color: STATUS_COLOR[code], fontWeight: 600 } : undefined}
      variant="outlined"
    />
  );
}

export function AccommodationChip({ value }: { value: AccommodationType | string }) {
  const { t } = useTranslation();
  if (!value || value === 'NONE') return null;
  return <Chip size="small" variant="outlined" label={t(`accommodation.${value}`)} />;
}
