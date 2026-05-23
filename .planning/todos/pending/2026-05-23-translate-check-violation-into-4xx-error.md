---
created: 2026-05-23T21:33:03.454Z
title: Translate CHECK violation into 4xx error with user feedback
area: api
files:
  - api/src/modules/invitations/invitations.service.ts:45-49
  - web/src/pages/Invitations.tsx:230-235
  - db/01_schema.sql
---

## Problem

When a Postgres CHECK constraint rejects an UPDATE/INSERT, the raw `QueryFailedError`
bubbles up through TypeORM → Nest's default exception filter → **HTTP 500 Internal
Server Error**.

Reproduced during the Playwright review: changing status to `ODBIJENO` while
`adults=4, children=1` triggers `chk_declined_zero_counts`. The frontend `console.error`s
in `Invitations.tsx:233` and silently re-fetches; the cell flickers and reverts with
**no toast, snackbar, or any user-visible message**. The user is left wondering why their
edit didn't take.

Two constraints currently in play (`db/01_schema.sql`):

```sql
CONSTRAINT chk_confirmed_requires_counts
  CHECK (status <> 'POTVRDJEN_DOLAZAK' OR adults IS NOT NULL),
CONSTRAINT chk_declined_zero_counts
  CHECK (status <> 'ODBIJENO'
         OR (COALESCE(adults,0)=0 AND COALESCE(children,0)=0))
```

A CHECK violation is a **validation error**, not a server fault — should be 422 (or 400)
with a translatable message.

## Solution

**Backend:** Catch `QueryFailedError` (Postgres error code `23514` = check_violation) and
throw `BadRequestException`/`UnprocessableEntityException` with a stable error code so
the frontend can translate it.

Options:
- Add a try/catch in `InvitationsService.update()` / `create()`.
- Better: a NestJS `ExceptionFilter` that maps `QueryFailedError` codes globally
  (`23514` → 422, `23505` unique_violation → 409, `23503` foreign_key → 409).

Response shape:
```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "code": "INVITATION_DECLINED_WITH_COUNTS",
  "message": "Declined invitations must have zero adults and children."
}
```

**Frontend:** In `Invitations.tsx:230-235` and any other PATCH/POST sites, replace the
silent `console.error` with a MUI Snackbar (or the existing toast system if any) that
shows `t(\`errors.\${error.response.data.code}\`)` with a fallback to the message field.
Translation keys go in `web/src/i18n/locales/{en,sr}.json`.
