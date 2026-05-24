---
created: 2026-05-24T08:00:00.000Z
title: Normalize Unicode in seed script — `Potvrđen dolazak` lookup is brittle
area: db
files:
  - db/generate_seed.py:22-27
  - db/generate_seed.py
---

## Problem

```python
# db/generate_seed.py:22-27 (paraphrased)
STATUS_MAP = {
    'Nije pozvan': 'NIJE_POZVAN',
    'Pozvan': 'POZVAN',
    'Potvrđen dolazak': 'POTVRDJEN_DOLAZAK',
    'Odbijeno': 'ODBIJENO',
}

status = STATUS_MAP.get((status_raw or '').strip(), 'NIJE_POZVAN')
```

The key `'Potvrđen dolazak'` contains `đ` (U+0111, LATIN SMALL LETTER D WITH STROKE).
Depending on how the spreadsheet author entered the value — copy-pasted from another
app, typed via macOS Latin layout, or imported from a CSV with a different
normalization — the cell may contain:

- `đ` (NFC, single code point U+0111) — matches the dict key
- `d` + `̵` (NFD, two code points U+0064 U+0335) — does NOT match
- A homoglyph from another script — does NOT match

The default fallback is `'NIJE_POZVAN'`, so any unmatched row is **silently demoted
to "not invited"** with no warning. After a re-seed, stats look catastrophically
wrong and the cause is invisible (the dict literally looks the same in the editor).

Same risk for `'Odbijeno'` if a Cyrillic-keyboard user types it with a different
'o' code point, etc.

## Solution

Two-layer fix:

1. **Normalize both sides** to NFC before lookup:

   ```python
   import unicodedata

   def norm(s: str | None) -> str:
       return unicodedata.normalize('NFC', (s or '').strip())

   STATUS_MAP = {
       norm(k): v for k, v in {
           'Nije pozvan': 'NIJE_POZVAN',
           'Pozvan': 'POZVAN',
           'Potvrđen dolazak': 'POTVRDJEN_DOLAZAK',
           'Odbijeno': 'ODBIJENO',
       }.items()
   }

   status_raw = norm(cell_value)
   status = STATUS_MAP.get(status_raw, None)
   ```

2. **Fail loud on unknown status.** Replace the silent fallback with a logged
   warning and a hard error at the end of the run if any row didn't match:

   ```python
   unknown_statuses = []

   if status is None:
       unknown_statuses.append((row_idx, status_raw))
       status = 'NIJE_POZVAN'  # safe default for the row

   # at end of file processing:
   if unknown_statuses:
       print(f'WARNING: {len(unknown_statuses)} rows had unrecognized status:', file=sys.stderr)
       for row, raw in unknown_statuses[:20]:
           print(f'  row {row}: {raw!r}  ({[hex(ord(c)) for c in raw]})', file=sys.stderr)
       if '--strict' in sys.argv:
           sys.exit(1)
   ```

   The `--strict` flag lets CI catch new mystery values; manual runs still produce a
   seed file. The hex dump in the warning makes the Unicode issue diagnosable when
   it happens.

While here, apply the same `norm()` treatment to any other column read from the xlsx
that's used as a dict key — `STATUS_MAP` is the obvious one but accommodation type,
locale, etc. share the risk if they ever get a mapping table.

Add a small unit test that constructs the NFD form of `'Potvrđen dolazak'`
(`'Potvr' + 'd' + chr(0x0335) + 'en dolazak'`) and asserts the lookup still matches
after normalization.
