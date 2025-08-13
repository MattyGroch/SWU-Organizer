# SWU Organizer

A fast, local-first web app to organize **Star Wars: Unlimited** binders. Pick a set, search by name or number, and see the card’s **Page / Row / Column** on a visual 8×3 spread (two 4×3 pages) with aspect colors. Track inventory, filter for missing cards, and export/import your counts. Docker-ready.

You can check it out at: [https://swu.mattyflix.com/](https://swu.mattyflix.com/)

---

## Features

- 🔎 **Smart search**: search by **name** (typeahead) or **number** (handles leading zeros like `003`).
- 🗺️ **Visual binder**: 8×3 spread; Page 1 shows only the right page, then spreads `2/3`, `4/5`, etc.
- 🎨 **Aspect colors**: cells tinted by the card’s first aspect (Vigilance/Command/Aggression/Cunning/Heroism/Villainy).
- 🧭 **Click & jump**: click any slot to select that card; selection shows Page/Row/Column.
- ➕➖ **Inventory tracking**: per-card counts with +/− controls (1× cap for Leaders/Bases; 3× default for others).
- ⌨️ **Keyboard shortcuts**:  
  `/` focus search, **Enter** run search, **←/→** flip spread, **+/-** adjust selected card.
- 🗂️ **All-sets import/export**: single JSON file rolls up inventory across SOR, SHD, TWI, JTL, LOF.
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
      - "8080:8080"
```

---

## Using the App

1. **Choose a set** (SOR, SHD, TWI, JTL, LOF).  
2. **Search** by name or number (press `/` to focus; **Enter** to go).  
3. View the card’s **Page / Row / Column** and see it highlighted on the binder spread.  
4. Adjust **quantities** with +/− on any filled slot.  
5. **Export** your inventory (all sets) to JSON; **Import** it later to restore.

**Spread navigation:**  
- Pager shows `Page 1` and then spreads `Page 2/3`, `Page 4/5`, …  
- **←/→** flips one spread at a time.

---

## Data & Format

Included set files live under `public/sets/`:

- `SWU-SOR.json`, `SWU-SHD.json`, `SWU-TWI.json`, `SWU-JTL.json`, `SWU-LOF.json`

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

## Inventory (All Sets)

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
    "LOF": { "212": 1 }
  }
}
```

- **Import** replaces stored counts per set (zeros are pruned).  
- Setting a card back to **0** removes it from the inventory list and storage.

---

## Keyboard Shortcuts

- `/` — focus search  
- **Enter** — run search / choose highlighted suggestion (and blur field)  
- **← / →** — previous/next spread  
- **+ / −** — increment/decrement **selected** card’s quantity

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
