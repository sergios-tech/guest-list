// Centralised TanStack Query keys. Invalidation in TanStack v5 is prefix
// based, so the canonical stats key `['stats', 'overview']` is hit by both
// `invalidateQueries({ queryKey: ['stats'] })` and explicit matches.
//
// Previously, `Dashboard.tsx` used `['stats']` and `Invitations.tsx` used
// `['stats-overview']` — different first elements, so each invalidation
// only hit one of the two queries and the pinned totals row went stale.
export const qk = {
  invitations: (q?: string, status?: string) =>
    ['invitations', q ?? '', status ?? ''] as const,
  invitation: (id: string) => ['invitation', id] as const,
  attendees: (invitationId: string) => ['attendees', invitationId] as const,
  statsOverview: () => ['stats', 'overview'] as const,
  seatingPlans: () => ['seating', 'plans'] as const,
  seatingPlan: (id: string) => ['seating', 'plan', id] as const,
  seatingUnseated: (planId: string) => ['seating', 'unseated', planId] as const,
  googleSyncStatus: () => ['google-sync', 'status'] as const,
};
