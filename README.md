# SWU Organizer

A fast, local-first web app for organizing a personal **Star Wars: Unlimited** collection. Pick a set, search by name or number, and use the centered locator to read the card’s physical **Page / Row / Column** before filing it. Track inventory, filter for missing cards, and export or import counts without sending collection data to a server. Docker-ready.

You can check it out at: [https://swu.mattyflix.com/](https://swu.mattyflix.com/)

---

## Features

- 🔎 **Smart search**: search by **name** (typeahead) or **number** (handles leading zeros like `003`).
- 🗺️ **Visual binder**: switch between a large 4×3 physical page and an 8×3 two-page spread; Page 1 stands alone, followed by spreads `2/3`, `4/5`, etc.
- 🎨 **Aspect colors**: cells tinted by the card’s first aspect (Vigilance/Command/Aggression/Cunning/Heroism/Villainy).
- 🧭 **Readable filing locator**: selecting a card shows its name, number, quantity, and physical Page/Row/Column in a centered, high-readability panel.
- ➕➖ **Inventory tracking**: per-card counts with +/− controls (1× cap for Leaders/Bases; 3× default for others).
- ⌨️ **Keyboard-first filing**: arrow keys move the selected card through the grid, while `+`/`-` adjust its quantity.
- ⚙️ **Personal filing preference**: Settings can automatically open the selected card’s enlarged physical page; this is enabled by default and saved locally.
- 🗂️ **All-sets import/export**: JSON, CSV, and XLSX imports normalize alternate printings to their base cards; one JSON export rolls up all eight supported sets.
- 🐳 **Docker**: build once, run anywhere.

---

## Quick Start (Dev)

**Requirements:** Node 20+ and npm (or pnpm/yarn).

```bash
npm ci
npm run dev
# visit http://localhost:5173
```

Build production:

```bash
npm run build
npm run preview
# visit http://localhost:4173
```

Run the complete automated verification gate:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run format:check
npm run build
```

---

## Docker

**Build & run:**

```bash
docker build -t swu-organizer .
docker run --rm -p 8080:8080 swu-organizer
# http://localhost:8080
```

**docker-compose.yml:**

```yaml
services:
  swu-organizer:
    build: .
    ports:
      - '8080:8080'
```

---

## Using the App

1. **Choose a set** (SOR, SHD, TWI, JTL, LOF, SEC, LAW, or ASH).
2. **Search** by name or number (press `/` to focus; **Enter** to go).
3. Read the centered locator’s **Page / Row / Column** and find the highlighted slot in the binder. Columns are the four physical columns on a page (`1`–`4`), not the internal eight-column spread position.
4. Adjust **quantities** with +/− on any filled slot or with the large controls in the locator.
5. **Export** your inventory (all sets) to JSON; **Import** it later to restore.

### Filing view and Settings

- **Single Page** displays one enlarged four-column physical page. **Spread** displays the two-page eight-column overview.
- Selecting a card opens its Single Page view by default. The enlarged page follows the selection when arrow-key navigation crosses a page boundary.
- Open **Settings** to disable or re-enable **Automatically open enlarged page after selecting a card**. The preference is saved in local storage and defaults to enabled on first use.
- Disabling the setting prevents the automatic switch; the **Single Page / Spread** control remains available at any time.
- Spread navigation shows `Page 1` and then `Page 2/3`, `Page 4/5`, and so on.

---

## Data & Format

Included set files live under `public/sets/`:

- `SWU-SOR.json` — Spark of Rebellion (SOR)
- `SWU-SHD.json` — Shadows of the Galaxy (SHD)
- `SWU-TWI.json` — Twilight of the Republic (TWI)
- `SWU-JTL.json` — Jump to Lightspeed (JTL)
- `SWU-LOF.json` — Legends of the Force (LOF)
- `SWU-SEC.json` — Secrets of Power (SEC)
- `SWU-LAW.json` — A Lawless Time (LAW)
- `SWU-ASH.json` — Ashes of the Empire (ASH)

The app reads these fields per card:

```json
{
  "Name": "Ahsoka Tano",
  "Number": 3,
  "Aspects": ["Vigilance"],
  "Type": "Unit"
}
```

Only **Name**, **Number**, **Aspects[0]**, and **Type** are required for UI & inventory logic.

---

## Inventory, Imports, and Local Migration

- **Caps:** Leaders/Bases = **1×**, other types = **3×** (configurable in code).
- **Export** produces a single JSON like:

```json
{
  "version": 1,
  "sets": {
    "SOR": { "12": 1, "98": 3 },
    "SHD": {},
    "TWI": {},
    "JTL": {},
    "LOF": { "212": 1 },
    "SEC": {},
    "LAW": {},
    "ASH": {}
  }
}
```

- **Import formats:** JSON, CSV, and XLSX feed the same canonical inventory path. The import preview reports recognized and skipped entries and lets you merge counts or replace data for the imported sets.
- **Canonical counts:** alternate printings are mapped to their base card, combined, and capped only after aggregation. Unknown or malformed entries are skipped. Exports store one quantity per base card while retaining the version-one JSON shape shown above.
- **Silent migration:** on the first load after upgrading, existing local inventory is normalized once. Before any normalized inventory is written, the app creates a recoverable local backup of the original `inv:<set>` records. The migration does not display a notice and does not repeat after its schema marker is stored.
- Collection data, settings, the migration backup, and schema marker remain in this browser’s local storage. They are not cloud-synchronized.
- Setting a card back to **0** removes it from the inventory list and storage.

---

## Keyboard Shortcuts

- Arrow keys move the selected card through the binder grid, including existing page-edge wrapping.
- `+` / `-` adjust the selected card quantity.
- `,` / `.` move to the previous or next spread.
- `/` focuses search and Enter selects the highlighted result.

---

## Roadmap / Ideas

- Progress bars per page & per set
- Filters by **Aspect**/**Type**
- Printable checklist / CSV export
- PWA install & offline cache

---

## Legal

This is an **unofficial fan project**. It is not affiliated with or endorsed by Lucasfilm Ltd., Disney, Fantasy Flight Games, or Asmodee.

“Star Wars” and all related properties are © & ™ Lucasfilm Ltd.  
“Star Wars: Unlimited” is © & ™ Fantasy Flight Games / Asmodee.

This app uses **factual metadata** (card names, numbers, sets, aspects, types) for organizational purposes and **does not include** card art, rules text, or logos.  
If you are a rights holder and have concerns, please contact: **matt.grochocinski@gmail.com**.

---

## License

- **Code:** **Polyform Noncommercial 1.0.0** — non-commercial use, modification, and redistribution allowed **with attribution**. Commercial use requires prior permission.

For commercial licensing or questions, email **matt.grochocinski@gmail.com**.

---

## Contributing

Issues and PRs welcome! Please keep changes focused and include screenshots/GIFs for UI tweaks.

**Contact:** matt.grochocinski@gmail.com
