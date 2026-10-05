# Feedback & issues

Running list for the v2 rebuild (`app/`). Claude reads this at the start of each phase, so anything filed here gets picked up at the next phase boundary rather than waiting for the end of the refactor.

Add items anywhere under the right heading. Rough notes are fine — "the spread pager looks cramped on my monitor" is actionable. Delete items once they're resolved, or move them to **Done** if you want a record.

---

## For Matt

Your own list: things to try, questions only you can answer, and setup only you can do. Claude adds items here when it needs your input; tick them off or answer inline.

### Validate / test

- [ ] **Deck lifecycle in production** — build decks that need a premium copy (Prestige, Showcase); build a second deck that _takes_ a card from the first; use −/+ on a built deck; deconstruct both. Check the binder art returns the right printing to each pocket.
- [x] **Phone view** — below 760px the binder grid is hidden: search, filters and the card table remain; tap a row to select it, and its controls pin to the bottom of the screen. Check on a real phone: `cd app && npm run dev -- --host`, then open the "Network" URL it prints. Filters should start folded. Also eyeball Decks, Intake and the pick-list dialog at that width.
- [x] **Bulk edit** — try it on a filtered selection, then Undo; reset a set, then Undo. New: the **Whole collection** scope (your note) — same filters across every binder set, behind a toggle with a warning; one Undo reverses all of it.
- [x] **Scrolling** — your two scroll notes should be fixed (see Done): on desktop, scrolling the card table should no longer make the page taller; on a phone, the page should end at the bottom of the content. Please confirm on both.
- [x] **Shortcuts help** — press `?` (or the Shortcuts button); is anything missing or wrong?
- [ ] **Backups** — keep taking offline exports; restore one now and then to be sure it works.

### Questions to answer

- [x] **TS26 / IBH double count?** The Vault import added 140 TS26 and 104 IBH copies to the inventory. If those are the cards inside your precon boxes _and_ the precons are ticked as owned, they'd count twice once exports include precon contents. Which side owns them?
- [ ] **Export targets** — which collection sites should exports support, and their formats?

### To do / provide

- [x] **Finish the v2 launch**: merge #52; on swu.mattyflix.com import your backup with **Replace entire collection** and sign in; on photonOS switch `/opt/swu-organizer` to `main` (`git checkout main && git pull`).
- [ ] Later: when Portainer is back, **delete or detach stack 99 first** (it's v1 — a redeploy would start it on top of v2), then let Portainer adopt `/opt/swu-organizer` as a git stack and restore the redeploy step in `docker-publish.yml`.
- [ ] Once v2 has proved itself: delete `/var/config/swu-organizer/v1-backup/` and the `v1-rollback` image tags on photonOS.
- [ ] **HMW precon decklists** — paste them in and Claude will build the precon files.
- [ ] Optional: delete the empty leftover branch — `git branch -d rebuild/v2-foundation`.

---

## Blocking

Things that are wrong enough to fix before the next phase builds on top of them.

- [x] The card scanner has a toggle for scanning both portrait and vertical cards, but I'd prefer it always scan in portrait, with the ability to recognize horizontal print cards in either 90 degree or 270 degree formats. I"ll likely be using a dedicated scanner apparatus that only accepts cards in one orientation. **Done (`00d04b7`):** the guide is always portrait and the toggle is gone; Leaders and Bases match turned either way round. Please test a few Leaders and Bases both ways up.
- [x] The card scanner should be able to recognize a Leader card by the front or the back, but I'd most likely be scanning the horizontal face of the card. **Done (`00d04b7`):** backs are indexed too; the result says "read from the back".
- [x] IF when scanning a card to add, I already have the maximum cards for that binder slot, throw a warn to the user and do not add the card. (Example message: "Maximum count reached for card: [Title], add to bulk."). This would not apply to higher value printings. Example, scanning a foil hyperspace if I have 2 hyperspace and 1 normal would instead prompt me to replace the normal in the playset, or drop the lowest value printing from the binder.) **Done (`00d04b7`):** a full pocket shows "Maximum count reached for X — add to bulk" (with "Add anyway, as a spare"). A better printing is added straight away with "Bumps a Normal X to bulk" (and a "Keep both" button), per your follow-up. A swap shows in Intake as "Swaps out 1 Normal — to bulk" with a Keep button, and committing removes that copy. "Full" counts owned copies, less those in built decks, plus anything already waiting in Intake.

## Bugs

Something behaves incorrectly. Most useful shape: what you did → what you expected → what happened, plus the set/card if it's specific.

- [ ]

## Visual / UX

Layout, spacing, colour, density, anything that feels wrong in use. **This is the most valuable category right now** — I have no way to see the running app, so every visual judgement so far is unverified.

- [ ] (None)

## Ideas / later

Not now, but don't lose it.

- [ ] **Scan index size** — `app/public/scan-data/index.bin` is ~1.5 MB (1.2 MB gzipped), mostly the 8×8 colour grid per printing. Could shrink (fewer bits per channel) if first-scan download time matters on mobile data; re-run the builder's robustness test after any change.
- [ ] **Scan index refresh** — new sets need `cd app && npx tsx scripts/build-scan-index.ts` (downloads only new images to `~/.cache/swu-organizer/card-art`, ~4 min) and the result committed. Not in CI yet (needs the image cache).
- [ ] **Scanner (Phase 5): two modes.**
  - **Scan / info** — scanning a card only selects it and turns the binder to its slot; nothing is added. For looking a card up, or checking whether you need it.
  - **Add** — every scan adds the card to an Intake "Scanned" batch, for working through a stack. Nothing counts as owned until you review that batch (variants, foils — the camera can't tell foil from non-foil) and commit it to the binder. Decided 2026-10-04.
- [ ] **Backups don't include the intake queue yet** — only matters if something is mid-review.
- [ ] **Export to other collection tools** — format per tool, once the targets are picked. Must include the cards inside owned precons: they are sealed (never pulled) but owned.
- [ ] Layout update: Instead of a tab at the top for "binder", have it listed as Inventory, with two subpages underneath: "binder" and "list" then break up the binder view and inventory list into two different tabs rather than keeping them open at the same time. The binder view wouldn't be visible on mobile at all.
- [ ] Layout update, alt: Instead of viewing thw whole spread of a binder, only view one page at a time, then use the other half of the viewport to have the inventory list so on web/computer you can see both simultaneously rather than having to scroll.

---

## Done

- [x] **v2 is live on swu.mattyflix.com (2026-10-04).** Deployed from `/opt/swu-organizer` with docker compose on photonOS (Portainer is down); clean database, v1's moved to `v1-backup/`, v1 images tagged `v1-rollback`. One fix along the way: photonOS's strict umask made `app/public` files unreadable to nginx (403s) — the image now normalises permissions (#52).

- [x] **v1 retired; v2 is the production app (in the repo).** v1's source, data and root config are gone; the root is the card-data pipeline. New `Dockerfile` serves `app/` with nginx (card-art proxy, security headers on every response, camera allowed for the scanner, daily price refresh). CI: a **Checks** workflow for app/server/pipeline, and the daily data refresh now guards against cards changing binder slot. README rewritten. Deployed 2026-10-04.

- [x] **Cloud sync (app side).** Sign-in and account menu with sync status; pulls on sign-in, tab focus, reconnect and every 5 minutes; edits on two devices merge (cards per printing, decks per deck, deletions remembered); a first-sign-in choice when a device and the cloud both hold a collection. Server keeps deleted-deck records. Setup: `app/docs/cloud-sync.md`. Verified locally 2026-10-04 with the v1 OAuth client: 11 sets, 6,455 copies and the deck library reached the server; a second window downloaded it. Production wiring (nginx `/api`) still to do.

- [x] **Page no longer grows as the card table scrolls (desktop), and no blank page at the bottom (phone).** Both were one bug: rows carry screen-reader-only labels (the rarity name, the status) that are `position: absolute`, and the table's scroll box wasn't positioned — so those labels escaped its clipping and stretched the page to wherever their rows sat, deeper with every scroll. The scroll box now contains them; the same fix went into the five other scrolling boxes (deck tables, pick list, intake, import dialog, the phone binder grid).
- [x] **Bulk edit can act on the whole collection.** A "This set / Whole collection" toggle; the whole-collection scope applies the same filters to every binder set, with a warning (and backup link) while it's on. Hidden sets like TS26 are left out. It loads every set first, so opening it early can't skip sets still loading. One Undo reverses every set's change.

- [x] **Printing badges have − and +.** Each printing in the selected-card panel is now `− [digit · name · count] +`, so a printing can be removed by mouse or touch — before, only Shift+digit or right-click could, neither of which a phone has. − is disabled at zero; the buttons are fingertip-sized (32px).

- [x] **No binder grid on phones.** Below 760px the page is search, filters and the card table; tapping a row selects the card and its controls stick to the bottom of the screen. The table drops Spare, Decks, Value and Cost there, and the Shortcuts button is hidden (no keyboard). Filters now fold away (closed by default on phones, open on desktop) with an "N active" badge so a folded panel never hides a filter.

- [x] **Validated by Matt (2026-10-04):** binder mirrors the pages, Sets menu, precons, keyboard-only pass, intake, export / import, deck check and construct.
- [x] **Prestige Serialized shows the foil sparkle.** Every Serialized is foil, like Showcase; it keeps its own stamped artwork.
- [x] **Keyboard shortcuts help is back.** Press `?` or the "Shortcuts" button in the binder toolbar. The list lives next to the key map in `shortcuts.ts`, so they're edited together.

- [x] **Bulk edit (replaces v1's Bulk Actions).** "Bulk edit" in the binder toolbar acts on exactly the cards the filters show: +1 (only up to a playset), Fill to playset, −1 (plainest printing first), Clear (every printing). Reset… empties a set, or the whole collection after typing RESET; both can return affected built decks to Not built. Every change offers Undo. Binder shortcuts are now ignored while any dialog is open.

- [x] **Intake queue.** New Intake page (count badge in the nav): cards wait there, nothing owned yet, until a batch is reviewed and added. "Add to collection" on an unbuilt saved deck queues its cards at Normal; one row per card with allocation buttons (N | F | H | HF | P | PF …) — click one to move a copy off Normal, Shift/right-click to move it back — then "Add & mark deck built" — the cards go straight into the deck's box and binder counts don't change. The scanner will feed scanned batches into the same queue. The old "Physical copy" deck option is gone.

- [x] **Decks tab rebuilt to v1 parity, plus partial builds.** My decks (save, rename, delete with undo, copy missing), Construct / Complete / Deconstruct pick lists in binder order, and decks that stay built with cards missing — flagged "owned elsewhere" vs "not owned". Building can take cards from another built deck (per card, opt-in); built decks get −/+ per card. Binder counts drop for pulled copies (⇢N marker, Decks column, "Hide out in decks" filter). Precons are sealed: owned, never in deck math; tile picker with own all / clear all, per set too. Sideboard never counts toward a deck being complete.

- [x] **Backup and restore with every import option.** "Download backup" saves every printing plus saved decks and precons as one JSON. Importing any file (backup, SW-Unlimited, SWUDB) offers: Add to collection · Only add what I'm missing · Keep the higher count · Replace these sets · Replace entire collection, with an optional deck restore.

- [x] **Collection progress bar is back.** Green / amber / red stacked bar with ✓ ! ✕ counts and a "% complete" readout, over whatever the filters show. Replaces the plain Cards / Complete / Partial / Missing numbers; Value and To finish stay beside it.

- [x] **One card table instead of Inventory / Missing tabs.** Lists every card in the set; filters (e.g. Status ✕ or !) do what the Missing tab did. Columns: Status, Owned, Spare, Need, Value, Cost.
- [x] **Copy buttons are always visible and copy exactly what the filters show.** Labels carry the count they'll copy — "Copy full need (32)", "Copy 1 each (14)" — and they disable when nothing shown is needed.

- [x] **Status column restored to the Inventory and Missing tables.** The port dropped it; it's back after Type as a coloured ✓ / ! / ✕, sharing its glyphs and labels with the Status filter so the two can't drift apart.
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

- [x] **Card art was not loading at all.** `cdn.swu-db.com` is an S3 bucket that sends no `Access-Control-Allow-Origin` header, so the browser blocked the cross-origin `fetch` and the error was swallowed into the text fallback. Art is now proxied same-origin via `/card-art` (vite in dev, `app/docker/nginx.conf` in production), which is also what makes canvas downscaling and offline caching possible.
- [x] **Foil is now a sparkle overlay, not separate art.** Only non-foil images are ever fetched; a ✦ marks any slot where you own a foil copy. Serialized keeps its own art since the stamp is genuinely different.
- [x] **Unselected cells are muted again** (brightness 0.62 / saturate 0.75, 0.85 on hover, full on selection). The count/rarity overlay stays at full brightness so it is still readable on dimmed cells.

- [x] **Global text size bumped one step** — the whole type scale (xs 12→13, sm 14→15, md 16→17, lg 20→22, xl 28→30), so everything inherits it rather than being patched per component.
- [x] **Rarity letters are outlined to their colour** — near-black on Uncommon, Rare and Legendary, white on Common and Special — with a drop shadow, and inset from the card's right edge. The table's black `S` gets a white outline too.
- [x] **Filters regrouped by category** — Aspect / Rarity / Type / Status / Name are now separate bordered `fieldset`s with legends, instead of one undifferentiated pool. Chips and the status glyphs are larger too.
- [x] **Per-slot count is now the loudest thing in the cell** — ~20px, weight 900, on a dark pill, green when the playset is complete.
- [x] **Binder cells now show real card art** (your choice of the two options). Uses the most premium printing you own — Prestige > Showcase > Hyperspace > Normal — and greyscales the slot when you own none. Foil printings resolve to their non-foil sibling's art, because foil URLs 404 on the CDN. Images are downscaled to 360px and cached in IndexedDB on first view (~3-4 MB per set instead of 130 MB); the text layout is what shows while loading or if an image can't be fetched, so the binder still works offline and on a cold cache.
