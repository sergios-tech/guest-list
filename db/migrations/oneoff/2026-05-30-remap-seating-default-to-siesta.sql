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
