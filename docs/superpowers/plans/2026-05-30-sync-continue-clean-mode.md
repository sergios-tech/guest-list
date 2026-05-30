# Sync Continue/Clean Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user choose "Continue" (current upsert) or "Clean" (delete this client's invitations, then re-import) when syncing from Google Sheets, with a typed `DELETE` confirmation gating the destructive path.

**Architecture:** Add an optional `mode` to `POST /api/google-sync/run`. In clean mode the service deletes the client's invitations inside a TypeORM transaction (FK cascade removes attendees, SET NULL frees seats), then inserts every parsed row. The frontend confirm dialog becomes a two-step mode chooser.

**Tech Stack:** NestJS 10 + TypeORM (Postgres), class-validator; React 18 + MUI + TanStack Query + react-i18next.

> **No test suite:** This repo has no Jest/Vitest (per CLAUDE.md). The per-task verification gate is the typecheck + build, run from repo root:
> ```bash
> cd api && npx tsc --noEmit && npm run build
> cd ../web && npm run build
> ```
> Both must exit 0. Do not fabricate test scripts.

---

### Task 1: Add `mode` to the API contract (DTO + result field)

**Files:**
- Modify: `api/src/modules/google-sync/google-sync.controller.ts`
- Modify: `api/src/modules/google-sync/google-sync.service.ts` (the `SyncResult` interface only)

- [ ] **Step 1: Add `deleted` to `SyncResult`**

In `google-sync.service.ts`, add the field to the interface (after `attendeesRemoved`):

```ts
export interface SyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  skipped: number;
  unknownStatuses: number;
  demotedConfirmed: number;
  attendeesCreated: number;
  attendeesRemoved: number;
  deleted: number;
  errors: SyncRowError[];
}
```

And add `deleted: 0,` to the `result` object literal initialiser inside `run()`
(next to `attendeesCreated: 0, attendeesRemoved: 0,`).

- [ ] **Step 2: Add the `RunSyncDto` and wire it into the controller**

In `google-sync.controller.ts`, add imports and the DTO at the top (after the existing imports):

```ts
import { Body } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';

class RunSyncDto {
  @IsOptional()
  @IsIn(['continue', 'clean'])
  mode?: 'continue' | 'clean';
}
```

Note: add `Body` to the existing `@nestjs/common` import list rather than a
second import line if you prefer; either compiles.

Change the `run` handler to accept and forward the body:

```ts
  @Post('run')
  @UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
  @Roles('OWNER', 'EDITOR')
  async run(
    @Req() req: Request,
    @CurrentClientId() clientId: string,
    @Body() body: RunSyncDto,
  ) {
    const userId = (req.user as any)?.id;
    if (!userId) throw new BadRequestException('Missing user');
    return this.sync.run(userId, clientId, body.mode ?? 'continue');
  }
```

- [ ] **Step 3: Typecheck + build the API**

Run: `cd api && npx tsc --noEmit && npm run build`
Expected: exits 0. (`run` now takes a 3rd arg; the next task updates the service
signature — if you build before Task 2 the call is fine because Task 2's default
param keeps arity compatible, but the service does not yet accept `mode`. Build
after Task 2 for a green tree; this step is a syntax check of the controller.)

---

### Task 2: Implement clean mode in the service

**Files:**
- Modify: `api/src/modules/google-sync/google-sync.service.ts`

- [ ] **Step 1: Inject `DataSource`**

Add to the imports from `typeorm`:

```ts
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
```

Add to the constructor parameter list (after the `oauth` param):

```ts
    private readonly oauth: GoogleOauthService,
    private readonly dataSource: DataSource,
```

- [ ] **Step 2: Change the `run` signature**

```ts
  async run(
    userId: string,
    clientId: string,
    mode: 'continue' | 'clean' = 'continue',
  ): Promise<SyncResult> {
```

- [ ] **Step 3: Branch into clean mode after parsing, before the existing classify/apply block**

The existing code, after the per-row parse loop builds `sheetRows`, currently does
`const existing = await this.invitations.find(...)` then `classifyRows(...)` then
the three apply loops. Wrap that whole existing block in `if (mode === 'continue')`
and add the clean branch. Concretely, replace from the line
`// Load every invitation for this client once, then classify in memory.`
down to the final `return result;` with:

```ts
    if (mode === 'clean') {
      // Destructive re-import: drop this client's invitations, then insert every
      // parsed row fresh. FK rules do the child cleanup — attendee.invitation_id
      // is ON DELETE CASCADE, seat.invitation_id/attendee_id are ON DELETE SET
      // NULL (seating plans/tables survive, their seats are freed). Wrapped in a
      // transaction so a hard failure rolls back and the old data is preserved;
      // per-row CHECK violations are still collected as soft errors.
      await this.dataSource.transaction(async (mgr) => {
        const del = await mgr.delete(Invitation, { clientId });
        result.deleted = del.affected ?? 0;

        for (const sr of sheetRows) {
          try {
            const { attendees, ...invRow } = sr.row;
            const entity = mgr.create(Invitation, {
              ...invRow, clientId, createdBy: userId, updatedBy: userId,
              sheetRow: sr.rowNumber,
            });
            const saved = await mgr.save(entity);
            if (attendees.length > 0) {
              await mgr.save(
                attendees.map((a) => mgr.create(Attendee, {
                  invitationId: saved.id, fullName: a.fullName, isChild: a.isChild,
                })),
              );
              result.attendeesCreated += attendees.length;
            }
            result.inserted++;
          } catch (err) {
            result.errors.push({
              rowNumber: sr.rowNumber, guestLabel: sr.row.guestLabel, message: formatRowError(err),
            });
          }
        }
      });
      return result;
    }

    // Load every invitation for this client once, then classify in memory.
```

(Leave the original continue-mode block exactly as it was, now reachable only when
`mode !== 'clean'`, ending in its existing `return result;`.)

- [ ] **Step 4: Typecheck + build the API**

Run: `cd api && npx tsc --noEmit && npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit the backend**

```bash
git add api/src/modules/google-sync/google-sync.controller.ts api/src/modules/google-sync/google-sync.service.ts
git commit -m "feat(sheet-sync): add clean re-import mode to sync endpoint"
```

---

### Task 3: i18n keys for the mode chooser (en + sr)

**Files:**
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/sr.json`

- [ ] **Step 1: Add keys to the `sync` block in `en.json`**

Insert before the existing `"completed"` key:

```json
    "modeTitle": "Sync from Google Sheet",
    "modeBody": "Choose how to sync. Continue updates your list from the sheet (new rows added, existing rows overwritten). Clean first deletes ALL invitations for this client, then re-imports from the sheet.",
    "modeContinue": "Continue",
    "modeClean": "Clean & re-import",
    "cleanConfirmTitle": "Delete all data and re-import?",
    "cleanConfirmBody": "This permanently deletes every invitation (and its attendees) for this client, then imports fresh from the sheet. Seating tables stay but seated guests are removed. Type DELETE to confirm.",
    "cleanConfirmPlaceholder": "Type DELETE",
    "cleanConfirmButton": "Delete & Sync",
    "back": "Back",
    "completedClean": "Clean sync done — {{deleted}} removed, {{inserted}} imported.",
    "completedCleanWithErrors": "Clean sync done with issues — {{deleted}} removed, {{inserted}} imported, {{errorCount}} row(s) failed.",
```

- [ ] **Step 2: Add the matching keys to the `sync` block in `sr.json`**

Insert before the existing `"completed"` key:

```json
    "modeTitle": "Sinhronizacija iz Google Sheet-a",
    "modeBody": "Izaberite način sinhronizacije. Nastavi ažurira spisak iz tabele (novi redovi se dodaju, postojeći se prepisuju). Očisti prvo briše SVE pozivnice za ovog klijenta, pa ponovo uvozi iz tabele.",
    "modeContinue": "Nastavi",
    "modeClean": "Očisti i ponovo uvezi",
    "cleanConfirmTitle": "Obrisati sve podatke i ponovo uvezti?",
    "cleanConfirmBody": "Ovo trajno briše sve pozivnice (i njihove goste) za ovog klijenta, pa uvozi iznova iz tabele. Stolovi ostaju, ali raspoređeni gosti se uklanjaju. Ukucajte DELETE za potvrdu.",
    "cleanConfirmPlaceholder": "Ukucajte DELETE",
    "cleanConfirmButton": "Obriši i sinhronizuj",
    "back": "Nazad",
    "completedClean": "Čista sinhronizacija završena — uklonjeno {{deleted}}, uvezeno {{inserted}}.",
    "completedCleanWithErrors": "Čista sinhronizacija završena uz greške — uklonjeno {{deleted}}, uvezeno {{inserted}}, {{errorCount}} reda nije uspelo.",
```

- [ ] **Step 3: Validate JSON parses**

Run: `cd web && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/sr.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

---

### Task 4: Two-step mode dialog in the frontend

**Files:**
- Modify: `web/src/components/SyncFromGoogleButton.tsx`

- [ ] **Step 1: Extend the `SyncResult` interface and dialog state**

Add `deleted: number;` to the `SyncResult` interface (after `demotedConfirmed`).

Replace the `confirmOpen` boolean state with a step enum and a confirm-input state.
Replace:

```ts
  const [confirmOpen, setConfirmOpen] = useState(false);
```

with:

```ts
  const [dialogStep, setDialogStep] = useState<'closed' | 'choose' | 'confirmClean'>('closed');
  const [cleanConfirmText, setCleanConfirmText] = useState('');

  const closeDialog = () => {
    setDialogStep('closed');
    setCleanConfirmText('');
  };
```

- [ ] **Step 2: Make `runSync` take a `mode` argument**

Replace the `runSync` mutation's `mutationFn` and success handler:

```ts
  const runSync = useMutation({
    mutationFn: async (mode: 'continue' | 'clean') =>
      (await api.post<SyncResult>('/google-sync/run', { mode })).data,
    onSuccess: (data, mode) => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: qk.statsOverview(currentClientId!) });
      closeDialog();
      if (data.errors.length > 0) {
        snackbar.show(
          t(mode === 'clean' ? 'sync.completedCleanWithErrors' : 'sync.completedWithErrors', {
            deleted: data.deleted,
            inserted: data.inserted,
            updated: data.updated,
            renamed: data.renamed,
            errorCount: data.errors.length,
          }),
          'warning',
        );
        setErrorDetail(data.errors);
      } else {
        snackbar.show(
          t(mode === 'clean' ? 'sync.completedClean' : 'sync.completed', {
            deleted: data.deleted,
            inserted: data.inserted,
            updated: data.updated,
            renamed: data.renamed,
          }),
          'success',
        );
      }
    },
    onError: (err) => snackbar.show(apiErrorMessage(err, t), 'error'),
  });
```

- [ ] **Step 3: Open the dialog at the chooser step**

Change the sync trigger button's `onClick` from `() => setConfirmOpen(true)` to
`() => setDialogStep('choose')`.

- [ ] **Step 4: Replace the confirm `Dialog` with the two-step dialog**

Replace the entire existing confirm `<Dialog open={confirmOpen} …>…</Dialog>`
block (the one with `confirmTitle`/`confirmBody`) with:

```tsx
      <Dialog open={dialogStep !== 'closed'} onClose={closeDialog} maxWidth="sm" fullWidth>
        {dialogStep === 'choose' ? (
          <>
            <DialogTitle>{t('sync.modeTitle')}</DialogTitle>
            <DialogContent>
              <DialogContentText>{t('sync.modeBody')}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeDialog}>{t('invitation.cancel')}</Button>
              <Button
                color="error"
                onClick={() => setDialogStep('confirmClean')}
                disabled={runSync.isPending}
              >
                {t('sync.modeClean')}
              </Button>
              <Button
                variant="contained"
                onClick={() => runSync.mutate('continue')}
                disabled={runSync.isPending}
              >
                {runSync.isPending ? t('sync.syncing') : t('sync.modeContinue')}
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogTitle>{t('sync.cleanConfirmTitle')}</DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>{t('sync.cleanConfirmBody')}</DialogContentText>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={cleanConfirmText}
                onChange={(e) => setCleanConfirmText(e.target.value)}
                placeholder={t('sync.cleanConfirmPlaceholder')}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setDialogStep('choose'); setCleanConfirmText(''); }}>
                {t('sync.back')}
              </Button>
              <Button
                variant="contained"
                color="error"
                onClick={() => runSync.mutate('clean')}
                disabled={cleanConfirmText !== 'DELETE' || runSync.isPending}
              >
                {runSync.isPending ? t('sync.syncing') : t('sync.cleanConfirmButton')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
```

- [ ] **Step 5: Add the `TextField` import**

Add `TextField` to the existing `@mui/material` import list.

- [ ] **Step 6: Build the web app**

Run: `cd web && npm run build`
Expected: exits 0 (`tsc -b && vite build`).

- [ ] **Step 7: Full both-app verification (CLAUDE.md gate)**

Run:
```bash
cd api && npx tsc --noEmit && npm run build
cd ../web && npm run build
```
Expected: both exit 0.

- [ ] **Step 8: Commit the frontend**

```bash
git add web/src/components/SyncFromGoogleButton.tsx web/src/i18n/locales/en.json web/src/i18n/locales/sr.json
git commit -m "feat(sheet-sync): continue/clean mode chooser dialog with typed delete confirm"
```

---

## Self-Review notes

- **Spec coverage:** API `mode` + `deleted` (Task 1), transactional clean delete-then-insert (Task 2), i18n (Task 3), two-step dialog with `DELETE` gate + default Continue (Task 4). All spec sections mapped.
- **Type consistency:** `SyncResult.deleted` added in both backend (Task 1) and frontend interface (Task 4); `runSync.mutate` arg is `'continue' | 'clean'` matching `RunSyncDto`; `run()` default param keeps the existing call sites valid.
- **Placeholders:** none — all code shown in full.
