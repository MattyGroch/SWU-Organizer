# Import formats

All parsing lives in `src/domain/import/` (pure, framework-free) and is applied to the
database by `src/data/applyImport.ts`.

## Supported inputs

| Format                     | Detected by                                 | Identifies cards by                       |
| -------------------------- | ------------------------------------------- | ----------------------------------------- |
| SW-Unlimited (CSV or XLSX) | `Set` + `Base card id` headers              | base number + one column per variant      |
| SWUDB CSV                  | `Set` + `CardNumber` headers                | printing number                           |
| SWU Organizer JSON (v2)    | `{ sets: { SET: { printingNum: count } } }` | printing number                           |
| Legacy app JSON (v1)       | same shape, base numbers                    | base number → that card's Normal printing |

## Variant columns

SW-Unlimited column headers map to printings in `variantColumns.ts`:

```
Normal              → normal
Foil                → foil
Hyperspace          → hyperspace
Foil & Hyperspace   → hyperspace-foil
Showcase            → showcase
Standard Prestige   → prestige
Foil Prestige       → prestige-foil
Serialized Prestige → prestige-serialized
```

Promo-ish columns (`Organized Play`, `Event Exclusive`, `Prerelease Promo`, …) have no
corresponding catalog printing. They are folded into ordinary copies rather than dropped —
losing a card you own is worse than recording its finish imprecisely.

**This is the behaviour Phase 3 existed to fix.** The legacy importer knew these exact
column names (`App.tsx:542-554`) and summed every one of them into a single number, then
clamped that total to the playset quota on the way into storage. A row recording 3 Normal,
1 Foil and 1 Hyperspace Foil became "3 copies, finish unknown".

## Contract

- Counts are **never clamped** to the playset quota. What you own and what fits in the
  binder are separate questions; `binderCount`/`spareCount` derive the latter.
- Nothing is dropped silently. Every unparseable or unresolvable entry lands in
  `skipped` with a reason (`unknown-set`, `unknown-card`, `unknown-variant`, `malformed`,
  `reserved-key`) and is shown in the import preview.
- Reserved legacy storage keys (`schema-version`, `migration:v2:backup`) never become sets.
- `replace` mode clears **only the sets the file mentions**, so a single-set re-import
  cannot wipe the rest of a collection. The whole apply runs in one transaction.
- SheetJS is dynamically imported, so the ~163 kB (gzipped) spreadsheet parser is a
  separate chunk rather than part of the main bundle.

## SheetJS note

`xlsx` is installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, not the
npm registry. The registry copy is frozen at 0.18.5 and carries two unfixable high-severity
advisories (prototype pollution, ReDoS); SheetJS publishes fixes only on their own CDN.
The trade-off is that `npm ci` needs to reach cdn.sheetjs.com at install time.
