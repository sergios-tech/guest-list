-- Migration 04: persist Google Sheet row order on invitations.
--
-- Problem: GET /api/invitations sorted alphabetically (ORDER BY guest_label)
-- because the sheet's row position was parsed during sync but never stored.
-- This adds a nullable sheet_row column so the list can reproduce the
-- spreadsheet's own top-to-bottom order. Manually-created invitations leave it
-- NULL and sort after all synced rows (see InvitationsService.list).
--
-- Idempotent — safe to re-run. Keep in sync with db/01_schema.sql (fresh
-- installs declare the same column + index inline).
--
-- IMPORTANT: existing rows stay NULL until the next "Sync from Google Sheet",
-- which back-fills sheet_row for every matched/updated row. So after applying
-- this migration, run one sync per client to populate the order.

BEGIN;

ALTER TABLE invitation
  ADD COLUMN IF NOT EXISTS sheet_row smallint;

CREATE INDEX IF NOT EXISTS ix_invitation_client_sheet_row
  ON invitation(client_id, sheet_row);

COMMIT;
