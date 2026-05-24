---
created: 2026-05-24T08:00:00.000Z
title: Preserve invitation audit trail when an app_user is deleted
area: db
files:
  - db/01_schema.sql:59-60
  - api/src/entities/invitation.entity.ts
---

## Problem

```sql
-- db/01_schema.sql:59-60
created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
```

Deleting an `app_user` row silently nulls out their entire audit trail on every
invitation they touched. There is no separate audit log table, no soft-delete on
`app_user`, no way to ever recover "who made this change." For a multi-user wedding
guest list this might be tolerable, but it's an irreversible compliance/audit hole
in any shared deployment.

The same pattern (`ON DELETE SET NULL` on a "created_by" / "updated_by" FK) tends
to propagate to new tables as the schema grows — the convention itself is the bug.

## Solution

Pick one based on operational tolerance:

1. **Soft-delete `app_user`** (recommended). Add `deleted_at timestamptz` to
   `app_user`, change the deletion code path to set it instead of `DELETE`. Audit
   columns stay pointed at the original UUID, joins can filter `WHERE deleted_at IS
   NULL` for active-user dropdowns.

   ```sql
   ALTER TABLE app_user ADD COLUMN deleted_at timestamptz;
   CREATE INDEX ix_app_user_active ON app_user (id) WHERE deleted_at IS NULL;
   ```

   No FK behavior change needed — historic audit references stay valid.

2. **Restrict the delete.** `ON DELETE SET NULL` → `ON DELETE RESTRICT`. Forces the
   operator to reassign or archive invitations first. Loud failure mode is the
   feature.

3. **Audit log table.** A `invitation_audit` table that captures (invitation_id,
   actor_id, actor_display_name, action, before, after, at). Survives even hard
   DELETE on `app_user` because actor_display_name is denormalized. Heavier to
   maintain but the most defensible long-term.

Recommended: **#1** for this app's scope. It's a single schema add, no API surface
change (just gate the delete endpoint with a soft-delete update), and the existing
`ON DELETE SET NULL` becomes effectively unreachable.

If you go with #1, also reflect it in the User entity (`@Column({ name: 'deleted_at',
type: 'timestamptz', nullable: true }) deletedAt?: Date | null;`) and add a global
TypeORM `@Filter` (or query-builder convention) so `findOne` / `find` exclude
deleted users by default.

Per CLAUDE.md, schema changes need `docker compose down -v` to re-init. Coordinate
with any other in-flight migrations.

While here, the same review noted that `notes`, `decline_reason`, and
`dietary_notes` are unbounded `text` — add `@MaxLength(2000)` on the corresponding
DTOs (the attendees module already has `@MaxLength(500)` on `dietaryNotes` per
attendees.module.ts:16; invitation notes should mirror that).
