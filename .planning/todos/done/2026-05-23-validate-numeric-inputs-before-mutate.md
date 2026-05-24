---
created: 2026-05-23T22:00:00.000Z
title: Guard numeric TextFields against NaN → null silent data loss
area: ui
files:
  - web/src/pages/InvitationDetail.tsx:130
  - web/src/pages/InvitationDetail.tsx:138
  - web/src/pages/InvitationDetail.tsx:146
  - web/src/pages/InvitationDetail.tsx:153
---

## Problem

The four numeric `TextField`s (plannedCount, children, adults, forecast) all use the
same pattern:

```tsx
onChange={(e) => field.onChange(
  e.target.value === '' ? null : Number(e.target.value)
)}
```

`Number('12abc')` returns `NaN`. `JSON.stringify({ adults: NaN })` produces
`{"adults":null}`. So a non-numeric paste (mobile autofill, locale comma `12,5`,
IME glitch, browser quirk) is silently coerced to `null` in the payload. With
`status = 'POTVRDJEN_DOLAZAK'` the DB CHECK `chk_confirmed_requires_counts` fires
and returns 500; with any other status, the user's prior valid count is silently
overwritten with `null`.

`type="number"` on the `<input>` blocks **most** keystrokes but not paste, autofill,
or `valueAsNumber` edge cases (Chrome accepts `12e5`, returns 1200000). Either way,
the bug is **silent** because `save.mutate` has no `onError` (separate TODO).

## Solution

Two-layer fix:

1. **Reject NaN at the input layer.** Replace the `Number()` cast with a guarded
   parse:

   ```tsx
   const toIntOrNull = (raw: string): number | null => {
     if (raw === '') return null;
     const n = Number(raw);
     return Number.isInteger(n) && n >= 0 ? n : null;
   };

   onChange={(e) => field.onChange(toIntOrNull(e.target.value))}
   ```

   Also add `inputProps={{ min: 0, max: 12, step: 1 }}` on each numeric field so the
   browser surfaces the constraint and arrow keys behave.

2. **Reject NaN at the form layer.** Add `react-hook-form` validation rules:

   ```tsx
   <Controller
     name="adults"
     control={control}
     rules={{
       min: { value: 0, message: t('errors.minZero') },
       max: { value: 12, message: t('errors.max12') },
       validate: (v) => v === null || Number.isInteger(v) || t('errors.integer'),
     }}
     render={({ field, fieldState }) => (
       <TextField
         {...field}
         type="number"
         error={!!fieldState.error}
         helperText={fieldState.error?.message}
         value={field.value ?? ''}
         onChange={(e) => field.onChange(toIntOrNull(e.target.value))}
       />
     )}
   />
   ```

   This shows inline validation before the user clicks Save, complementing the
   not-yet-built error toast for backend failures.

Apply the same pattern to `plannedCount`, `children`, `adults`, `forecast`.
