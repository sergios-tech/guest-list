// Centralised TanStack Query keys. Invalidation in TanStack v5 is prefix
// based, so the canonical stats key `['stats', 'overview']` is hit by both
// `invalidateQueries({ queryKey: ['stats'] })` and explicit matches.
//
// Previously, `Dashboard.tsx` used `['stats']` and `Invitations.tsx` used
// `['stats-overview']` — different first elements, so each invalidation
// only hit one of the two queries and the pinned totals row went stale.
//
// MULTI-TENANCY: every tenant-scoped key is prefixed with the current
// clientId so cached data from one client can never surface under another.
// switchClient() also clears the whole cache as a belt-and-braces measure,
// but scoping the keys keeps invalidations and refetches correct per client.
export const qk = {
  invitations: (clientId: string, q?: string, status?: string) =>
    ['invitations', clientId, q ?? '', status ?? ''] as const,
  invitation: (clientId: string, id: string) =>
    ['invitation', clientId, id] as const,
  attendees: (clientId: string, invitationId: string) =>
    ['attendees', clientId, invitationId] as const,
  statsOverview: (clientId: string) => ['stats', 'overview', clientId] as const,
  seatingPlans: (clientId: string) => ['seating', 'plans', clientId] as const,
  seatingPlan: (clientId: string, id: string) =>
    ['seating', 'plan', clientId, id] as const,
  seatingUnseated: (clientId: string, planId: string) =>
    ['seating', 'unseated', clientId, planId] as const,
  googleSyncStatus: (clientId: string) =>
    ['google-sync', 'status', clientId] as const,
  authConfig: () => ['auth', 'config'] as const,
  // Super-admin client management (not tenant-scoped).
  clients: () => ['clients'] as const,
  clientMembers: (clientId: string) => ['clients', clientId, 'members'] as const,
};
