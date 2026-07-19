# Accessibility and Correctness Iteration Design

## Goal

Improve the personal card-filing workflow by making the selected card location substantially easier to read, preserving fast keyboard navigation, correcting search and physical location behavior, canonicalizing inventory data, and adding focused regression coverage.

Cloud synchronization is explicitly outside this iteration. It will be scoped as the next project after this work is stable.

## Product Constraints

- The application remains a personal, local-first Star Wars: Unlimited collection organizer.
- Existing collection data must be preserved during migration.
- The current arrow-key grid navigation and `+`/`-` quantity shortcuts must remain available.
- The application must continue to support JSON, CSV, and XLSX inventory imports.
- No account, backend, multi-user, deck-building, or social features are added in this iteration.

## Chosen Approach

Use targeted modularization. Extract binder math, search resolution, inventory normalization, and settings persistence into small tested TypeScript modules while retaining the existing React application structure. Add only the UI components required for the centered locator and Settings modal. Avoid a comprehensive state-management or component rewrite.

## Architecture

### Core modules

- `src/core/binder.ts` owns card-number to page, row, physical-column, spread-column, and keyboard-navigation calculations.
- `src/core/search.ts` owns normalized search matching, result ranking, and stable result identity using `{ setKey, baseNumber }`.
- `src/core/inventory.ts` owns printing-to-base normalization, quotas, import aggregation, merge/replace behavior, and legacy inventory migration.
- `src/core/settings.ts` owns typed settings defaults, parsing, and local-storage serialization.

### UI components

- `src/components/LocatorPanel.tsx` renders the centered high-readability selected-card panel, including card identity, physical location, and large quantity controls.
- `src/components/SettingsModal.tsx` renders local behavior and accessibility settings.
- `src/App.tsx` continues to orchestrate set loading, active selection, search, inventory, imports, and top-level UI state.
- The existing binder renderer gains a single-physical-page presentation without being comprehensively rewritten.

## Locator and Binder Experience

- With no active card, the binder opens in the existing two-page spread view.
- Selecting a card by search, binder slot, inventory table, or missing-card table renders the centered locator.
- The locator prominently displays:
  - Card name and subtitle.
  - Card number.
  - Physical page.
  - Physical row.
  - Physical column in the range 1-4.
  - Large decrease, quantity, and increase controls.
- The internal spread column in the range 1-8 remains available for navigation calculations but is not labeled as the physical card column.
- When `Automatically open enlarged page after selecting a card` is enabled, selecting a card switches the binder to the relevant four-column physical page.
- The setting defaults to enabled and is stored locally.
- A visible `Single Page / Spread` control allows the user to change presentation at any time.
- Disabling automatic focus prevents the automatic view change but does not remove manual single-page mode.

## Keyboard Behavior

- Existing global arrow-key navigation remains the source of active-card movement.
- The centered locator updates immediately as the active selection changes.
- The enlarged physical page follows the selected card when keyboard navigation crosses a page boundary.
- Existing page-edge wrapping is preserved. For example, moving Right from physical Column 4 continues to Column 1 on the adjacent page.
- Existing `+`, `=`, numpad add, `-`, and numpad subtract shortcuts continue to modify the active card.
- The centered locator and its controls do not steal keyboard focus during grid navigation.
- Existing comma and period spread navigation remains available.

## Search Behavior

- Every search result carries a stable `{ setKey, baseNumber }` identity.
- Choosing a result never resolves the card by name alone.
- Duplicate names with different subtitles or card types select the exact result shown.
- The search button, Enter key, and clicked suggestion share the same resolution path.
- When suggestions are available, submission selects the highlighted result or the first result.
- Exact card-number matches remain prioritized.
- Name results rank word-start matches ahead of incidental normalized substrings, preventing results such as `Brain Invaders` from outranking intentional `Vader` matches.

## Canonical Inventory Model

- Stored inventory contains one quantity per base card number.
- A catalog lookup maps `{ setKey, printingNumber }` to the associated base number and card type.
- All manual adjustments and all import formats use that lookup.
- Counts from multiple printings combine at the base card and are capped after aggregation.
- Leader and Base cards cap at one copy; other types cap at three copies.
- Merge and replace operations use the destination set's catalog, including when that set is not currently displayed.
- Exports contain canonical base-number quantities while remaining compatible with the current version-one JSON shape.

## Legacy Migration

- A schema-version marker identifies whether canonical migration has run.
- On the first load after this update, existing `inv:<set>` records are parsed and normalized silently.
- Before any normalized data is written, the application stores one recoverable backup containing the original inventory records.
- Variant counts are combined and capped by base-card type.
- Invalid keys, non-finite values, negative values, and unknown card numbers are ignored.
- Valid inventory entries continue loading if other entries are malformed.
- Migration is idempotent and does not run again after the schema marker is stored.

## Settings

- A gear button in the top controls opens Settings.
- The initial setting is `Automatically open enlarged page after selecting a card`.
- Its default value is `true`.
- Settings parsing accepts missing or malformed storage by returning defaults.
- Settings changes persist immediately in local storage.
- The modal supports Escape, backdrop dismissal, explicit Close, initial focus, focus restoration, and dialog semantics.

## Imports and Error Handling

- JSON, CSV, and XLSX parsing feed a shared canonical aggregation path.
- Import preview reports recognized and skipped entries.
- Invalid imports do not modify stored inventory.
- Unknown printings are skipped instead of being assigned a default quota.
- Set-data failures remain visible near the application controls.
- Clipboard and storage failures use the existing toast system.
- Settings read failures fall back to defaults.
- Migration failures preserve the pre-migration backup and load all valid entries that can be recovered.

## Testing Strategy

Add Vitest as the project test runner and cover behavior with real functions rather than implementation mocks.

### Binder tests

- Card number to page, row, physical column, and spread column.
- Page-one and later-spread calculations.
- Keyboard movement within a page and across page boundaries.
- Boundary behavior at the first and final available card slots.

### Search tests

- Duplicate names resolve to the exact base number.
- Search submission uses the highlighted or first suggestion.
- Partial-name search behaves consistently for button, Enter, and click paths.
- Cross-set results retain the correct set identity.
- Word-start matches rank ahead of incidental normalized substrings.

### Inventory tests

- Multiple printings normalize to one base card.
- Aggregated counts cap correctly.
- Leader/Base and standard-card quotas.
- Same-set and cross-set merge behavior.
- Replace behavior.
- Unknown and malformed entries are skipped.
- Legacy migration creates a backup, writes canonical inventory, stores its schema marker, and is idempotent.

### Settings and UI tests

- Automatic enlarged-page mode defaults to enabled.
- Settings serialize, parse, and recover from malformed data.
- Selection enters focus mode when enabled and remains in spread mode when disabled.
- Arrow navigation updates the locator and followed page.
- Quantity shortcuts update the canonical active card.
- The locator renders readable physical location values and functional quantity controls.

## Verification Gate

The iteration is complete only when all of the following pass:

- Complete Vitest suite.
- TypeScript compilation.
- ESLint.
- Prettier formatting check.
- Production Vite build.
- Manual runtime verification of search selection, centered locator, keyboard navigation, focus-page following, Settings persistence, import migration, and responsive readability.

## Documentation Updates

- Update the README to describe the centered locator, single-page mode, Settings toggle, current set list, and correct keyboard shortcuts.
- Document the silent canonical inventory migration and local backup behavior.
- Add the test command to the development instructions.
