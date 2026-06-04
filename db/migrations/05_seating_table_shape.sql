-- 05_seating_table_shape.sql
-- Adds a per-table shape attribute to seating_table so a table can be drawn
-- as a circle (the existing default) or a rectangle (head-table layout).
--
-- Idempotent: safe to re-run. Existing rows take the 'circle' default, so every
-- table that exists today keeps rendering exactly as before.

BEGIN;

ALTER TABLE seating_table
  ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'circle';

-- Constrain the allowed values. ADD CONSTRAINT has no IF NOT EXISTS, so probe
-- the catalog first to keep this script re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_seating_table_shape'
  ) THEN
    ALTER TABLE seating_table
      ADD CONSTRAINT chk_seating_table_shape
      CHECK (shape IN ('circle', 'rectangle'));
  END IF;
END$$;

COMMIT;
