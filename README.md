# SWU Organizer

Track a **Star Wars: Unlimited** collection the way it sits in your binders — slot by slot, printing by printing — scan cards in with your phone's camera, and build decks from it.

Live at **[swu.mattyflix.com](https://swu.mattyflix.com)** (sign-in is limited to an allowlist; everything else works without an account).

## Features

- **Binder view** — every set laid out as binder spreads, with real card art, the playset count in each pocket, and a foil mark on foil copies. Leaders and Bases sit sideways, as they do in a pocket.
- **Every printing tracked** — Normal, Foil, Hyperspace, Hyperspace Foil, Showcase, Prestige, Prestige Foil and Prestige Serialized are counted separately, and the binder shows the most premium copy you own.
- **Fast filing** — keyboard-first: `+`/`−` for a card, `1`–`8` for a specific printing, arrows to move, `/` to search across every set. Press `?` in the app for the full list.
- **Decks** — paste a decklist (swudb JSON, Melee, picklist or plain text) to check it against your collection and its format's rules (Premier, Twin Suns). Save it, then construct it with a pick list in binder order; deconstruct puts the same printings back. A deck can be partly built, flagged with what's missing and whether you own it elsewhere.
- **Precons** — owned precon decks count toward your collection but stay sealed.
- **Card scanner** — point a phone at a card: it is recognised from the card art (every printing, including Hyperspace and Leader backs, ~99% on the right card and treatment) and either queued for your collection or looked up in your binder. It knows when a binder pocket is already full — "add to bulk" — and when a better printing should bump a weaker copy out.
- **Intake** — a review queue for cards entering the collection (scanned cards, or a deck bought built): check each copy's printing before it counts.
- **Bulk edit, import and backup** — fill or clear whatever the filters show; import SW-Unlimited, SWUDB or Hyperspace Vault exports; download a full backup and restore it with add / only-missing / keep-higher / replace options.
- **Cloud sync** — sign in with Google to keep every device in step; offline changes sync later, and edits on two devices merge.
- **Works on a phone, and offline** — on small screens the binder becomes a searchable list with the selected card's controls at hand. Add it to your home screen to install it as an app; after one visit it opens, and scans, without a connection.

## Repository layout

| Path                    | What it is                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `app/`                  | The web app — React 19, Vite, TanStack Router/Query, IndexedDB (Dexie).               |
| `server/`               | The sync API — Express, SQLite, Google OAuth.                                         |
| `scripts/`              | The card-data pipeline: builds the catalog from swu-db.com and validates it.          |
| `app/public/sets/`      | The committed card catalog, refreshed daily by CI.                                    |
| `app/public/precons/`   | Precon decklists.                                                                     |
| `app/public/scan-data/` | The scanner's index of card fingerprints, built by `app/scripts/build-scan-index.ts`. |
| `app/e2e/`              | End-to-end tests (Playwright), including the scanner with a fake camera.              |
| `Dockerfile`, `docker/` | The app's production image (nginx).                                                   |

## Development

```bash
cd app
npm ci
npm run dev        # http://localhost:5173
npm test           # unit and integration tests
npm run typecheck
npm run lint
npm run e2e        # end to end, against a production build (first: npx playwright install chromium)
```

`npm run screenshots -- <backup.json …>` (with `npm run dev` running) imports the given backups into a fresh browser profile, screenshots every page and dialog at phone sizes, and flags anything wider than the screen.

The app works fully on its own — everything is stored in the browser. To try cloud sync locally too, run the API alongside it; setup (including the Google OAuth client) is in [`app/docs/cloud-sync.md`](app/docs/cloud-sync.md).

```bash
cd server
npm ci
npm run dev        # http://localhost:3001 — reads server/.env
```

To check the app on a phone on the same network: `npm run dev -- --host` in `app/`, then open the "Network" address it prints. (The camera needs a secure page, so test the scanner on the deployed site or over https.)

## Card data

`scripts/fetch-catalog.mjs` builds one catalog file per set from the swu-db.com API, keeping every printing and resolving each card's base number (its binder slot). `scripts/validate-catalog.mjs` checks it; in CI it also fails the refresh if any card would change binder slot. A scheduled workflow (`.github/workflows/update-sets.yml`) opens a pull request when the data changes.

Prices are not committed by CI: the production container refreshes them when it starts and every 24 hours.

The scanner's index is rebuilt by hand when a set is added: `cd app && npx tsx scripts/build-scan-index.ts` downloads any new card images (cached in `~/.cache/swu-organizer/card-art`), fingerprints every printing, writes `app/public/scan-data/`, and self-tests recognition — it fails if accuracy drops below 95%.

```bash
npm ci                     # at the repo root
npm run catalog:build      # rebuild app/public/sets
npm run catalog:validate
npm test                   # pipeline tests
```

## Deployment

`docker-compose.yml` runs two containers behind Traefik on one host: the app (`Dockerfile`, nginx on port 8080) and the API (`server/Dockerfile`, port 3001, SQLite on a mounted volume). Traefik sends `/api` to the API and everything else to the app. The app runs the image published to Docker Hub on every merge to `main`, and Watchtower on the host deploys each new one within a day (`docker compose up -d swu-organizer` deploys at once); the API is built on the host. Settings go in a `.env` next to the compose file (template: `.env.example`).

Full steps — everyday deploys, trying a branch, pinning a tag to roll back: [`docs/deploy.md`](docs/deploy.md).

`.github/workflows/docker-publish.yml` publishes the app image on every push to `main` and every release tag, and `.github/workflows/checks.yml` runs every type check, lint and test on pull requests.

## Legal

This is an **unofficial fan project**. It is not affiliated with or endorsed by Lucasfilm Ltd., Disney, Fantasy Flight Games, or Asmodee.

“Star Wars” and all related properties are © & ™ Lucasfilm Ltd. “Star Wars: Unlimited” is © & ™ Fantasy Flight Games / Asmodee.

This repository contains **factual card metadata** (names, numbers, sets, aspects, types) for organizational purposes, and no card art, rules text or logos. The scanner's index holds compact numeric fingerprints computed from card images, not the images themselves. The app **displays card images** loaded at view time from swu-db.com's image CDN (through the site's own proxy, cached in your browser); they are not stored in or redistributed by this project. If you are a rights holder and have concerns, please contact **matt.grochocinski@gmail.com**.

## License

- **Code:** **PolyForm Noncommercial 1.0.0** — non-commercial use, modification, and redistribution allowed **with attribution**. Commercial use requires prior permission.

For commercial licensing or questions, email **matt.grochocinski@gmail.com**.

## Contributing

Issues and PRs welcome. Please keep changes focused and include screenshots for UI changes.
