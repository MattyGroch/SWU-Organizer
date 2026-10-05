# Feedback & issues

Running list for SWU Organizer v2 (`app/`). Claude reads this at the start of each session and after each chunk of work, so anything filed here gets picked up.

Add items anywhere under the right heading. Rough notes are fine — "the spread pager looks cramped on my monitor" is actionable. Delete items once they're resolved, or move them to **Done** if you want a record.

---

## For Matt

Your own list: things to try, questions only you can answer, and setup only you can do. Claude adds items here when it needs your input; tick them off or answer inline.

### Validate / test

- [ ] **Scanner, new behaviour** — scan a few Leaders and Bases turned both ways up, and a Leader from its back. Scan a card you already have a playset of (should say "Maximum count reached — add to bulk", add nothing), and a better printing of a full card (should add it and say "Bumps a Normal … to bulk"). Commit that batch and check the Normal left the collection.
- [ ] **Install as an app** — on your phone, "Add to Home Screen" from swu.mattyflix.com; open it from the icon; visit Scan once, then try scanning in airplane mode.
- [ ] **Deck lifecycle in production** — build decks that need a premium copy (Prestige, Showcase); build a second deck that _takes_ a card from the first; use −/+ on a built deck; deconstruct both. Check the binder art returns the right printing to each pocket.
- [ ] **Backups** — keep taking offline exports; restore one now and then to be sure it works.

### Questions to answer

- [ ] **Export targets** — which collection sites should exports support, and their formats?

### To do / provide

- [ ] **Point of no return** — tell Claude when you start using the live app for real. Until then, breaking changes and data loss are fair game; after it, data is protected and you import your collection from zero.
- [ ] **HMW precon decklists** — paste them in and Claude will build the precon files.
- [ ] Later: when Portainer is back, **delete or detach stack 99 first** (it's v1 — a redeploy would start it on top of v2), then let Portainer adopt `/opt/swu-organizer` as a git stack and restore the redeploy step in `docker-publish.yml`.
- [ ] Once v2 has proved itself: delete `/var/config/swu-organizer/v1-backup/`, the `v1-rollback` image tags, and the `pre-scan` image tag on photonOS.
- [ ] Optional: delete the empty leftover branch — `git branch -d rebuild/v2-foundation`.

---

## Blocking

Things that are wrong enough to fix before building further on top of them.

- (none)

## Bugs

Something behaves incorrectly. Most useful shape: what you did → what you expected → what happened, plus the set/card if it's specific.

- (none)

## Visual / UX

Layout, spacing, colour, density, anything that feels wrong in use. Claude can now screenshot the app at phone and desktop sizes, but your eyes on a real device still catch the most.

- (none)

## Mobile

Phone-specific tweaks and thoughts.

- (none)

## Ideas / later

Not now, but don't lose it.

- [ ] **Layout: Inventory with Binder and List subpages.** Rename the "Binder" tab to Inventory, with two subpages — Binder and List — instead of showing both at once. The binder view wouldn't be on mobile at all.
- [ ] **Layout, alternative: one binder page beside the list.** Show one binder page at a time instead of the whole spread, and use the other half of the screen for the inventory list, so on a computer you see both without scrolling.
- [ ] **Revisit a holo foil effect.** Tried (Oct 2026, dev-only, scrapped): a full-card rainbow gradient blended into the art (`mix-blend-mode: overlay`, 30% opacity, corner to corner) that slides with the pointer, plus a stronger "holo" take with tighter repeating bands and a diagonal shine (`color-dodge`) moving the opposite way. It worked, but didn't look right — the plain rainbow read as a whole-card tint shift rather than a sheen. Kept the SVG sparkle. If revisited: tighter bands so several colours show at once, and decide what happens on touch (tilt?).
- [ ] **Export to other collection tools** — format per tool, once the targets are picked. Must include the cards inside owned precons: they are sealed (never pulled) but owned.
- [ ] **Scan index size** — `app/public/scan-data/index.bin` is ~1.9 MB (~1.5 MB gzipped), mostly the 8×8 colour grid per picture. Could shrink (fewer bits per channel) if first-scan download time matters on mobile data; re-run the builder's robustness test after any change. It's cached after the first visit.
- [ ] **Scan index refresh** — new sets need `cd app && npx tsx scripts/build-scan-index.ts` (downloads only new images to `~/.cache/swu-organizer/card-art`, ~9 min) and the result committed. Not in CI yet (needs the image cache).
- [ ] **Backups don't include the intake queue yet** — only matters if something is mid-review.
- [ ] **Node 20 is past end of life** (April 2026). The Docker images, CI and local dev all run Node 20; move to Node 24 LTS — check `sharp` and `better-sqlite3` build on it.
- [ ] **Docker publish actions are several majors behind** (`docker/*` v3–v6 → v4–v7, `setup-qemu`). That workflow only runs after a merge, so bump it on its own and watch the first run.

---

## Done

- [x] **v2.0.0 released (2026-10-05).** PR #53 merged; `main` tagged `v2.0.0` with a GitHub release (now "Latest"); the repo's About has the new description, the live site link and topics; the server runs from `main`.
- [x] **Scanner: better printings are added without asking (2026-10-04).** A scan that beats the weakest copy in a full pocket goes straight into Intake with "Bumps a Normal X to bulk" and a "Keep both" button; a copy no better than what's there is not added: "Maximum count reached for X — add to bulk", with "Add anyway, as a spare". Bumped copies show in Intake as "Swaps out 1 Normal — to bulk" (with Keep) and leave the collection when the batch is committed. "Full" counts owned copies, less those in built decks, plus anything already waiting in Intake.
- [x] **Scanner: always portrait, and Leader backs.** The Card / Leader-Base toggle is gone; Leaders and Bases match turned either way round (including a few Hyperspace Bases the CDN stores already turned), and Leaders also scan from the back ("read from the back"). 6,472 reference pictures; right card and treatment 99.1%, hand-held 98.9%.
- [x] **Installable and offline.** "Add to Home Screen" installs it as an app (binder-page icon, shortcuts to Scan and Intake). A service worker lets it open — and scan — offline after one visit; a deploy still shows up on the next load. Rolling back past it is covered in `docs/deploy.md`.
- [x] **End-to-end tests and phone screenshots.** `npm run e2e` (also in CI): a fake camera plays a video of a real card held off-centre and the scanner must queue it; the app must open and scan with the network cut. `npm run screenshots -- <backups>` captures every page and dialog at iPhone SE and Pixel 7 sizes and flags anything wider than the screen.
- [x] **Mobile pass over every page.** Compact two-row header (the old nav made every page scroll sideways), wrapping deck buttons, a card table whose names fit (Owned is coloured by status), a compact selected-card panel with a close button, search results that keep the name, readable links, and dark-themed file pickers.
- [x] **Intake on phones: a Fix sheet per card.** Rows show the card, a printing summary (2 N · 1 H), the count and a Fix button; the sheet has the art, large printing buttons, −/+, reset and remove. A single copy moves to whichever printing is tapped.
- [x] **Scanner accuracy on a real phone.** It used to fingerprint the whole guide, so a card held a little small or off-centre matched wrongly; it now finds the card inside the guide first (hand-held: ~0% → 98%). The result panel shows under the camera on phones without scrolling, and a view with no recognisable card says so instead of guessing.
- [x] **Scanner (Phase 5).** `/scan` with two modes — **Add to Intake** (every scan queues in a "Scanned cards" batch, reviewed and committed like any other) and **Look up** (shows the card's binder location) — plus Correct, Rescan, "Which set?" for identical reprints and "Is this the right card?" when unsure. Torch button where the phone has one.
- [x] **TS26 / IBH double count** — answered.
- [x] **Phone view, bulk edit, scrolling and shortcuts help validated by Matt.**
- [x] **v2 launch finished** — #52 merged, backup restored on the live site, signed in.

- [x] **v2 is live on swu.mattyflix.com (2026-10-04).** Deployed from `/opt/swu-organizer` with docker compose on photonOS (Portainer is down); clean database, v1's moved to `v1-backup/`, v1 images tagged `v1-rollback`. One fix along the way: photonOS's strict umask made `app/public` files unreadable to nginx (403s) — the image now normalises permissions (#52).

- [x] **v1 retired; v2 is the production app (in the repo).** v1's source, data and root config are gone; the root is the card-data pipeline. New `Dockerfile` serves `app/` with nginx (card-art proxy, security headers on every response, camera allowed for the scanner, daily price refresh). CI: a **Checks** workflow for app/server/pipeline, and the daily data refresh now guards against cards changing binder slot. README rewritten. Deployed 2026-10-04.

- [x] **Cloud sync (app side).** Sign-in and account menu with sync status; pulls on sign-in, tab focus, reconnect and every 5 minutes; edits on two devices merge (cards per printing, decks per deck, deletions remembered); a first-sign-in choice when a device and the cloud both hold a collection. Server keeps deleted-deck records. Setup: `app/docs/cloud-sync.md`. In production, Traefik routes `/api` to the API container.

- [x] **Page no longer grows as the card table scrolls (desktop), and no blank page at the bottom (phone).** Both were one bug: rows carry screen-reader-only labels (the rarity name, the status) that are `position: absolute`, and the table's scroll box wasn't positioned — so those labels escaped its clipping and stretched the page to wherever their rows sat, deeper with every scroll. The scroll box now contains them; the same fix went into the five other scrolling boxes (deck tables, pick list, intake, import dialog, the phone binder grid).
- [x] **Bulk edit can act on the whole collection.** A "This set / Whole collection" toggle; the whole-collection scope applies the same filters to every binder set, with a warning (and backup link) while it's on. Hidden sets like TS26 are left out. It loads every set first, so opening it early can't skip sets still loading. One Undo reverses every set's change.

- [x] **Printing badges have − and +.** Each printing in the selected-card panel is now `− [digit · name · count] +`, so a printing can be removed by mouse or touch — before, only Shift+digit or right-click could, neither of which a phone has. − is disabled at zero; the buttons are fingertip-sized.

- [x] **No binder grid on phones.** Below 760px the page is search, filters and the card table; tapping a row selects the card and its controls stick to the bottom of the screen. Filters fold away (closed by default on phones, open on desktop) with an "N active" badge so a folded panel never hides a filter.

- [x] **Validated by Matt (2026-10-04):** binder mirrors the pages, Sets menu, precons, keyboard-only pass, intake, export / import, deck check and construct.
- [x] **Prestige Serialized shows the foil sparkle.** Every Serialized is foil, like Showcase; it keeps its own stamped artwork.
- [x] **Keyboard shortcuts help is back.** Press `?` or the "Shortcuts" button in the binder toolbar. The list lives next to the key map in `shortcuts.ts`, so they're edited together.

- [x] **Bulk edit (replaces v1's Bulk Actions).** "Bulk edit" in the binder toolbar acts on exactly the cards the filters show: +1 (only up to a playset), Fill to playset, −1 (plainest printing first), Clear (every printing). Reset… empties a set, or the whole collection after typing RESET; both can return affected built decks to Not built. Every change offers Undo. Binder shortcuts are now ignored while any dialog is open.

- [x] **Intake queue.** New Intake page (count badge in the nav): cards wait there, nothing owned yet, until a batch is reviewed and added. "Add to collection" on an unbuilt saved deck queues its cards at Normal; one row per card with allocation buttons (N | F | H | HF | P | PF …) — click one to move a copy off Normal, Shift/right-click to move it back — then "Add & mark deck built" — the cards go straight into the deck's box and binder counts don't change. The old "Physical copy" deck option is gone.

- [x] **Decks tab rebuilt to v1 parity, plus partial builds.** My decks (save, rename, delete with undo, copy missing), Construct / Complete / Deconstruct pick lists in binder order, and decks that stay built with cards missing — flagged "owned elsewhere" vs "not owned". Building can take cards from another built deck (per card, opt-in); built decks get −/+ per card. Binder counts drop for pulled copies (⇢N marker, Decks column, "Hide out in decks" filter). Precons are sealed: owned, never in deck math; tile picker with own all / clear all, per set too. Sideboard never counts toward a deck being complete.

- [x] **Backup and restore with every import option.** "Download backup" saves every printing plus saved decks and precons as one JSON. Importing any file (backup, SW-Unlimited, SWUDB, Hyperspace Vault) offers: Add to collection · Only add what I'm missing · Keep the higher count · Replace these sets · Replace entire collection, with an optional deck restore.

- [x] **Collection progress bar is back.** Green / amber / red stacked bar with ✓ ! ✕ counts and a "% complete" readout, over whatever the filters show. Value and To finish stay beside it.

- [x] **One card table instead of Inventory / Missing tabs.** Lists every card in the set; filters (e.g. Status ✕ or !) do what the Missing tab did. Columns: Status, Owned, Spare, Need, Value, Cost.
- [x] **Copy buttons are always visible and copy exactly what the filters show.** Labels carry the count they'll copy — "Copy full need (32)", "Copy 1 each (14)" — and they disable when nothing shown is needed.

- [x] **Status column restored to the card table.** The port dropped it; it's back after Type as a coloured ✓ / ! / ✕, sharing its glyphs and labels with the Status filter so the two can't drift apart.
- [x] **Nothing selected → every card lit.** Cells only dim when the visible spread holds the selection. Missing cards are now much darker (brightness 0.32, lower contrast).
- [x] **Foil sparkle pushed down to 12%** so it clears the card's title bar.

- [x] **Showcase copies now always show the foil mark.** Corroborated by the catalog: Normal, Hyperspace and Prestige each have a separate foil SKU and Showcase has none — exactly what you'd expect if every Showcase card is already foil. This meant separating two things that had been conflated: "is foil" and "has its own artwork". Showcase is foil _and_ has unique art, while the three `*-foil` SKUs are duplicates that 404 on the CDN. A Showcase slot still uses the Showcase picture.
- [x] **Foil mark is now a large translucent sparkle at the top right** (12% down, clear of the title bar) — 50% of the card's width, ~50% opacity (65% when selected) so the art reads through it, and clear of the count and rarity along the bottom. Drawn as an SVG rather than a text glyph: a percentage `font-size` resolves against the parent font size, not the card, so a character could not be sized relative to the slot. Scale is one variable, `--foil-size` in `BinderCell.module.css`.

- [x] **Search results now scroll with the keyboard, and show far more of them.** Two problems: arrowing past the list's lower edge never scrolled the highlight into view, so a result below the fold could be selected but never seen; and the limit was 10 while searching all 11 sets — "Vader" is 13 cards across 8 sets, so three were silently dropped. Limit raised to 25 with a "more matches — keep typing" note when it truncates, so nothing is hidden without saying so.

- [x] **Search scope no longer flickers between one set and all of them.** `loadedSets` read the query cache during render without subscribing, so search covered only the active set until some unrelated re-render happened to pick up the rest. It now subscribes via `useQueries` and widens deterministically as the prefetch lands. (Ranking already put current-set results first — that part was working.)
- [x] **Choosing a card from another set now actually selects it and turns to its page.** The cross-set branch navigated with a `?card=` param that nothing read. The route now validates and consumes it, so same-set and cross-set picks behave identically — and a binder position is linkable: `/binder/SOR?card=31`.
- [x] **Switching sets resets the view.** Found while fixing the above: the route reuses the binder component across sets, so the previous set's open spread and selection persisted — moving from SOR page 12 to another set landed on its page 12 with a stale highlight.

- [x] **Shift+plus fills a playset, Shift+minus empties the slot.** Shift+minus clears every printing of the card and offers **Undo** in a toast rather than a confirmation prompt — a prompt would interrupt the filing flow the shortcut exists to speed up. Shift+plus tops the Normal printing up to the card's own quota (1 for a Leader/Base, 3 normally, 15 for Swarming Vulture Droid) and never reduces a count, so spares survive it.

- [x] **Leaders and Bases are rotated 90° counter-clockwise**, matching how they sit in a physical pocket. Verified against the CDN: those two types are 1560x1117 landscape and everything else is 1120x1560 portrait — and 1.4 is exactly 7/5, so a rotated card fills a 5/7 pocket almost perfectly. The count/rarity overlay stays upright.

- [x] **Card art was not loading at all.** `cdn.swu-db.com` is an S3 bucket that sends no `Access-Control-Allow-Origin` header, so the browser blocked the cross-origin `fetch` and the error was swallowed into the text fallback. Art is now proxied same-origin via `/card-art` (vite in dev, `docker/nginx.conf` in production), which is also what makes canvas downscaling and offline caching possible.
- [x] **Foil is now a sparkle overlay, not separate art.** Only non-foil images are ever fetched; a ✦ marks any slot where you own a foil copy. Serialized keeps its own art since the stamp is genuinely different.
- [x] **Unselected cells are muted again** (brightness 0.62 / saturate 0.75, 0.85 on hover, full on selection). The count/rarity overlay stays at full brightness so it is still readable on dimmed cells.

- [x] **Global text size bumped one step** — the whole type scale (xs 12→13, sm 14→15, md 16→17, lg 20→22, xl 28→30), so everything inherits it rather than being patched per component.
- [x] **Rarity letters are outlined to their colour** — near-black on Uncommon, Rare and Legendary, white on Common and Special — with a drop shadow, and inset from the card's right edge. The table's black `S` gets a white outline too.
- [x] **Filters regrouped by category** — Aspect / Rarity / Type / Status / Name are now separate bordered `fieldset`s with legends, instead of one undifferentiated pool. Chips and the status glyphs are larger too.
- [x] **Per-slot count is now the loudest thing in the cell** — ~20px, weight 900, on a dark pill, green when the playset is complete.
- [x] **Binder cells now show real card art.** Uses the most premium printing you own — Prestige > Showcase > Hyperspace > Normal — and greyscales the slot when you own none. Foil printings resolve to their non-foil sibling's art, because foil URLs 404 on the CDN. Images are downscaled to 360px and cached in IndexedDB on first view (~3-4 MB per set instead of 130 MB); the text layout is what shows while loading or if an image can't be fetched, so the binder still works offline and on a cold cache.
