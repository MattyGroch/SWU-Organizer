# SWU Organizer

Track a **Star Wars: Unlimited** collection the way it sits in your binders — slot by slot, printing by printing — and build decks from it.

## Features

- **Binder view** — every set laid out as binder spreads, with real card art, the playset count in each pocket, and a foil mark on foil copies. Leaders and Bases sit sideways, as they do in a pocket.
- **Every printing tracked** — Normal, Foil, Hyperspace, Hyperspace Foil, Showcase, Prestige, Prestige Foil and Prestige Serialized are counted separately, and the binder shows the most premium copy you own.
- **Fast filing** — keyboard-first: `+`/`−` for a card, `1`–`8` for a specific printing, arrows to move, `/` to search across every set. Press `?` in the app for the full list.
- **Decks** — paste a decklist (swudb JSON, Melee, picklist or plain text) to check it against your collection and its format's rules (Premier, Twin Suns). Save it, then construct it with a pick list in binder order; deconstruct puts the same printings back. A deck can be partly built, flagged with what's missing and whether you own it elsewhere.
- **Precons** — owned precon decks count toward your collection but stay sealed.
- **Intake** — a review queue for cards entering the collection (a deck bought built, and later scanned cards): set each copy's printing before it counts.
- **Bulk edit, import and backup** — fill or clear whatever the filters show; import SW-Unlimited, SWUDB or Hyperspace Vault exports; download a full backup and restore it with add / only-missing / keep-higher / replace options.
- **Cloud sync** — sign in with Google to keep every device in step; offline changes sync later, and edits on two devices merge.
- **Works on a phone** — on small screens the binder becomes a searchable list with the selected card's controls at hand.

## Repository layout

| Path                    | What it is                                                                   |
| ----------------------- | ---------------------------------------------------------------------------- |
| `app/`                  | The web app — React 19, Vite, TanStack Router/Query, IndexedDB (Dexie).      |
| `server/`               | The sync API — Express, SQLite, Google OAuth.                                |
| `scripts/`              | The card-data pipeline: builds the catalog from swu-db.com and validates it. |
| `app/public/sets/`      | The committed card catalog, refreshed daily by CI.                           |
| `app/public/precons/`   | Precon decklists.                                                            |
| `Dockerfile`, `docker/` | The app's production image (nginx).                                          |

## Development

```bash
cd app
npm ci
npm run dev        # http://localhost:5173
npm test           # unit and integration tests
npm run typecheck
npm run lint
```

The app works fully on its own — everything is stored in the browser. To try cloud sync locally too, run the API alongside it; setup (including the Google OAuth client) is in [`app/docs/cloud-sync.md`](app/docs/cloud-sync.md).

```bash
cd server
npm ci
npm run dev        # http://localhost:3001 — reads server/.env
```

To check the app on a phone on the same network: `npm run dev -- --host` in `app/`, then open the "Network" address it prints.

## Card data

`scripts/fetch-catalog.mjs` builds one catalog file per set from the swu-db.com API, keeping every printing and resolving each card's base number (its binder slot). `scripts/validate-catalog.mjs` checks it; in CI it also fails the refresh if any card would change binder slot. A scheduled workflow (`.github/workflows/update-sets.yml`) opens a pull request when the data changes.

Prices are not committed by CI: the production container refreshes them when it starts and every 24 hours.

```bash
npm ci                     # at the repo root
npm run catalog:build      # rebuild app/public/sets
npm run catalog:validate
npm test                   # pipeline tests
```

## Deployment

`docker-compose.yml` runs two containers behind Traefik on one host: the app (`Dockerfile`, nginx on port 8080) and the API (`server/Dockerfile`, port 3001, SQLite on a mounted volume). Traefik sends `/api` to the API and everything else to the app. Environment variables for the API are listed in `server/.env.example`.

Pushing to `main` publishes the app image and triggers a Portainer redeploy (`.github/workflows/docker-publish.yml`). `.github/workflows/checks.yml` runs every type check, lint and test on pull requests.

## Legal

This is an **unofficial fan project**. It is not affiliated with or endorsed by Lucasfilm Ltd., Disney, Fantasy Flight Games, or Asmodee.

“Star Wars” and all related properties are © & ™ Lucasfilm Ltd. “Star Wars: Unlimited” is © & ™ Fantasy Flight Games / Asmodee.

This repository contains **factual card metadata** (names, numbers, sets, aspects, types) for organizational purposes, and no card art, rules text or logos. The app **displays card images** loaded at view time from swu-db.com's image CDN (through the site's own proxy, cached in your browser); they are not stored in or redistributed by this project. If you are a rights holder and have concerns, please contact **matt.grochocinski@gmail.com**.

## License

- **Code:** **PolyForm Noncommercial 1.0.0** — non-commercial use, modification, and redistribution allowed **with attribution**. Commercial use requires prior permission.

For commercial licensing or questions, email **matt.grochocinski@gmail.com**.

## Contributing

Issues and PRs welcome. Please keep changes focused and include screenshots for UI changes.
