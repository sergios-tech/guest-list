-- Migration 03 — single-tenant → multi-tenant (multi-client)
-- ===========================================================================
-- PROD-SAFE & IDEMPOTENT. Run this ONCE by hand against the LIVE volume after
-- deploying the multi-tenant code. CI does `up -d --build` only and does NOT
-- run migrations. There is no migration framework; never `down -v` in prod.
--
--   # back up first!
--   ./scripts/backup.sh
--   docker compose exec -T db psql -U dbuser -d guests < db/migrations/03_multitenancy.sql
--
-- What it does: creates the client + user_client tables, backfills ALL existing
-- data into one "Default" client, gives every existing user a membership
-- (preserving their legacy role), promotes the owner to super-admin, adds the
-- client_id columns + per-client constraints, and regroups the stats view.
--
-- Safe to re-run: every step guards with IF NOT EXISTS / ON CONFLICT / catalog
-- checks. 01_schema.sql is the matching fresh-install definition — keep in sync.
-- ===========================================================================

BEGIN;

-- Fixed UUID for the backfill "Default" client so re-runs are stable.
-- (Referenced literally below; psql \set is avoided so the file also works when
--  piped through `docker compose exec -T`.)

------------------------------------------------------------------
-- 1. New tables + columns
------------------------------------------------------------------
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS client (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text   NOT NULL,
  slug             citext UNIQUE,
  google_sheet_id  text,
  google_sheet_tab text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_client (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES client(id)   ON DELETE CASCADE,
  role       user_role NOT NULL DEFAULT 'EDITOR',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS ix_user_client_client ON user_client(client_id);

-- touch trigger for client (guarded — CREATE TRIGGER has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_client_touch') THEN
    CREATE TRIGGER trg_client_touch
      BEFORE UPDATE ON client
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

------------------------------------------------------------------
-- 2. Default client (seed sheet config from the prior global defaults)
------------------------------------------------------------------
INSERT INTO client (id, name, slug, google_sheet_id, google_sheet_tab)
VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  'Default',
  'default',
  '1gsydyLPpQH3bJoppdZoLYjlq3zKexlc-qWnuYnujeQM',  -- was GOOGLE_SHEET_ID default
  'Pozivnice'                                       -- was GOOGLE_SHEET_TAB default
)
ON CONFLICT (id) DO NOTHING;

------------------------------------------------------------------
-- 3. Backfill memberships from the legacy global role
------------------------------------------------------------------
INSERT INTO user_client (user_id, client_id, role)
SELECT id, '00000000-0000-0000-0000-0000000000c1', role
FROM app_user
ON CONFLICT (user_id, client_id) DO NOTHING;

------------------------------------------------------------------
-- 4. Promote owner(s) to platform super-admin
------------------------------------------------------------------
UPDATE app_user
   SET is_super_admin = true
 WHERE (email = 'owner@example.com' OR role = 'OWNER')
   AND is_super_admin = false;

------------------------------------------------------------------
-- 5. invitation.client_id  (add nullable → backfill → NOT NULL + FK + index)
------------------------------------------------------------------
ALTER TABLE invitation ADD COLUMN IF NOT EXISTS client_id uuid;
UPDATE invitation
   SET client_id = '00000000-0000-0000-0000-0000000000c1'
 WHERE client_id IS NULL;
ALTER TABLE invitation ALTER COLUMN client_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_client_id_fkey') THEN
    ALTER TABLE invitation
      ADD CONSTRAINT invitation_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_invitation_client ON invitation(client_id);

------------------------------------------------------------------
-- 6. seating_plan.client_id  (same three-step)
------------------------------------------------------------------
ALTER TABLE seating_plan ADD COLUMN IF NOT EXISTS client_id uuid;
UPDATE seating_plan
   SET client_id = '00000000-0000-0000-0000-0000000000c1'
 WHERE client_id IS NULL;
ALTER TABLE seating_plan ALTER COLUMN client_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seating_plan_client_id_fkey') THEN
    ALTER TABLE seating_plan
      ADD CONSTRAINT seating_plan_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_seating_plan_client ON seating_plan(client_id);

------------------------------------------------------------------
-- 7. Per-client active-plan constraint (replace the global one)
------------------------------------------------------------------
DROP INDEX IF EXISTS ux_seating_plan_one_active;
CREATE UNIQUE INDEX ux_seating_plan_one_active
  ON seating_plan (client_id) WHERE is_active = true;

------------------------------------------------------------------
-- 8. Regroup the stats view by client
------------------------------------------------------------------
-- DROP+CREATE (not CREATE OR REPLACE): adding client_id as the leading column
-- changes the view's column set, which REPLACE forbids.
DROP VIEW IF EXISTS v_invitation_stats;
CREATE VIEW v_invitation_stats AS
SELECT
  client_id,
  COUNT(*) FILTER (WHERE status = 'POZVAN')             AS pending,
  COUNT(*) FILTER (WHERE status = 'POTVRDJEN_DOLAZAK')  AS confirmed_invites,
  COUNT(*) FILTER (WHERE status = 'NIJE_POZVAN')        AS not_invited,
  COUNT(*) FILTER (WHERE status = 'ODBIJENO')           AS declined,
  COUNT(*)                                              AS total_invites,
  COALESCE(SUM(planned_count), 0)                       AS planned_headcount,
  COALESCE(SUM(adults)
           FILTER (WHERE status = 'POTVRDJEN_DOLAZAK'), 0) AS confirmed_adults,
  COALESCE(SUM(COALESCE(children, 0))
           FILTER (WHERE status = 'POTVRDJEN_DOLAZAK'), 0) AS confirmed_children,
  COALESCE(SUM(confirmed_total)
           FILTER (WHERE status = 'POTVRDJEN_DOLAZAK'), 0) AS confirmed_headcount,
  COALESCE(SUM(forecast)
           FILTER (WHERE status <> 'ODBIJENO'), 0)      AS forecast_headcount
FROM invitation
GROUP BY client_id;

COMMIT;
