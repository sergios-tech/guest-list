-- Guest list — schema
-- Postgres 16+

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy search on guest_label

------------------------------------------------------------------
-- enums
------------------------------------------------------------------
CREATE TYPE rsvp_status AS ENUM (
  'NIJE_POZVAN',         -- Not invited
  'POZVAN',              -- Invited (waiting for response)
  'ODBIJENO',            -- Declined
  'POTVRDJEN_DOLAZAK'    -- Confirmed
);

CREATE TYPE accommodation_type AS ENUM (
  'NONE',
  'SIESTA_SINGLE',
  'SIESTA_DOUBLE',
  'SIESTA_APARTMENT',
  'ARIA'
);

CREATE TYPE user_role AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

------------------------------------------------------------------
-- users (multi-user auth)
------------------------------------------------------------------
CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,        -- requires citext ext below
  password_hash   text   NOT NULL,
  display_name    text   NOT NULL,
  role            user_role NOT NULL DEFAULT 'EDITOR',
  locale          text   NOT NULL DEFAULT 'sr',  -- 'sr' | 'en'
  -- Soft-delete: hard DELETE would null the invitation audit columns
  -- (created_by/updated_by ON DELETE SET NULL). Setting deleted_at preserves
  -- the audit trail while letting application code filter inactive users.
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_app_user_active ON app_user (id) WHERE deleted_at IS NULL;

------------------------------------------------------------------
-- google credentials (per-user OAuth refresh tokens for Sheets sync)
------------------------------------------------------------------
-- Refresh tokens are encrypted at rest with AES-256-GCM. The API decrypts
-- on demand to drive googleapis. Access tokens are NEVER stored — the
-- google-auth-library refreshes them in memory before each Sheets call.
CREATE TABLE user_google_credential (
  user_id            uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  refresh_token_enc  text   NOT NULL,                       -- base64 ciphertext
  refresh_token_iv   text   NOT NULL,                       -- base64 12-byte IV
  refresh_token_tag  text   NOT NULL,                       -- base64 16-byte GCM tag
  google_account     text,                                   -- email of connected identity (display only)
  connected_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- trg_user_google_credential_touch is created below alongside the other
-- touch_updated_at triggers (the trigger function is defined further down).

------------------------------------------------------------------
-- invitations (one row = one household / party invite)
------------------------------------------------------------------
CREATE TABLE invitation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_label      text NOT NULL,
  planned_count    smallint CHECK (planned_count BETWEEN 0 AND 12),
  status           rsvp_status NOT NULL DEFAULT 'NIJE_POZVAN',
  adults           smallint CHECK (adults BETWEEN 0 AND 12),
  children         smallint CHECK (children BETWEEN 0 AND 12),
  confirmed_total  smallint GENERATED ALWAYS AS
                   (COALESCE(adults,0) + COALESCE(children,0)) STORED,
  forecast         smallint CHECK (forecast BETWEEN 0 AND 12),
  response_date    date,
  accommodation    accommodation_type NOT NULL DEFAULT 'NONE',
  decline_reason   text,
  notes            text,
  created_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 0,   -- optimistic concurrency (TypeORM @VersionColumn)

  -- invariants
  CONSTRAINT chk_confirmed_requires_counts
    CHECK (status <> 'POTVRDJEN_DOLAZAK' OR adults IS NOT NULL),
  CONSTRAINT chk_declined_zero_counts
    CHECK (status <> 'ODBIJENO'
           OR (COALESCE(adults,0)=0 AND COALESCE(children,0)=0))
);

CREATE INDEX ix_invitation_status        ON invitation(status);
CREATE INDEX ix_invitation_accommodation ON invitation(accommodation)
  WHERE accommodation <> 'NONE';
CREATE INDEX ix_invitation_guest_label_trgm
  ON invitation USING gin (guest_label gin_trgm_ops);

------------------------------------------------------------------
-- attendees (named individuals within an invitation)
------------------------------------------------------------------
CREATE TABLE attendee (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id  uuid NOT NULL REFERENCES invitation(id) ON DELETE CASCADE,
  full_name      text NOT NULL,
  is_child       boolean NOT NULL DEFAULT false,
  dietary_notes  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_attendee_invitation ON attendee(invitation_id);

------------------------------------------------------------------
-- updated_at triggers
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invitation_touch
  BEFORE UPDATE ON invitation
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_attendee_touch
  BEFORE UPDATE ON attendee
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_user_touch
  BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_user_google_credential_touch
  BEFORE UPDATE ON user_google_credential
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

------------------------------------------------------------------
-- seating plans (table layout for the reception)
------------------------------------------------------------------
CREATE TABLE seating_plan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT false,
  notes           text,
  created_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 0       -- TypeORM @VersionColumn
);

-- At most one plan can be the "active" one at a time. Partial unique index:
-- the constraint applies only to rows with is_active = true, so unlimited
-- inactive plans coexist.
CREATE UNIQUE INDEX ux_seating_plan_one_active
  ON seating_plan (is_active) WHERE is_active = true;

CREATE TRIGGER trg_seating_plan_touch
  BEFORE UPDATE ON seating_plan
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE seating_table (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES seating_plan(id) ON DELETE CASCADE,
  table_number    smallint NOT NULL CHECK (table_number BETWEEN 1 AND 200),
  seat_count      smallint NOT NULL CHECK (seat_count BETWEEN 1 AND 30),
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_id, table_number),
  -- Composite uniqueness so `seat` can use a composite FK to guarantee a seat
  -- can never reference a table from a different plan.
  UNIQUE (id, plan_id)
);

CREATE INDEX ix_seating_table_plan ON seating_table(plan_id);

CREATE TRIGGER trg_seating_table_touch
  BEFORE UPDATE ON seating_table
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- One row per physical seat. Materialised on table creation so the UI can
-- read the full layout in one query and every seat has a stable UUID for
-- drag-and-drop.
CREATE TABLE seat (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL,
  table_id        uuid NOT NULL,
  seat_number     smallint NOT NULL CHECK (seat_number BETWEEN 1 AND 30),
  -- A seat is either empty, or holds a named attendee, or holds a slot of an
  -- invitation (e.g. "Guest 3 of Perišić"). The check below enforces XOR.
  attendee_id     uuid REFERENCES attendee(id) ON DELETE SET NULL,
  invitation_id   uuid REFERENCES invitation(id) ON DELETE SET NULL,
  slot_index      smallint CHECK (slot_index IS NULL OR slot_index BETWEEN 1 AND 12),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Composite FK: a seat's plan must match its table's plan.
  FOREIGN KEY (table_id, plan_id)
    REFERENCES seating_table(id, plan_id) ON DELETE CASCADE,

  UNIQUE (table_id, seat_number),

  CONSTRAINT chk_seat_one_assignment CHECK (
    (attendee_id IS NULL AND invitation_id IS NULL AND slot_index IS NULL)
    OR (attendee_id IS NOT NULL AND invitation_id IS NULL AND slot_index IS NULL)
    OR (attendee_id IS NULL AND invitation_id IS NOT NULL AND slot_index IS NOT NULL)
  )
);

CREATE INDEX ix_seat_plan  ON seat(plan_id);
CREATE INDEX ix_seat_table ON seat(table_id);

-- An attendee sits at most once *within a plan* (different plans may seat the
-- same attendee independently).
CREATE UNIQUE INDEX ux_seat_unique_attendee
  ON seat (plan_id, attendee_id) WHERE attendee_id IS NOT NULL;

-- An invitation slot is used at most once within a plan.
CREATE UNIQUE INDEX ux_seat_unique_slot
  ON seat (plan_id, invitation_id, slot_index) WHERE invitation_id IS NOT NULL;

CREATE TRIGGER trg_seat_touch
  BEFORE UPDATE ON seat
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- When an invitation is deleted, the FK on seat.invitation_id is ON DELETE
-- SET NULL — but that would leave slot_index non-NULL, violating
-- chk_seat_one_assignment. Clear the assignment fields before the FK fires.
CREATE OR REPLACE FUNCTION clear_seats_on_invitation_delete() RETURNS trigger AS $$
BEGIN
  UPDATE seat
     SET invitation_id = NULL, slot_index = NULL
   WHERE invitation_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invitation_clear_seats
  BEFORE DELETE ON invitation
  FOR EACH ROW EXECUTE FUNCTION clear_seats_on_invitation_delete();

------------------------------------------------------------------
-- stats view (replaces the K/L summary block in the sheet)
------------------------------------------------------------------
CREATE VIEW v_invitation_stats AS
SELECT
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
  -- Forecasts on declined rows must not inflate the headcount used to size
  -- catering/seating. Exclude ODBIJENO; pending and confirmed both count.
  COALESCE(SUM(forecast)
           FILTER (WHERE status <> 'ODBIJENO'), 0)      AS forecast_headcount
FROM invitation;
