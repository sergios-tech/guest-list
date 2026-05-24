---
created: 2026-05-24T08:00:00.000Z
title: Remount AG Grid when `editType` toggles (stale editor wiring otherwise)
area: ui
files:
  - web/src/pages/Invitations.tsx:296
  - web/src/pages/Invitations.tsx (toggle handler)
---

## Problem

```tsx
// web/src/pages/Invitations.tsx:296 (paraphrased)
<AgGridReact
  rowData={data}
  columnDefs={cols}
  editType={inlineEditing ? 'fullRow' : undefined}
  onRowValueChanged={onRowValueChanged}
  /* ... */
/>
```

AG Grid Community does **not** reinitialize its editing pipeline when `editType`
changes after mount. The first render's edit mode is captured and the prop change
is silently ignored. Concretely:

- Mount with `inlineEditing=false` → grid wires cell-edit (or none) handlers.
- User toggles inline editing on → React re-renders with `editType: 'fullRow'`.
- AG Grid keeps its cell-edit wiring. Row-level commits don't fire
  `onRowValueChanged`; individual cell edits fire `onCellValueChanged` instead,
  which is unbound.
- User edits a cell and presses Enter → no PATCH dispatched, no error, the value
  reverts on next refetch.

The reverse path is just as silent: toggle off, then the grid still tries to commit
the whole row on a single cell exit, sometimes firing the wrong handler.

The bug is hard to spot because the grid "works" on first render and degrades only
after toggling — most dev sessions never toggle.

## Solution

Force a remount by keying the grid on the relevant prop:

```tsx
<AgGridReact
  key={inlineEditing ? 'inline' : 'view'}   // ← new
  rowData={data}
  columnDefs={cols}
  editType={inlineEditing ? 'fullRow' : undefined}
  /* ... */
/>
```

React unmounts and remounts the grid when the key changes, which makes AG Grid
re-read all its config props from scratch. The cost is the grid's transient state
(filter pinning, column resize, scroll position) being lost on toggle — usually
acceptable because the toggle is an explicit user action.

If you want to preserve filter/column state across the toggle, save it before the
remount:

```tsx
const gridRef = useRef<AgGridReact>(null);
const [savedState, setSavedState] = useState<GridState | null>(null);

const toggleInline = () => {
  if (gridRef.current) setSavedState(gridRef.current.api.getState());
  setInlineEditing((v) => !v);
};

<AgGridReact
  ref={gridRef}
  key={inlineEditing ? 'inline' : 'view'}
  initialState={savedState ?? undefined}
  /* ... */
/>
```

This is overkill for the current UI; ship the simple `key` change first and revisit
if users complain about lost column widths.

Add a Playwright test: load grid, toggle inline edit on, edit a cell, press Enter,
assert a PATCH was dispatched.
