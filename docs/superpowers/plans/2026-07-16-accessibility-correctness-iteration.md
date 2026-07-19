# Accessibility and Correctness Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a centered, high-readability filing locator with optional automatic single-page focus while preserving keyboard navigation, correcting exact search selection and physical columns, canonicalizing inventory safely, and adding regression tests.

**Architecture:** Extract binder, search, inventory, and settings behavior into pure TypeScript modules with explicit interfaces. Keep `App.tsx` as the orchestrator, add two focused React components, and extend the existing binder renderer with a four-column presentation instead of rewriting the application.

**Tech Stack:** React 18, TypeScript 5, Vite 7, Vitest, jsdom, Testing Library, browser localStorage.

## Global Constraints

- Remain a personal, local-first Star Wars: Unlimited collection organizer.
- Preserve existing inventory data and create a one-time pre-migration backup.
- Preserve current arrow-key selection, edge wrapping, comma/period navigation, and `+`/`-` quantity shortcuts.
- Continue supporting JSON, CSV, and XLSX imports.
- Physical columns displayed to the user are always 1-4; spread columns 1-8 are internal navigation state.
- `Automatically open enlarged page after selecting a card` defaults to enabled and persists locally.
- Cloud synchronization, accounts, multi-user support, deck building, and social features remain out of scope.

## File Structure

- Create `src/core/types.ts`: shared card, set, inventory, parsed-catalog, and selection types.
- Create `src/core/binder.ts`: binder coordinates, spread/page conversions, and keyboard movement.
- Create `src/core/search.ts`: stable search suggestions, ranking, and submission selection.
- Create `src/core/inventory.ts`: canonical catalog index, quota enforcement, imports, and migration.
- Create `src/core/settings.ts`: settings defaults, parsing, reading, and writing.
- Create `src/components/LocatorPanel.tsx`: centered locator and quantity controls.
- Create `src/components/SettingsModal.tsx`: accessible settings dialog.
- Create colocated `*.test.ts` and `*.test.tsx` files for each module/component.
- Modify `src/App.tsx`: consume extracted modules and coordinate selection, settings, focus mode, imports, and migration.
- Modify `index.html`: locator, settings, focus-view, and responsive styles.
- Modify `package.json`, `package-lock.json`, `vite.config.ts`, `eslint.config.js`, `.prettierignore`, and `README.md` for tooling and documentation.

---

### Task 1: Test Foundation and Binder Geometry

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `src/core/types.ts`
- Create: `src/core/binder.test.ts`
- Create: `src/core/binder.ts`
- Modify: `src/App.tsx:4-17,142-167,1286-1363`

**Interfaces:**
- Produces `Card`, `Inventory`, `SetKey`, `SetMeta`, `ActiveSelection`, and `BinderPosition` from `src/core/types.ts`.
- Produces `binderLayout(number)`, `getSpreadCoords(page,row,column)`, `numberFromPagePosition(page,row,column)`, `pageToSpread(page)`, `spreadToPrimaryPage(spread)`, and `moveBinderSelection(selection,direction,totalPages)` from `src/core/binder.ts`.
- Later tasks consume these shared types and geometry functions.

- [ ] **Step 1: Add the test runner dependencies and scripts**

Run:

```powershell
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event
```

Update `package.json` scripts to include:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Update `vite.config.ts` to:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
})
```

- [ ] **Step 2: Write failing binder geometry and movement tests**

Create `src/core/binder.test.ts` with explicit cases:

```ts
import { describe, expect, it } from 'vitest'
import {
  binderLayout,
  getSpreadCoords,
  moveBinderSelection,
  pageToSpread,
} from './binder'

describe('binder geometry', () => {
  it.each([
    [1, { page: 1, row: 1, column: 1 }],
    [4, { page: 1, row: 1, column: 4 }],
    [5, { page: 1, row: 2, column: 1 }],
    [12, { page: 1, row: 3, column: 4 }],
    [13, { page: 2, row: 1, column: 1 }],
  ])('maps card %i to its physical position', (number, expected) => {
    expect(binderLayout(number)).toEqual(expected)
  })

  it('keeps physical and spread columns distinct', () => {
    expect(getSpreadCoords(1, 1, 1)).toEqual({ spreadCol: 5, spreadRow: 1 })
    expect(binderLayout(1).column).toBe(1)
  })

  it('moves right from the final column to the adjacent physical page', () => {
    const selection = { ...binderLayout(16), number: 16 }
    expect(moveBinderSelection(selection, 'right', 10)).toMatchObject({
      number: 25,
      page: 3,
      row: 1,
      column: 1,
    })
  })

  it('preserves vertical spread wrapping', () => {
    const selection = { ...binderLayout(24), number: 24 }
    expect(moveBinderSelection(selection, 'down', 10)).toMatchObject({
      page: 4,
      row: 1,
      column: 4,
    })
  })

  it('does not move beyond the first or last spread', () => {
    const first = { ...binderLayout(1), number: 1 }
    expect(moveBinderSelection(first, 'left', 1)).toEqual(first)
    expect(pageToSpread(1)).toBe(0)
  })
})
```

- [ ] **Step 3: Run the binder tests and verify RED**

Run: `npm test -- src/core/binder.test.ts`

Expected: FAIL because `src/core/binder.ts` does not exist.

- [ ] **Step 4: Implement the shared types and binder module**

Create `src/core/types.ts`:

```ts
export type Card = {
  Name: string
  Subtitle?: string
  Number: number
  Aspects?: string[]
  Type?: string
  Rarity?: string
  MarketPrice?: number
  Set: string
}

export type Inventory = Record<number, number>
export type SetKey = string
export type SetMeta = { key: string; label: string; file: string }
export type BinderPosition = { number: number; page: number; row: number; column: number }
export type ActiveSelection = BinderPosition & {
  card: Card
  spreadCol: number
  spreadRow: number
}
```

Create `src/core/binder.ts` by moving the existing coordinate functions and the current movement algorithm out of `App.tsx`. Export this API:

```ts
import type { BinderPosition } from './types'

export type MoveDirection = 'left' | 'right' | 'up' | 'down'

export function binderLayout(number: number): Omit<BinderPosition, 'number'>
export function getSpreadCoords(page: number, row: number, column: number): {
  spreadCol: number
  spreadRow: number
}
export function numberFromPagePosition(page: number, row: number, column: number): number
export function pageToSpread(page: number): number
export function spreadToPrimaryPage(spread: number): number
export function moveBinderSelection(
  selection: BinderPosition,
  direction: MoveDirection,
  totalPages: number,
): BinderPosition
```

`moveBinderSelection` must reproduce the existing 8-column spread navigation before converting the result back to physical page coordinates. When a movement would leave the valid spread range, return the original selection unchanged.

- [ ] **Step 5: Run the binder test and full typecheck**

Run: `npm test -- src/core/binder.test.ts`

Expected: PASS with five binder behavior groups.

Run: `npx tsc --noEmit`

Expected: PASS after replacing the duplicate geometry helpers and movement body in `App.tsx` with imports from `src/core/binder.ts`.

- [ ] **Step 6: Commit binder extraction**

```powershell
git add package.json package-lock.json vite.config.ts src/core src/App.tsx
git commit -m "test: cover binder geometry and navigation"
```

---

### Task 2: Stable Search Identity and Ranking

**Files:**
- Create: `src/core/search.test.ts`
- Create: `src/core/search.ts`
- Modify: `src/App.tsx:675-785,801-803,1083-1262`

**Interfaces:**
- Consumes `Card` and `SetKey` from `src/core/types.ts`.
- Produces `SearchCatalog`, `SearchSuggestion`, `buildSearchSuggestions(query,catalogs,currentSetKey,limit)`, and `submittedSuggestion(suggestions,highlightIndex)`.
- `App.tsx` selects cards only from `SearchSuggestion.setKey` and `SearchSuggestion.baseNumber`.

- [ ] **Step 1: Write failing search behavior tests**

Create `src/core/search.test.ts` with catalogs containing both Darth Vader cards and Brain Invaders:

```ts
import { describe, expect, it } from 'vitest'
import { buildSearchSuggestions, submittedSuggestion } from './search'

const catalogs = [
  {
    setKey: 'SOR',
    cards: [
      { Name: 'Darth Vader', Subtitle: 'Dark Lord of the Sith', Number: 10, Type: 'Leader', Set: 'SOR' },
      { Name: 'Darth Vader', Subtitle: 'Commanding the First Legion', Number: 87, Type: 'Unit', Set: 'SOR' },
    ],
    printingNumbersByBase: new Map([[10, [10]], [87, [87, 351]]]),
    baseByPrintingNumber: new Map([[10, 10], [87, 87], [351, 87]]),
  },
  {
    setKey: 'TWI',
    cards: [{ Name: 'Brain Invaders', Number: 255, Type: 'Unit', Set: 'TWI' }],
    printingNumbersByBase: new Map([[255, [255]]]),
    baseByPrintingNumber: new Map([[255, 255]]),
  },
]

describe('search suggestions', () => {
  it('keeps duplicate names as distinct stable card identities', () => {
    const results = buildSearchSuggestions('Darth Vader', catalogs, 'SOR')
    expect(results.map(result => result.baseNumber)).toEqual([10, 87])
  })

  it('ranks intentional word starts before incidental normalized substrings', () => {
    const results = buildSearchSuggestions('Vader', catalogs, 'SOR')
    expect(results[0]).toMatchObject({ setKey: 'SOR', baseNumber: 10 })
    expect(results.at(-1)?.name).toBe('Brain Invaders')
  })

  it('resolves an alternate printing number to its base card', () => {
    expect(buildSearchSuggestions('351', catalogs, 'SOR')[0]).toMatchObject({
      setKey: 'SOR',
      baseNumber: 87,
    })
  })

  it('submits the highlighted result and falls back to the first', () => {
    const results = buildSearchSuggestions('Darth Vader', catalogs, 'SOR')
    expect(submittedSuggestion(results, 1)?.baseNumber).toBe(87)
    expect(submittedSuggestion(results, 99)?.baseNumber).toBe(10)
  })
})
```

- [ ] **Step 2: Run the search tests and verify RED**

Run: `npm test -- src/core/search.test.ts`

Expected: FAIL because `src/core/search.ts` does not exist.

- [ ] **Step 3: Implement stable search suggestions**

Create `src/core/search.ts` with these public types:

```ts
import type { Card, SetKey } from './types'

export type SearchCatalog = {
  setKey: SetKey
  cards: Card[]
  printingNumbersByBase: Map<number, number[]>
  baseByPrintingNumber: Map<number, number>
}

export type SearchSuggestion = {
  kind: 'name' | 'number'
  setKey: SetKey
  baseNumber: number
  name: string
  subtitle?: string
  type?: string
  printingNumbers: number[]
  label: string
}
```

Implement ranking with a numeric score: exact printing number first, current set before other sets, exact normalized name, word-start name, substring name, subtitle match, then incidental normalized substring. Sort ties by name, subtitle, and base number. Deduplicate only by `${setKey}:${baseNumber}`.

Implement submission as:

```ts
export function submittedSuggestion(
  suggestions: SearchSuggestion[],
  highlightIndex: number,
): SearchSuggestion | null {
  if (!suggestions.length) return null
  return suggestions[highlightIndex] ?? suggestions[0]
}
```

- [ ] **Step 4: Run search tests and verify GREEN**

Run: `npm test -- src/core/search.test.ts`

Expected: PASS with four search tests.

- [ ] **Step 5: Integrate search into App**

Replace the component-local `Suggestion` type and `suggestions` memo with `buildSearchSuggestions`. Replace `baseByName`, `goFromName`, `goFromNumberString`, and `onChoose` branching with one selection path:

```ts
function chooseSuggestion(suggestion: SearchSuggestion) {
  if (suggestion.setKey !== setKey) {
    setPendingSelection({
      setKey: suggestion.setKey,
      baseNumber: suggestion.baseNumber,
    })
    setSetKey(suggestion.setKey)
    setQuery('')
    setOpenSug(false)
    return
  }
  selectCardByNumber(suggestion.baseNumber)
  setQuery('')
  setOpenSug(false)
}

function submitSearch() {
  const suggestion = submittedSuggestion(suggestions, highlightIdx)
  if (!suggestion) {
    setError(query.trim() ? 'No matching card found.' : 'Enter a name or number.')
    return
  }
  chooseSuggestion(suggestion)
}
```

Use `submitSearch` from Enter and the search icon. Change pending selection to `{ setKey: SetKey; baseNumber: number }` and resolve it by number after the destination catalog loads.

- [ ] **Step 6: Run search, binder, and type tests**

Run: `npm test -- src/core/search.test.ts src/core/binder.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS with no `baseByName` or `goFromName` references.

- [ ] **Step 7: Commit exact search selection**

```powershell
git add src/core/search.ts src/core/search.test.ts src/App.tsx
git commit -m "fix: select exact cards from search results"
```

---

### Task 3: Canonical Inventory, Imports, and Silent Migration

**Files:**
- Create: `src/core/inventory.test.ts`
- Create: `src/core/inventory.ts`
- Modify: `src/App.tsx:158-160,420-646,805-815,1399-1423,1514-1685,1845-1949`

**Interfaces:**
- Consumes `Card`, `Inventory`, `SetKey` from `src/core/types.ts`.
- Produces `CanonicalCardRef`, `CanonicalCatalog`, `quotaForType`, `canonicalizeInventory`, `applyImportedInventories`, and `migrateLegacyInventories`.
- All UI inventory reads and writes use base numbers only after this task.

- [ ] **Step 1: Write failing canonicalization and migration tests**

Create `src/core/inventory.test.ts` using a small `MemoryStorage` implementation of the browser `Storage` subset. Cover:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyImportedInventories,
  canonicalizeInventory,
  migrateLegacyInventories,
} from './inventory'

const catalog = new Map([
  ['SOR:10', { setKey: 'SOR', printingNumber: 10, baseNumber: 10, type: 'Leader' }],
  ['SOR:87', { setKey: 'SOR', printingNumber: 87, baseNumber: 87, type: 'Unit' }],
  ['SOR:351', { setKey: 'SOR', printingNumber: 351, baseNumber: 87, type: 'Unit' }],
  ['SHD:1', { setKey: 'SHD', printingNumber: 1, baseNumber: 1, type: 'Base' }],
])

it('combines printings at the base card and caps after aggregation', () => {
  expect(canonicalizeInventory('SOR', { 87: 2, 351: 2 }, catalog)).toEqual({ 87: 3 })
})

it('uses the destination set quota during cross-set merge', () => {
  const result = applyImportedInventories(
    { SHD: { 1: 1 } },
    { SHD: { 1: 2 } },
    'merge',
    catalog,
  )
  expect(result.inventories.SHD).toEqual({ 1: 1 })
})

it('skips unknown and malformed entries', () => {
  const result = canonicalizeInventory('SOR', { 87: 1, 9999: 3, [-1]: 2 }, catalog)
  expect(result).toEqual({ 87: 1 })
})

it('backs up and migrates legacy data only once', () => {
  const storage = new MemoryStorage({
    'inv:SOR': JSON.stringify({ 87: 2, 351: 2 }),
  })
  const first = migrateLegacyInventories(storage, ['SOR'], catalog)
  expect(first.SOR).toEqual({ 87: 3 })
  expect(storage.getItem('inv:migration:v2:backup')).toContain('351')
  expect(storage.getItem('inv:schema-version')).toBe('2')

  storage.setItem('inv:SOR', JSON.stringify({ 87: 1 }))
  expect(migrateLegacyInventories(storage, ['SOR'], catalog).SOR).toEqual({ 87: 1 })
})
```

The test file must include a complete `MemoryStorage` class implementing `getItem`, `setItem`, `removeItem`, `key`, `length`, and `clear` over a `Map<string,string>`.

- [ ] **Step 2: Run inventory tests and verify RED**

Run: `npm test -- src/core/inventory.test.ts`

Expected: FAIL because `src/core/inventory.ts` does not exist.

- [ ] **Step 3: Implement canonical inventory operations**

Create `src/core/inventory.ts` with:

```ts
import type { Inventory, SetKey } from './types'

export type CanonicalCardRef = {
  setKey: SetKey
  printingNumber: number
  baseNumber: number
  type?: string
}

export type CanonicalCatalog = Map<string, CanonicalCardRef>
export type ImportMode = 'merge' | 'replace'
export type ImportResult = {
  inventories: Record<SetKey, Inventory>
  recognized: number
  skipped: number
}

export const INVENTORY_SCHEMA_VERSION = '2'
export const INVENTORY_SCHEMA_KEY = 'inv:schema-version'
export const INVENTORY_BACKUP_KEY = 'inv:migration:v2:backup'
```

`canonicalizeInventory(setKey, inventory, catalog)` must parse only positive integer printing numbers and positive finite quantities, look up every printing in `catalog`, aggregate by `baseNumber`, and cap once using `quotaForType(ref.type)`.

`applyImportedInventories(current, imported, mode, catalog)` must canonicalize both sides. Replace starts from an empty destination inventory for every imported set. Merge adds canonical counts then caps by the destination base-card reference.

`migrateLegacyInventories(storage, setKeys, catalog)` must:

1. Return parsed canonical inventories without creating another backup when schema version is already `2`.
2. Read and retain every original `inv:<set>` string in one JSON backup object.
3. Store that backup before writing any normalized inventories.
4. Write normalized `inv:<set>` values.
5. Store schema version `2` only after all writes complete.

- [ ] **Step 4: Run inventory tests and verify GREEN**

Run: `npm test -- src/core/inventory.test.ts`

Expected: PASS with canonicalization, cross-set quota, malformed input, backup, and idempotence coverage.

- [ ] **Step 5: Route every import format through the canonical catalog**

Replace `CardUtilities.fullCardIndex` with `CanonicalCatalog`. Build it after all sets parse:

```ts
function canonicalCatalogFromParsedSets(parsedSets: Iterable<ParsedSet>): CanonicalCatalog {
  const catalog: CanonicalCatalog = new Map()
  for (const parsed of parsedSets) {
    for (const card of parsed.allCards) {
      const baseNumber = parsed.altToBase.get(card.Number) ?? card.Number
      const baseCard = parsed.byNumber.get(baseNumber)
      catalog.set(`${parsed.key}:${card.Number}`, {
        setKey: parsed.key,
        printingNumber: card.Number,
        baseNumber,
        type: baseCard?.Type ?? card.Type,
      })
    }
  }
  return catalog
}
```

CSV, XLSX, and JSON parsing must collect raw printing counts and then call `applyImportedInventories({}, rawImported, 'replace', catalog)` for one shared normalization path. Preserve `recognized` and `skipped` for the import preview and completion toast.

- [ ] **Step 6: Integrate silent migration and base-only adjustments**

After every set has been parsed, call `migrateLegacyInventories(localStorage, setKeys, catalog)` once. Load the current inventory from that returned canonical record. Replace `inc` and `dec` lookups so they resolve the active number through the catalog before updating:

```ts
function canonicalBaseNumber(set: SetKey, printingNumber: number): number | null {
  return canonicalCatalog.get(`${set}:${printingNumber}`)?.baseNumber ?? null
}
```

Remove base-plus-alt summation from filtered rows; read `inventory[baseNum]` directly. Export canonical inventories from storage.

- [ ] **Step 7: Run full tests and typecheck**

Run: `npm test`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS with no current-set-only quota lookup in import application.

- [ ] **Step 8: Commit canonical inventory**

```powershell
git add src/core/inventory.ts src/core/inventory.test.ts src/App.tsx
git commit -m "fix: canonicalize inventory across card printings"
```

---

### Task 4: Persisted Settings and Accessible Modal

**Files:**
- Create: `src/core/settings.test.ts`
- Create: `src/core/settings.ts`
- Create: `src/components/SettingsModal.test.tsx`
- Create: `src/components/SettingsModal.tsx`
- Modify: `src/App.tsx:648-673,1992-2195,2568-2824`
- Modify: `index.html`

**Interfaces:**
- Produces `AppSettings`, `DEFAULT_SETTINGS`, `readSettings(storage)`, and `writeSettings(storage,settings)`.
- `SettingsModal` consumes `{ open, settings, onChange, onClose, returnFocusRef }`.
- `App.tsx` owns the current settings state and writes changes immediately.

- [ ] **Step 1: Write failing settings persistence tests**

Create `src/core/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, readSettings, writeSettings } from './settings'

it('enables automatic enlarged-page mode by default', () => {
  expect(DEFAULT_SETTINGS.autoOpenSinglePage).toBe(true)
})

it('falls back to defaults for missing or malformed storage', () => {
  expect(readSettings({ getItem: () => null })).toEqual(DEFAULT_SETTINGS)
  expect(readSettings({ getItem: () => '{bad json' })).toEqual(DEFAULT_SETTINGS)
})

it('round-trips supported settings and ignores unknown values', () => {
  let stored = ''
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value },
  }
  writeSettings(storage, { autoOpenSinglePage: false })
  expect(readSettings(storage)).toEqual({ autoOpenSinglePage: false })
})
```

- [ ] **Step 2: Run settings tests and verify RED**

Run: `npm test -- src/core/settings.test.ts`

Expected: FAIL because `src/core/settings.ts` does not exist.

- [ ] **Step 3: Implement typed settings persistence**

Create `src/core/settings.ts`:

```ts
export type AppSettings = {
  autoOpenSinglePage: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoOpenSinglePage: true,
}

export const SETTINGS_STORAGE_KEY = 'swu:settings:v1'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

export function readSettings(storage: ReadStorage): AppSettings {
  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Partial<AppSettings>
    return {
      autoOpenSinglePage:
        typeof parsed.autoOpenSinglePage === 'boolean'
          ? parsed.autoOpenSinglePage
          : DEFAULT_SETTINGS.autoOpenSinglePage,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeSettings(storage: WriteStorage, settings: AppSettings): void {
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}
```

- [ ] **Step 4: Run settings tests and verify GREEN**

Run: `npm test -- src/core/settings.test.ts`

Expected: PASS.

- [ ] **Step 5: Write a failing accessible modal test**

Create `src/components/SettingsModal.test.tsx` with Testing Library. Assert the dialog has accessible name `Settings`, the checkbox is checked from props, clicking it calls `onChange({autoOpenSinglePage:false})`, Escape calls `onClose`, and the Close button calls `onClose`.

Run: `npm test -- src/components/SettingsModal.test.tsx`

Expected: FAIL because `SettingsModal.tsx` does not exist.

- [ ] **Step 6: Implement SettingsModal**

Create a semantic component using:

```tsx
<div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
  <section
    ref={dialogRef}
    className="settings-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    tabIndex={-1}
  >
    <h2 id="settings-title">Settings</h2>
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={settings.autoOpenSinglePage}
        onChange={event => onChange({ ...settings, autoOpenSinglePage: event.target.checked })}
      />
      <span>Automatically open enlarged page after selecting a card</span>
    </label>
    <button type="button" className="tbtn" onClick={onClose}>Close</button>
  </section>
</div>
```

Use an effect to focus the dialog when opened, listen for Escape, and restore `returnFocusRef.current` on cleanup.

- [ ] **Step 7: Integrate settings state and gear control**

Initialize settings with `useState(() => readSettings(localStorage))`. Wrap writes in `try/catch`; update state even if storage fails and show an error toast. Add a gear button with `aria-label="Open settings"` to Inventory Controls and render `SettingsModal` at the application root.

- [ ] **Step 8: Run settings/component tests and commit**

Run: `npm test -- src/core/settings.test.ts src/components/SettingsModal.test.tsx`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

```powershell
git add src/core/settings.ts src/core/settings.test.ts src/components/SettingsModal.tsx src/components/SettingsModal.test.tsx src/App.tsx index.html
git commit -m "feat: add persisted filing view settings"
```

---

### Task 5: Centered Locator and Single-Page Focus View

**Files:**
- Create: `src/components/LocatorPanel.test.tsx`
- Create: `src/components/LocatorPanel.tsx`
- Modify: `src/App.tsx:834-841,1213-1363,2197-2215,2869-3376`
- Modify: `index.html:22-515`

**Interfaces:**
- `LocatorPanel` consumes `{ selection, quantity, maximum, aspectBackground?, onDecrease, onIncrease }`.
- Binder gains `{ viewMode: 'single' | 'spread', focusedPage: number, onViewModeChange }`.
- App owns `binderViewMode` and updates it after selection based on settings.

- [ ] **Step 1: Write a failing locator component test**

Create `src/components/LocatorPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocatorPanel } from './LocatorPanel'

it('shows readable physical location and adjusts quantity', () => {
  const onDecrease = vi.fn()
  const onIncrease = vi.fn()
  render(
    <LocatorPanel
      selection={{
        card: { Name: 'Darth Vader', Subtitle: 'Dark Lord of the Sith', Number: 10, Type: 'Leader', Set: 'SOR' },
        number: 10,
        page: 1,
        row: 3,
        column: 2,
        spreadCol: 6,
        spreadRow: 3,
      }}
      quantity={0}
      maximum={1}
      onDecrease={onDecrease}
      onIncrease={onIncrease}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Darth Vader' })).toBeTruthy()
  expect(screen.getByText('Page')).toBeTruthy()
  expect(screen.getByText('Column')).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.queryByText('6')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Increase Darth Vader quantity' }))
  expect(onIncrease).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run locator test and verify RED**

Run: `npm test -- src/components/LocatorPanel.test.tsx`

Expected: FAIL because `LocatorPanel.tsx` does not exist.

- [ ] **Step 3: Implement centered LocatorPanel**

Create semantic markup with an `aria-live="polite"` container, an `h2` for the card name, subtitle and number, three labeled location values, and 44px minimum quantity buttons. Use `selection.column`, never `selection.spreadCol`, for the displayed Column value.

- [ ] **Step 4: Run locator test and verify GREEN**

Run: `npm test -- src/components/LocatorPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add binder view-mode state and selection behavior**

Add:

```ts
type BinderViewMode = 'single' | 'spread'
const [binderViewMode, setBinderViewMode] = useState<BinderViewMode>('spread')

const activateCard = useCallback((card: Card, forceView?: BinderViewMode) => {
  const position = binderLayout(card.Number)
  const spread = getSpreadCoords(position.page, position.row, position.column)
  setActive({ card, number: card.Number, ...position, ...spread })
  setViewSpread(pageToSpread(position.page))
  setBinderViewMode(
    forceView ?? viewModeAfterSelection(settings, binderViewMode),
  )
}, [settings, binderViewMode])
```

Route search, slot clicks, table clicks, and pending cross-set selection through `activateCard`. Arrow navigation must update `active` and keep `binderViewMode` unchanged; the focused page derives from `active.page`.

- [ ] **Step 6: Render a four-column single physical page**

Refactor Binder grid dimensions from fixed constants to:

```ts
const singlePage = viewMode === 'single'
const cols = singlePage ? 4 : 8
const pageForCell = singlePage
  ? focusedPage
  : c <= 4
    ? leftPage
    : rightPage
const columnOnPage = singlePage ? c : c <= 4 ? c : c - 4
```

In single mode, omit the blank left page, center divider, spread-only label, and internal 5-8 columns. Page navigation controls move one physical page at a time. In spread mode, preserve the current Page 1 and 2/3, 4/5 behavior and comma/period shortcuts.

Add an accessible segmented control above the binder:

```tsx
<div className="toolbar-group" role="group" aria-label="Binder view">
  <button aria-pressed={viewMode === 'single'} onClick={() => onViewModeChange('single')}>Single Page</button>
  <button aria-pressed={viewMode === 'spread'} onClick={() => onViewModeChange('spread')}>Spread</button>
</div>
```

- [ ] **Step 7: Add high-readability responsive styles**

Add classes rather than inline sizing:

```css
.locator-panel { text-align:center; padding:20px; }
.locator-name { font-size:clamp(2rem,4vw,3.25rem); line-height:1.05; }
.locator-location { display:grid; grid-template-columns:repeat(3,minmax(110px,1fr)); gap:12px; max-width:720px; margin:18px auto; }
.locator-value { font-size:clamp(1.8rem,4vw,3rem); font-weight:800; }
.locator-qty button { min-width:44px; min-height:44px; }
@media (max-width:760px) {
  .locator-location { grid-template-columns:repeat(3,1fr); }
  .locator-panel { padding:14px 8px; }
  .controls-row .autocomplete { min-width:100%; }
}
```

Ensure the SVG slot name remains readable in single mode by increasing its rendered width rather than adding more text inside slots.

- [ ] **Step 8: Run component, core, and type tests**

Run: `npm test`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 9: Commit locator and focus mode**

```powershell
git add src/components/LocatorPanel.tsx src/components/LocatorPanel.test.tsx src/App.tsx index.html
git commit -m "feat: add accessible centered card locator"
```

---

### Task 6: Integration Coverage and Accessibility Cleanup

**Files:**
- Create: `src/core/selection.test.ts`
- Create: `src/core/selection.ts`
- Modify: `src/App.tsx`
- Modify: `eslint.config.js`
- Modify: `.prettierignore`
- Modify: `index.html`

**Interfaces:**
- Produces `viewModeAfterSelection(settings,currentMode)` and `selectionAfterMove(active,direction,totalPages,byNumber)` for deterministic integration behavior.
- `App.tsx` uses these helpers in keyboard and selection effects.

- [ ] **Step 1: Write failing integration-state tests**

Create tests proving:

```ts
expect(viewModeAfterSelection({ autoOpenSinglePage: true }, 'spread')).toBe('single')
expect(viewModeAfterSelection({ autoOpenSinglePage: false }, 'spread')).toBe('spread')
```

Create a movement fixture where an active Page 2 Column 4 selection moves Right to Page 3 Column 1, resolves the exact destination card, and returns a selection whose locator page follows Page 3.

- [ ] **Step 2: Run selection tests and verify RED**

Run: `npm test -- src/core/selection.test.ts`

Expected: FAIL because `src/core/selection.ts` does not exist.

- [ ] **Step 3: Implement deterministic selection helpers**

Create `src/core/selection.ts` with:

```ts
export type BinderViewMode = 'single' | 'spread'

export function viewModeAfterSelection(
  settings: AppSettings,
  currentMode: BinderViewMode,
): BinderViewMode {
  return settings.autoOpenSinglePage ? 'single' : currentMode
}
```

`selectionAfterMove` calls `moveBinderSelection`, resolves the resulting number from `byNumber`, and returns the original active selection when movement targets a missing slot. It must calculate both physical and spread coordinates for a valid result.

- [ ] **Step 4: Run selection tests and verify GREEN**

Run: `npm test -- src/core/selection.test.ts`

Expected: PASS.

- [ ] **Step 5: Remove duplicated and stale component logic**

Delete unused `NAME_MAX_LINES`, `normalizeType`, `resolveToBase`, `InventoryAll`, duplicate `qtyText`, and component-local coordinate/search/quota helpers. Replace `any` values in imports and card mapping with `unknown` plus narrow record types. Wrap render-created callbacks used by effects in `useCallback` or move their pure work to the new core modules.

- [ ] **Step 6: Make validation ignore generated worktrees and assets**

Update ESLint ignores:

```ts
{ ignores: ['dist', '.claude/worktrees/**', '.superpowers/**'] }
```

Update `.prettierignore`:

```text
dist
node_modules
public/sets
.claude/worktrees
.superpowers
```

- [ ] **Step 7: Run the complete automated gate**

Run in order:

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run format
npm run format:check
npm run build
```

Expected: every command exits zero. Run `git diff --check` afterward and expect no output.

- [ ] **Step 8: Commit integration cleanup**

```powershell
git add src/core/selection.ts src/core/selection.test.ts src/App.tsx eslint.config.js .prettierignore index.html
git commit -m "refactor: integrate tested filing workflow state"
```

---

### Task 7: Documentation and Manual Runtime Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents the delivered settings, locator, keyboard behavior, migration, imports, and test commands.
- Does not change application behavior.

- [ ] **Step 1: Update README behavior and set list**

Document all eight manifest sets: SOR, SHD, TWI, JTL, LOF, SEC, LAW, and ASH. Replace the old arrow-key page-flip wording with:

```md
- Arrow keys move the selected card through the binder grid, including existing page-edge wrapping.
- `+` / `-` adjust the selected card quantity.
- `,` / `.` move to the previous or next spread.
- `/` focuses search and Enter selects the highlighted result.
```

Add sections for the centered locator, physical 1-4 columns, Single Page/Spread toggle, Settings default, canonical import behavior, and silent one-time local backup.

- [ ] **Step 2: Document development verification**

Add:

```md
npm test
npx tsc --noEmit
npm run lint
npm run format:check
npm run build
```

- [ ] **Step 3: Run final automated verification**

Run the full Task 6 gate again from a clean terminal. Record exact test counts and build output for the handoff.

- [ ] **Step 4: Run manual application checks**

Start `npm run dev` and verify:

1. Search `Darth Vader` in SOR and select both Leader #10 and Unit #87 independently.
2. Click the search icon for a partial query and confirm it selects the highlighted suggestion.
3. Select card #1 and confirm the locator displays physical Column 1, not spread Column 5.
4. Confirm automatic single-page mode is enabled on first use.
5. Disable it in Settings, select a card, and confirm the current spread view remains.
6. Re-enable it, reload, and confirm the preference persists.
7. Use every arrow direction across a page boundary and confirm the locator and focused page follow.
8. Use keyboard and locator `+`/`-` controls and confirm canonical quantities remain capped.
9. Import a fixture containing base and alternate printings and confirm the combined quantity is capped.
10. Confirm migration backup and schema keys exist without displaying a migration notice.
11. Inspect the layout at wide desktop and 800px viewport widths.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain accessible filing workflow"
```

- [ ] **Step 6: Inspect final branch state**

Run:

```powershell
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
```

Expected: clean status and a focused sequence of design, binder, search, inventory, settings, locator, integration, and documentation commits.
