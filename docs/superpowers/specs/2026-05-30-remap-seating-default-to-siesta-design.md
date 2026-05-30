# Remap seating arrangement: Default → Siesta 2026.06.13

**Date:** 2026-05-30
**Type:** One-off data migration (no schema change)
**Status:** Design — awaiting approval

## Problem

The real seating work was done in the **Default** client's plan `proba 1` (15 tables,
151 seats, 108 assigned). The guest data in Default later turned out to be wrong, so a
clean client **Siesta 2026.06.13** was created with corrected invitations/attendees and
an **empty** plan `Sala Siesta` (15 tables, 150 seats, 0 assigned).

We want to carry the seating *arrangement* and *table naming* from `proba 1` into the
existing `Sala Siesta` plan, **repointing every seat to Siesta's guest rows by name**.
Default and `proba 1` are read-only sources — nothing in Default is modified.

### Identifiers (from the live DB)

| Role | Client | Client id | Plan | Plan id |
|---|---|---|---|---|
| Source (read-only) | Default | `00000000-0000-0000-0000-0000000000c1` | `proba 1` | `2c8664c2-c317-4ceb-9dbd-dec957e7ff50` |
| Target (filled in place) | Siesta 2026.06.13 | `208fff41-e9bc-47e5-9b68-ba9638f3d580` | `Sala Siesta` | `7a34f9a3-0766-4c8b-a1e7-840afa91a1ea` |

## Why this isn't a row copy

Only `seating_plan` carries `client_id`. A `seat` references **out** of the seating tree
into the guest tree via either `attendee_id` or `(invitation_id, slot_index)`. Those FKs
point at **Default's** guests, so they cannot be copied verbatim into Siesta — each must be
**re-resolved to the equivalent Siesta row by name**. Seat *position* is preserved by
matching `(table_number, seat_number)` between the two plans.

## What is carried over

1. **Table labels** — copy `seating_table.label` from `proba 1` to `Sala Siesta` by
   `table_number` (e.g. table 1 → `kumovi uzice`, table 3 → `drustvo 1`). 15 tables, same
   numbering in both plans.
2. **Seat assignments** — for each assigned source seat, set the matching target seat at
   the same `(table_number, seat_number)` to the resolved Siesta guest, **preserving the
   assignment kind**:
   - invite-slot seat (`invitation_id` + `slot_index`) → Siesta invitation with the same
     guest, same `slot_index`.
   - named-attendee seat (`attendee_id`) → Siesta attendee with the same name in the same
     family.
   - empty seat → left empty (target already starts empty).

`is_active` is **not** changed (both plans stay inactive; activate manually later).

## Name-resolution strategy (the core design)

Resolution runs in tiers; the first tier that yields a **single unambiguous** Siesta match
wins. Anything unresolved is **left empty and reported** — never guessed.

**Tier 1 — exact match.**
- invite-slot: Siesta invitation where `guest_label` equals the source `guest_label`.
- attendee: Siesta attendee whose `full_name` equals the source `full_name` **and** whose
  parent invitation `guest_label` equals the source family's `guest_label`.
- Resolves 87 / 91 invite-slot seats and 10 / 17 attendee seats.

**Tier 2 — deterministic accent/case fold (auto-applied, safe).**
Normalize with `lower(translate(x, 'čćšžđČĆŠŽĐ', 'ccszdjccszdj'))` and trim. Applied only
when Tier 1 misses **and** the fold yields exactly one Siesta candidate (attendee folds are
scoped to an exact-matched family, so cross-family "Strina"/"Strina" ambiguity cannot
occur). No external extension needed (`unaccent` is available but not installed).
- Recovers `marina milosevic → Marina Milošević` (invite-slot) and, where applicable,
  family-scoped attendee case variants (e.g. `strina → Strina` within `Aleksandar Stefanović`).

**No Tier 3 trigram guessing.** Inspection showed real matches sit at 0.33–0.52 similarity
while a 1.00 match was ambiguous across families. A global threshold would both miss real
matches and seat the wrong people, so trigram fuzzy is **rejected** for auto-apply. These
become report rows for manual placement instead.

### Expected unresolved (reported, left empty)

- invite-slot: `Andreja i Tijana` (no clean Siesta equivalent — split into separate
  Siesta invitations).
- attendees (different nicknames / not present in Siesta): `Aca→Aco?`, `baba rada→Baba?`,
  `Tetka Jelena→Jelena?`, `Neša→Nešo?`, `Boban` (none), `FIlip` (none).
- **Overflow seat:** source table 2 has 11 seats (seat 11 is an invite-slot assignment);
  target table 2 has only 10. **Decided:** the script expands target table 2 to 11 seats
  (bump `seat_count` to 11, insert seat 11) so this guest is placed automatically and the
  layout mirrors `proba 1` exactly.

Net: ~98–99 of 108 assignments land automatically; ~9–10 are reported for a quick manual
pass in the seating UI.

## The migration script

A single idempotent SQL file run through the project's guarded helper
(`scripts/apply-migration.sh`: backup → verify → apply with `ON_ERROR_STOP` in one
transaction → verify, prints restore command).

**Location:** `db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql`.
This is a **data-only one-off**, not part of the fresh-install schema sequence — it is
**not** numbered `NN_*` and **not** mirrored into `db/01_schema.sql` (a fresh DB has no
such data). The `oneoff/` subfolder keeps it out of the schema-migration lineage.

**Steps (all inside the helper's single transaction):**

1. **Guard.** Assert the source plan belongs to Default and the target plan belongs to
   Siesta; abort otherwise. Assert exactly the two expected plan ids exist.
2. **Reset target (idempotency).** Clear all assignments in the target plan
   (`attendee_id = invitation_id = slot_index = NULL` for `plan_id = target`). This makes
   re-runs converge to the same state.
3. **Expand target table 2 to 11 seats (idempotent).** If target table 2 has < 11 seats,
   set its `seat_count = 11` and `INSERT ... ON CONFLICT (table_id, seat_number) DO NOTHING`
   a seat 11. Re-runs are no-ops.
4. **Copy labels** from source tables to target tables by `table_number`.
5. **Resolve + assign** invite-slot seats (Tier 1 then Tier 2), then attendee seats
   (Tier 1 then family-scoped Tier 2), updating the target seat at the matching
   `(table_number, seat_number)`. Resolution CTEs reject non-unique matches.
6. **Report.** Final `SELECT` of every source assignment that was **not** placed (reason:
   no match / ambiguous / no target seat), so the user gets an exact manual-placement list.

DB constraints relied on: `ux_seat_unique_attendee` and `ux_seat_unique_slot` are per-plan
and the target starts empty, so no uniqueness conflicts; `chk_seat_one_assignment` (XOR) is
respected because each updated seat gets exactly one assignment kind.

## Validation & rollout

This stack holds **real guest data**, so:

1. **Dry-run on a disposable copy.** Seed `guests_test` from a fresh dump of `guests`, then
   `TARGET_DB=guests_test CONFIRM=1 ./scripts/apply-migration.sh <script>`. Review the
   placed/unplaced counts and the report against the expectations above.
2. **Re-run on `guests_test`** to confirm idempotency (identical end state, no growth).
3. **Apply to live** with `./scripts/apply-migration.sh <script>` (prompts, takes a backup
   first, prints the restore command).
4. **Spot-check** in the app: open `Sala Siesta`, confirm labels and a few seats.

No automated tests exist for this; verification is the dry-run review plus the post-apply
spot-check. (The repo's typecheck/build gate does not apply — no app code changes.)

## Out of scope

- No changes to Default, `proba 1`, or any invitation/attendee data in either client.
- No new seating plan; the existing `Sala Siesta` plan is filled in place.
- No schema change; no `01_schema.sql` edit; no entity changes.

## Decisions (resolved)

- **Table-2 overflow seat:** expand target table 2 to 11 seats inside the script so the
  guest is placed automatically (layout mirrors `proba 1`).
