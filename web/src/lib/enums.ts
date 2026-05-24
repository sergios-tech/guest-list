// Frontend mirror of the api's RsvpStatus / AccommodationType enums.
// Source of truth lives in `api/src/entities/invitation.entity.ts` and
// `db/01_schema.sql`. When adding a value: edit the DB enum, the API entity,
// this file, and the i18n keys in `i18n/locales/{en,sr}.json`.

export const RSVP_STATUSES = [
  'NIJE_POZVAN',
  'POZVAN',
  'POTVRDJEN_DOLAZAK',
  'ODBIJENO',
] as const;
export type RsvpStatus = typeof RSVP_STATUSES[number];

export const ACCOMMODATION_TYPES = [
  'NONE',
  'SIESTA_SINGLE',
  'SIESTA_DOUBLE',
  'SIESTA_APARTMENT',
  'ARIA',
] as const;
export type AccommodationType = typeof ACCOMMODATION_TYPES[number];

// Status pill colours used by both the inline grid renderer and StatusChip.
export const STATUS_COLOR: Record<RsvpStatus, string> = {
  POTVRDJEN_DOLAZAK: '#15803d', // green
  POZVAN:            '#c2410c', // orange
  ODBIJENO:          '#b91c1c', // red
  NIJE_POZVAN:       '#6b7280', // muted grey
};
