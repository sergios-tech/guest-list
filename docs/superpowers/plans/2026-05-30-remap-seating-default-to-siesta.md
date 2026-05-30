# Remap Seating: Default → Siesta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the seating arrangement and table labels from the Default client's `proba 1` plan into the existing empty `Sala Siesta` plan in the `Siesta 2026.06.13` client, re-pointing every seat to Siesta's guest rows by name.

**Architecture:** One idempotent, self-transactional SQL file run through the project's guarded helper (`scripts/apply-migration.sh`). It resets the target plan's assignments, expands target table 2 to 11 seats, copies table labels by `table_number`, resolves each source seat's guest to the equivalent Siesta row (exact match, then deterministic accent/case fold; ambiguous/unmatched are skipped), re-points the target seat at the same `(table_number, seat_number)`, and prints a report of everything left unplaced. Validation is a dry-run on a `guests_test` copy, then a live apply with backup. No app code or schema change.

**Tech Stack:** PostgreSQL 16, `pg_trgm` (already installed), psql, Docker Compose, `scripts/apply-migration.sh`, `scripts/backup.sh`.

**Spec:** `docs/superpowers/specs/2026-05-30-remap-seating-default-to-siesta-design.md`

**Fixed identifiers (verified against the live DB):**

| Role | Client | Client id | Plan | Plan id |
|---|---|---|---|---|
| Source (read-only) | Default | `00000000-0000-0000-0000-0000000000c1` | `proba 1` | `2c8664c2-c317-4ceb-9dbd-dec957e7ff50` |
| Target (filled in place) | Siesta 2026.06.13 | `208fff41-e9bc-47e5-9b68-ba9638f3d580` | `Sala Siesta` | `7a34f9a3-0766-4c8b-a1e7-840afa91a1ea` |

**Note on testing:** This project has no automated test suite, and this is a one-off data migration — not app code. The "test" gate is the **dry-run on `guests_test`** (Task 3) plus the **idempotency re-run** (Task 4). The DB itself enforces correctness via the `seat` constraints (`chk_seat_one_assignment` XOR, `ux_seat_unique_attendee`, `ux_seat_unique_slot`); a bad mapping aborts the transaction rather than corrupting data.

---

### Task 1: Write the migration SQL

**Files:**
- Create: `db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql`

This file is a **data-only one-off**: it lives under `db/migrations/oneoff/` (NOT the numbered `NN_*` schema-migration lineage) and is **not** mirrored into `db/01_schema.sql`. A fresh DB has no such data, so fresh installs must not run it.

- [ ] **Step 1: Create the directory and the SQL file with the full script below.**

```sql
-- One-off data migration (2026-05-30): remap the seating arrangement from the
-- Default client's plan 'proba 1' into the existing empty 'Sala Siesta' plan in
-- client 'Siesta 2026.06.13'. Source (Default / proba 1) is READ-ONLY; only the
-- target plan, its tables, and its seats are written. Idempotent: re-running
-- resets the target plan's assignments first, so it converges to the same state.
--
-- Run via the guarded helper (it does NOT wrap a transaction, so this file does):
--   TARGET_DB=guests_test CONFIRM=1 ./scripts/apply-migration.sh db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql   # dry-run
--   ./scripts/apply-migration.sh db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql                                  # live

BEGIN;

-- 1) GUARD: refuse to run unless both plans exist under their expected clients.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM seating_plan
    WHERE id = '2c8664c2-c317-4ceb-9dbd-dec957e7ff50'
      AND client_id = '00000000-0000-0000-0000-0000000000c1'
  ) THEN
    RAISE EXCEPTION 'Source plan proba 1 (2c8664c2...) not found under Default client (0000...c1)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM seating_plan
    WHERE id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
      AND client_id = '208fff41-e9bc-47e5-9b68-ba9638f3d580'
  ) THEN
    RAISE EXCEPTION 'Target plan Sala Siesta (7a34f9a3...) not found under Siesta client (208fff41...)';
  END IF;
END
$guard$;

-- Accent/case fold for Serbian-latin names (no unaccent extension needed).
-- translate() handles single-char accents; replace() handles the đ→dj digraph.
CREATE FUNCTION pg_temp.fold(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $fold$
  SELECT btrim(lower(
    replace(replace(
      translate(coalesce(t, ''), 'čćšžČĆŠŽ', 'ccszccsz'),
    'đ', 'dj'), 'Đ', 'dj')
  ))
$fold$;

-- 2) RESET target assignments (idempotency): every target seat back to empty.
UPDATE seat
SET attendee_id = NULL, invitation_id = NULL, slot_index = NULL
WHERE plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea';

-- 3) EXPAND target table 2 to 11 seats to fit source table 2's 11th seat.
UPDATE seating_table
SET seat_count = 11
WHERE plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
  AND table_number = 2 AND seat_count < 11;

INSERT INTO seat (plan_id, table_id, seat_number)
SELECT st.plan_id, st.id, 11
FROM seating_table st
WHERE st.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea' AND st.table_number = 2
ON CONFLICT (table_id, seat_number) DO NOTHING;

-- 4) COPY table labels from source tables to target tables by table_number.
UPDATE seating_table tgt
SET label = src.label
FROM seating_table src
WHERE tgt.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
  AND src.plan_id = '2c8664c2-c317-4ceb-9dbd-dec957e7ff50'
  AND tgt.table_number = src.table_number;

-- Snapshot of every assigned source seat with its (table_number, seat_number).
CREATE TEMP TABLE src_seat ON COMMIT DROP AS
SELECT st.table_number,
       se.seat_number,
       se.attendee_id   AS src_attendee_id,
       se.invitation_id AS src_invitation_id,
       se.slot_index
FROM seat se
JOIN seating_table st ON st.id = se.table_id
WHERE se.plan_id = '2c8664c2-c317-4ceb-9dbd-dec957e7ff50'
  AND (se.attendee_id IS NOT NULL OR se.invitation_id IS NOT NULL);

-- 5a) Resolve each source invitation guest_label -> a single Siesta invitation.
--     Tier 1 exact guest_label, Tier 2 accent/case fold. Accept only unambiguous.
CREATE TEMP TABLE inv_map ON COMMIT DROP AS
WITH src_labels AS (
  SELECT DISTINCT i.guest_label AS src_label
  FROM seat se
  JOIN invitation i ON i.id = se.invitation_id
  WHERE se.plan_id = '2c8664c2-c317-4ceb-9dbd-dec957e7ff50'
), cand AS (
  SELECT sl.src_label, s.id AS tgt_inv_id,
         CASE WHEN s.guest_label = sl.src_label THEN 1 ELSE 2 END AS tier
  FROM src_labels sl
  JOIN invitation s
    ON s.client_id = '208fff41-e9bc-47e5-9b68-ba9638f3d580'
   AND (s.guest_label = sl.src_label
        OR pg_temp.fold(s.guest_label) = pg_temp.fold(sl.src_label))
), best AS (
  SELECT src_label, min(tier) AS bt FROM cand GROUP BY src_label
), chosen AS (
  SELECT c.src_label, c.tgt_inv_id
  FROM cand c JOIN best b ON b.src_label = c.src_label AND c.tier = b.bt
)
SELECT src_label, max(tgt_inv_id) AS tgt_inv_id
FROM chosen
GROUP BY src_label
HAVING count(DISTINCT tgt_inv_id) = 1;

-- 5b) Resolve each source attendee -> a single Siesta attendee, scoped to the
--     same family (exact guest_label). Tier 1 exact name, Tier 2 fold. Unambiguous only.
CREATE TEMP TABLE att_map ON COMMIT DROP AS
WITH src_att AS (
  SELECT DISTINCT a.id AS src_att_id, a.full_name AS src_name, i.guest_label AS src_family
  FROM seat se
  JOIN attendee a   ON a.id = se.attendee_id
  JOIN invitation i ON i.id = a.invitation_id
  WHERE se.plan_id = '2c8664c2-c317-4ceb-9dbd-dec957e7ff50'
), cand AS (
  SELECT sa.src_att_id, ta.id AS tgt_att_id,
         CASE WHEN ta.full_name = sa.src_name THEN 1 ELSE 2 END AS tier
  FROM src_att sa
  JOIN invitation ti
    ON ti.client_id = '208fff41-e9bc-47e5-9b68-ba9638f3d580'
   AND ti.guest_label = sa.src_family
  JOIN attendee ta
    ON ta.invitation_id = ti.id
   AND (ta.full_name = sa.src_name
        OR pg_temp.fold(ta.full_name) = pg_temp.fold(sa.src_name))
), best AS (
  SELECT src_att_id, min(tier) AS bt FROM cand GROUP BY src_att_id
), chosen AS (
  SELECT c.src_att_id, c.tgt_att_id
  FROM cand c JOIN best b ON b.src_att_id = c.src_att_id AND c.tier = b.bt
)
SELECT src_att_id, max(tgt_att_id) AS tgt_att_id
FROM chosen
GROUP BY src_att_id
HAVING count(DISTINCT tgt_att_id) = 1;

-- 6a) Apply invite-slot assignments onto the matching target seat position.
UPDATE seat tgt
SET invitation_id = m.tgt_inv_id,
    slot_index    = src.slot_index,
    attendee_id   = NULL
FROM src_seat src
JOIN seating_table tst
  ON tst.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
 AND tst.table_number = src.table_number
JOIN invitation si ON si.id = src.src_invitation_id      -- source (Default) row, for its label
JOIN inv_map m     ON m.src_label = si.guest_label
WHERE src.src_invitation_id IS NOT NULL
  AND tgt.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
  AND tgt.table_id = tst.id
  AND tgt.seat_number = src.seat_number;

-- 6b) Apply named-attendee assignments onto the matching target seat position.
UPDATE seat tgt
SET attendee_id   = m.tgt_att_id,
    invitation_id = NULL,
    slot_index    = NULL
FROM src_seat src
JOIN seating_table tst
  ON tst.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
 AND tst.table_number = src.table_number
JOIN att_map m ON m.src_att_id = src.src_attendee_id
WHERE src.src_attendee_id IS NOT NULL
  AND tgt.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
  AND tgt.table_id = tst.id
  AND tgt.seat_number = src.seat_number;

-- 7) SUMMARY + REPORT (printed; informational, does not abort the commit).
\echo '--- SUMMARY: assigned target seats by kind ---'
SELECT
  count(*) FILTER (WHERE attendee_id   IS NOT NULL) AS placed_attendees,
  count(*) FILTER (WHERE invitation_id IS NOT NULL) AS placed_invite_slots,
  (SELECT count(*) FROM src_seat)                   AS source_assigned_seats
FROM seat
WHERE plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea';

\echo '--- UNPLACED: source assignments with no confident match / no target seat ---'
SELECT src.table_number,
       src.seat_number,
       CASE WHEN src.src_attendee_id IS NOT NULL THEN 'attendee' ELSE 'invite-slot' END AS kind,
       coalesce(a.full_name, i.guest_label) AS source_guest,
       i.guest_label AS source_family_or_label,
       src.slot_index,
       CASE WHEN tgt.id IS NULL THEN 'no target seat at this position'
            ELSE 'no confident name match' END AS reason
FROM src_seat src
LEFT JOIN attendee a   ON a.id = src.src_attendee_id
LEFT JOIN invitation i ON i.id = coalesce(src.src_invitation_id, a.invitation_id)
LEFT JOIN seating_table tst
  ON tst.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
 AND tst.table_number = src.table_number
LEFT JOIN seat tgt
  ON tgt.plan_id = '7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
 AND tgt.table_id = tst.id
 AND tgt.seat_number = src.seat_number
WHERE tgt.id IS NULL
   OR (tgt.attendee_id IS NULL AND tgt.invitation_id IS NULL)
ORDER BY src.table_number, src.seat_number;

COMMIT;
```

- [ ] **Step 2: Verify the file was created.**

Run: `ls -l db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql`
Expected: file exists, non-zero size.

- [ ] **Step 3: Commit the script.**

```bash
git add db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql
git commit -m "feat(seating): one-off remap of proba 1 seating into Sala Siesta"
```

---

### Task 2: Build a disposable `guests_test` copy

The guarded helper points `psql` at `TARGET_DB` but does **not** create it. Build a fresh copy of the live DB to rehearse against. (Cannot use `CREATE DATABASE ... TEMPLATE guests` — the API holds open connections to `guests`; use dump/restore instead.)

**Files:** none (operational).

- [ ] **Step 1: Drop any stale copy and create an empty `guests_test`.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d postgres -c \
  "DROP DATABASE IF EXISTS guests_test;" -c \
  "CREATE DATABASE guests_test OWNER dbuser;"
```
Expected: `DROP DATABASE` (or notice) then `CREATE DATABASE`.

- [ ] **Step 2: Load a fresh dump of `guests` into `guests_test`.**

Run:
```bash
docker compose exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d guests | psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d guests_test'
```
Expected: completes with no error (psql exit 0). `pg_trgm` is a trusted extension, so the DB-owner restore recreates it without superuser.

- [ ] **Step 3: Sanity-check the copy has both plans.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests_test -P pager=off -c \
  "SELECT name, client_id, (SELECT count(*) FROM seat s WHERE s.plan_id=sp.id) AS seats
   FROM seating_plan sp ORDER BY name;"
```
Expected: `proba 1` (151 seats) and `Sala Siesta` (150 seats) both present.

---

### Task 3: Dry-run on `guests_test` and verify

**Files:** none (operational).

- [ ] **Step 1: Apply the migration to `guests_test` via the guarded helper.**

Run:
```bash
TARGET_DB=guests_test CONFIRM=1 ./scripts/apply-migration.sh \
  db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql
```
Expected: `[1/4]`…`[4/4]` steps complete; psql exits 0; the SUMMARY and UNPLACED report print.

- [ ] **Step 2: Verify placement counts.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests_test -P pager=off -c "
SELECT
  count(*) FILTER (WHERE attendee_id   IS NOT NULL) AS placed_attendees,
  count(*) FILTER (WHERE invitation_id IS NOT NULL) AS placed_invite_slots
FROM seat WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea';"
```
Expected (approximate, from the spec's name analysis): `placed_invite_slots` ≈ 88–89 (87 exact + `marina milosevic` fold + table-2 seat 11), `placed_attendees` ≈ 10–11. Total placed ≈ 98–100 of 108. The UNPLACED report should list the known leftovers (`Andreja i Tijana`, `Aca`, `baba rada`, `Tetka Jelena`, `Neša`, `Boban`, `FIlip`) and nothing surprising.

- [ ] **Step 3: Verify table labels copied and table 2 expanded.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests_test -P pager=off -c "
SELECT table_number, seat_count, label FROM seating_table
WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea' ORDER BY table_number;"
```
Expected: labels match `proba 1` (table 1 `kumovi uzice`, table 3 `drustvo 1`, …); table 2 `seat_count = 11`.

- [ ] **Step 4: Verify the source plan is untouched (read-only invariant).**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests_test -P pager=off -c "
SELECT count(*) FILTER (WHERE attendee_id IS NOT NULL) AS a,
       count(*) FILTER (WHERE invitation_id IS NOT NULL) AS i
FROM seat WHERE plan_id='2c8664c2-c317-4ceb-9dbd-dec957e7ff50';"
```
Expected: unchanged `a=17, i=91`.

- [ ] **Step 5: Verify no XOR/uniqueness constraint was silently violated (would have aborted, but confirm).**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests_test -P pager=off -c "
SELECT count(*) AS bad_xor FROM seat
WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea'
  AND attendee_id IS NOT NULL AND invitation_id IS NOT NULL;"
```
Expected: `bad_xor = 0`.

**STOP — review the SUMMARY and UNPLACED output with the user before any live apply.** If counts or the unplaced list look wrong, fix the SQL in Task 1, re-run Task 2 (rebuild copy) + Task 3.

---

### Task 4: Confirm idempotency on `guests_test`

**Files:** none (operational).

- [ ] **Step 1: Re-run the same migration against `guests_test`.**

Run:
```bash
TARGET_DB=guests_test CONFIRM=1 ./scripts/apply-migration.sh \
  db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql
```
Expected: completes with no error; SUMMARY counts identical to Task 3 Step 2.

- [ ] **Step 2: Confirm target table 2 did not gain a 12th seat and counts are stable.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests_test -P pager=off -c "
SELECT
  (SELECT seat_count FROM seating_table WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea' AND table_number=2) AS t2_seat_count,
  (SELECT count(*) FROM seat se JOIN seating_table st ON st.id=se.table_id
     WHERE st.plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea' AND st.table_number=2) AS t2_seats,
  (SELECT count(*) FROM seat WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea' AND invitation_id IS NOT NULL) AS placed_invite_slots,
  (SELECT count(*) FROM seat WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea' AND attendee_id IS NOT NULL) AS placed_attendees;"
```
Expected: `t2_seat_count = 11`, `t2_seats = 11` (not 12 — the `ON CONFLICT DO NOTHING` and `seat_count < 11` guard make the re-run a no-op), and the placed counts equal Task 3.

---

### Task 5: Apply to the live database

**Files:** none (operational). Do this only after the user approves the dry-run output.

- [ ] **Step 1: Apply to live (interactive — the helper prompts and backs up first).**

Run:
```bash
./scripts/apply-migration.sh db/migrations/oneoff/2026-05-30-remap-seating-default-to-siesta.sql
```
Type `yes` at the prompt. Expected: `[1/4]` backup of live `guests` + verify, `[3/4]` apply, `[4/4]` success; SUMMARY/UNPLACED print; the restore command is shown. **Record the printed backup file path.**

- [ ] **Step 2: Verify live counts match the dry-run.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d guests -P pager=off -c "
SELECT
  count(*) FILTER (WHERE attendee_id   IS NOT NULL) AS placed_attendees,
  count(*) FILTER (WHERE invitation_id IS NOT NULL) AS placed_invite_slots
FROM seat WHERE plan_id='7a34f9a3-0766-4c8b-a1e7-840afa91a1ea';"
```
Expected: same numbers as Task 3 Step 2.

- [ ] **Step 3: Spot-check in the app.**

Open the app, switch to the `Siesta 2026.06.13` client, open the `Sala Siesta` seating plan. Confirm table labels are present and several seats show the expected guests. Cross-check a couple against `proba 1` in the Default client.

- [ ] **Step 4: Drop the disposable copy.**

Run:
```bash
docker compose exec -T db psql -U dbuser -d postgres -c "DROP DATABASE IF EXISTS guests_test;"
```
Expected: `DROP DATABASE`.

- [ ] **Step 5: Hand the unplaced list to the user** for manual placement in the seating UI (the ~7 leftover guests with mismatched nicknames). No code change.

---

## Self-Review

- **Spec coverage:** carry labels (Task 1 step 4 ✓), carry seat assignments preserving kind (6a/6b ✓), exact+fold tiers, ambiguous/unmatched reported (inv_map/att_map `HAVING count(DISTINCT)=1` + UNPLACED report ✓), no Tier-3 trigram guessing ✓, expand table 2 (step 3 ✓), `is_active` untouched (no statement touches it ✓), read-only source (only target plan_id is written; Task 3 step 4 verifies ✓), one-off location not mirrored to `01_schema.sql` (Task 1 preamble ✓), dry-run on `guests_test` then live with backup (Tasks 2–5 ✓), idempotency (Task 4 ✓).
- **Placeholder scan:** none — every step has concrete SQL/commands and expected output. Approximate counts are labeled as ranges with their derivation, not TODOs.
- **Type/name consistency:** plan ids, client ids, temp-table names (`src_seat`, `inv_map`, `att_map`), and column names (`tgt_inv_id`, `tgt_att_id`, `src_att_id`) are used identically across 5a/5b and 6a/6b. `pg_temp.fold` defined once, referenced in both maps.
