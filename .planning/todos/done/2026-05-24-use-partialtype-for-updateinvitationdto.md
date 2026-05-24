---
created: 2026-05-24T12:00:00.000Z
title: Wrap `UpdateInvitationDto` in `PartialType` so PATCH is actually partial
area: api
files:
  - api/src/modules/invitations/dto.ts:10-42
---

## Problem

```ts
// api/src/modules/invitations/dto.ts:10-42
export class CreateInvitationDto {
  @IsString() @MaxLength(200)
  guestLabel!: string;                       // ← not @IsOptional()

  @IsOptional() @IsInt() @Min(0) @Max(12)
  plannedCount?: number;
  // ... all other fields @IsOptional()
}

export class UpdateInvitationDto extends CreateInvitationDto {}
```

`UpdateInvitationDto` inherits **every validator** from `CreateInvitationDto`
unchanged — including `guestLabel`'s `@IsString()` without `@IsOptional()`.
Combined with the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
(`api/src/main.ts:12-16`), any PATCH that omits `guestLabel` returns
`400 Bad Request` with `["guestLabel should not be empty","guestLabel must be a string"]`.

Why this is latent today: every existing client sends a full record.

- `web/src/pages/InvitationDetail.tsx:62-66` spreads the whole form (`...data`)
  into the body — `guestLabel` always present.
- `web/src/pages/Invitations.tsx:218-227` (inline-edit) explicitly enumerates
  `guestLabel: row.guestLabel` even when the user only changed `status`.

The moment we introduce any of:

- A single-cell PATCH (AG Grid `editType: 'fullRow'` → `editType: 'cell'`)
- A mobile client that sends only the changed field
- A future bulk operation that toggles status across many rows
- An audit/telemetry hook that re-saves invitations with a subset of fields

...the API responds 400 and the operation silently fails.

## Solution

Use `PartialType` from `@nestjs/mapped-types` (already a transitive dep
through `@nestjs/common`'s `@nestjs/swagger`-free path; if not present,
`npm i @nestjs/mapped-types`):

```ts
import { PartialType } from '@nestjs/mapped-types';
// ...
export class UpdateInvitationDto extends PartialType(CreateInvitationDto) {}
```

`PartialType` returns a new class where every property has `@IsOptional()`
appended to its existing validators, so `guestLabel` becomes optional on
update while keeping `@IsString() @MaxLength(200)` when present.

Apply the same fix to `attendees.module.ts` if/when `UpdateAttendeeDto`
needs to differ from `CreateAttendeeDto` — currently `UpdateAttendeeDto` is
hand-written with all fields `@IsOptional()`, so it's correct by accident.

## Verification

- After the change: `curl -X PATCH /api/invitations/:id -d '{"status":"POZVAN"}'`
  with a valid Bearer token → 200 (currently 400).
- Existing tests still pass — adding `@IsOptional()` to a field never tightens
  validation, only relaxes it.

## Related

- `2026-05-23-fix-invitationdetail-edit-returns-400.md` — opposite problem
  (extra fields in PATCH body, not missing ones).
