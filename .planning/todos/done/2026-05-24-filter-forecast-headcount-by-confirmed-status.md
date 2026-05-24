---
created: 2026-05-24T12:00:00.000Z
title: Add FILTER clause to `forecast_headcount` in v_invitation_stats
area: db
files:
  - db/01_schema.sql:118-133
---

## Problem

```sql
-- db/01_schema.sql:118-133
CREATE VIEW v_invitation_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'POZVAN')             AS pending,
  COUNT(*) FILTER (WHERE status = 'POTVRDJEN_DOLAZAK')  AS confirmed_invites,
  ...
  COALESCE(SUM(adults)
           FILTER (WHERE status = 'POTVRDJEN_DOLAZAK'), 0) AS confirmed_adults,
  COALESCE(SUM(COALESCE(children, 0))
           FILTER (WHERE status = 'POTVRDJEN_DOLAZAK'), 0) AS confirmed_children,
  COALESCE(SUM(confirmed_total)
           FILTER (WHERE status = 'POTVRDJEN_DOLAZAK'), 0) AS confirmed_headcount,
  COALESCE(SUM(forecast), 0)                            AS forecast_headcount  -- ← no FILTER
FROM invitation;
```

Every other count/sum in the view is gated by `FILTER (WHERE status = ...)` —
except `forecast_headcount`. So forecasts entered on rows that later become
`ODBIJENO` (declined) or are still `NIJE_POZVAN` (not invited yet) get
summed into the dashboard tile and the pinned totals row on /invitations.

Concrete failure: a planner puts `forecast=3` on a household, the household
later says no, the row's status flips to `ODBIJENO`. The planner sees the
inflated headcount on the dashboard and orders catering / arranges seating
based on a number that includes the declined party.

## Solution

Decide which semantics we want for "forecast" and apply the matching FILTER.
Most likely intent (matches the spreadsheet block this view replaces): "expected
headcount across rows that are *not yet* a hard 'no'", i.e. exclude `ODBIJENO`.

```sql
COALESCE(SUM(forecast)
         FILTER (WHERE status <> 'ODBIJENO'), 0) AS forecast_headcount
```

Alternative if forecasts should only count for still-pending invitations:

```sql
COALESCE(SUM(forecast)
         FILTER (WHERE status IN ('POZVAN', 'NIJE_POZVAN')), 0) AS forecast_headcount
```

Confirm intent with the spreadsheet/owner before picking. Same question
applies to `planned_headcount` (line 125, also unfiltered) — it may be
intentional ("planned across the whole guest list") but worth checking.

## Constraints

- Views are `CREATE OR REPLACE`-able, but **column shape changes** require
  `DROP VIEW` first if a SELECT-list column changes type. Here we only change
  the WHERE side of the FILTER, so `CREATE OR REPLACE VIEW v_invitation_stats AS ...`
  works.
- Schema lives in `db/01_schema.sql` which only runs on empty volume. For an
  existing deployment, either drop the volume (`docker compose down -v`) or
  apply the patch by hand:
  ```bash
  docker compose exec db psql -U dbuser guests \
    -c "CREATE OR REPLACE VIEW v_invitation_stats AS ..."
  ```

## Verification

- Seed two rows: one `POTVRDJEN_DOLAZAK` with forecast=2, one `ODBIJENO` with
  forecast=3.
- `SELECT forecast_headcount FROM v_invitation_stats` → currently returns 5,
  should return 2 (or 3 if we keep `NIJE_POZVAN` in scope and that's the
  fixture, etc.).
