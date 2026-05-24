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
