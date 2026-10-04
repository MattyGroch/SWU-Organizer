# Feedback & issues

Running list for the v2 rebuild (`app/`). Claude reads this at the start of each phase, so
anything filed here gets picked up at the next phase boundary rather than waiting for the
end of the refactor.

Add items anywhere under the right heading. Rough notes are fine — "the spread pager looks
cramped on my monitor" is actionable. Delete items once they're resolved, or move them to
**Done** if you want a record.

---

## Blocking

Things that are wrong enough to fix before the next phase builds on top of them.

- [ ]

## Bugs

Something behaves incorrectly. Most useful shape: what you did → what you expected → what
happened, plus the set/card if it's specific.

- [ ]

## Visual / UX

Layout, spacing, colour, density, anything that feels wrong in use. **This is the most
valuable category right now** — I have no way to see the running app, so every visual
judgement so far is unverified.

- [ ] (nothing open — refile anything still wrong)


## Behaviour changes I should reconsider

Deliberate departures from the legacy app. Push back on any of these and I'll revert or
rework them.

- [ ] `+`/`−` moved out of the binder cells into the selected-card panel (nesting three
      widgets per gridcell breaks the keyboard grid pattern — but it costs mouse users a
      click)
- [ ] Unselected binder cells dim (brightness 0.62) while a card on the visible spread is
      selected; with nothing selected, every card is fully lit
- [ ] Counts are no longer capped at the playset quota; extras show as `3/3 +2` spares
- [ ] `xlsx` now installs from `cdn.sheetjs.com` rather than npm, to clear two unfixable
      high-severity advisories — adds a non-registry dependency to `npm ci`

## Ideas / later

Not now, but don't lose it.

- [ ] **Backups don't include the intake queue yet** — only matters if something is mid-review.
- [ ] **Export to other collection tools** — format per tool, once the targets are picked.
      Must include the cards inside owned precons: they are sealed (never pulled) but owned.

---

## Done

- [x] **Intake queue.** New Intake page (count badge in the nav): cards wait there, nothing
      owned yet, until a batch is reviewed and added. "Add to collection" on an unbuilt saved
      deck queues its cards at Normal; one row per card with allocation buttons
      (N | F | H | HF | P | PF …) — click one to move a copy off Normal, Shift/right-click to
      move it back — then "Add & mark deck built" — the cards go straight into
      the deck's box and binder counts don't change. The scanner will feed scanned batches
      into the same queue. The old "Physical copy" deck option is gone.

- [x] **Decks tab rebuilt to v1 parity, plus partial builds.** My decks (save, rename, delete
      with undo, copy missing), Construct / Complete / Deconstruct pick lists in binder order,
      and decks that stay built with cards missing — flagged "owned elsewhere" vs "not owned".
      Building can take cards from another built deck (per card, opt-in); built decks get
      −/+ per card. Binder counts drop for pulled copies (⇢N marker, Decks column, "Hide out
      in decks" filter). Precons are sealed: owned, never in deck math; tile picker with
      own all / clear all, per set too. Sideboard never counts toward a deck being complete.

- [x] **Backup and restore with every import option.** "Download backup" saves every printing
      plus saved decks and precons as one JSON. Importing any file (backup, SW-Unlimited,
      SWUDB) offers: Add to collection · Only add what I'm missing · Keep the higher count ·
      Replace these sets · Replace entire collection, with an optional deck restore.

- [x] **Collection progress bar is back.** Green / amber / red stacked bar with ✓ ! ✕ counts
      and a "% complete" readout, over whatever the filters show. Replaces the plain
      Cards / Complete / Partial / Missing numbers; Value and To finish stay beside it.

- [x] **One card table instead of Inventory / Missing tabs.** Lists every card in the set;
      filters (e.g. Status ✕ or !) do what the Missing tab did. Columns: Status, Owned,
      Spare, Need, Value, Cost.
- [x] **Copy buttons are always visible and copy exactly what the filters show.** Labels
      carry the count they'll copy — "Copy full need (32)", "Copy 1 each (14)" — and they
      disable when nothing shown is needed.

- [x] **Status column restored to the Inventory and Missing tables.** The port dropped it;
      it's back after Type as a coloured ✓ / ! / ✕, sharing its glyphs and labels with the
      Status filter so the two can't drift apart.
- [x] **Nothing selected → every card lit.** Cells only dim when the visible spread holds
      the selection. Missing cards are now much darker (brightness 0.32, lower contrast).
- [x] **Foil sparkle pushed down to 12%** so it clears the card's title bar.

- [x] **Showcase copies now always show the foil mark.** Corroborated by the catalog:
      Normal, Hyperspace and Prestige each have a separate foil SKU and Showcase has
      none — exactly what you'd expect if every Showcase card is already foil. This meant
      separating two things that had been conflated: "is foil" and "has its own artwork".
      Showcase is foil *and* has unique art, while the three `*-foil` SKUs are duplicates
      that 404 on the CDN. A Showcase slot still uses the Showcase picture.
- [x] **Foil mark is now a large translucent sparkle in the top-right corner** — 50% of
      the card's width, ~50% opacity (65% when selected) so the art reads through it, and
      clear of the count and rarity along the bottom. Drawn as an SVG rather than a text glyph: a percentage `font-size`
      resolves against the parent font size, not the card, so a character could not be
      sized relative to the slot. Scale is one variable, `--foil-size` in
      `BinderCell.module.css`.

- [x] **Search results now scroll with the keyboard, and show far more of them.** Two
      problems: arrowing past the list's lower edge never scrolled the highlight into
      view, so a result below the fold could be selected but never seen; and the limit was
      10 while searching all 11 sets — "Vader" is 13 cards across 8 sets, so three were
      silently dropped. Limit raised to 25 with a "more matches — keep typing" note when
      it truncates, so nothing is hidden without saying so.

- [x] **Search scope no longer flickers between one set and all of them.** `loadedSets`
      read the query cache during render without subscribing, so search covered only the
      active set until some unrelated re-render happened to pick up the rest. It now
      subscribes via `useQueries` and widens deterministically as the prefetch lands.
      (Ranking already put current-set results first — that part was working.)
- [x] **Choosing a card from another set now actually selects it and turns to its page.**
      The cross-set branch navigated with a `?card=` param that nothing read. The route
      now validates and consumes it, so same-set and cross-set picks behave identically —
      and a binder position is linkable: `/binder/SOR?card=31`.
- [x] **Switching sets resets the view.** Found while fixing the above: the route reuses
      the binder component across sets, so the previous set's open spread and selection
      persisted — moving from SOR page 12 to another set landed on its page 12 with a
      stale highlight.

- [x] **Shift+plus fills a playset, Shift+minus empties the slot.** Shift+minus clears
      every printing of the card and offers **Undo** in a toast rather than a
      confirmation prompt — a prompt would interrupt the filing flow the shortcut exists
      to speed up. Shift+plus tops the Normal printing up to the card's own quota (1 for
      a Leader/Base, 3 normally, 15 for Swarming Vulture Droid) and never reduces a count,
      so spares survive it.

- [x] **Leaders and Bases are rotated 90° counter-clockwise**, matching how they sit in a
      physical pocket. Verified against the CDN: those two types are 1560x1117 landscape
      and everything else is 1120x1560 portrait — and 1.4 is exactly 7/5, so a rotated
      card fills a 5/7 pocket almost perfectly. The count/rarity overlay stays upright.

- [x] **Card art was not loading at all.** `cdn.swu-db.com` is an S3 bucket that sends no
      `Access-Control-Allow-Origin` header, so the browser blocked the cross-origin
      `fetch` and the error was swallowed into the text fallback. Art is now proxied
      same-origin via `/card-art` (vite in dev, `app/docker/nginx.conf` in production),
      which is also what makes canvas downscaling and offline caching possible.
- [x] **Foil is now a sparkle overlay, not separate art.** Only non-foil images are ever
      fetched; a ✦ marks any slot where you own a foil copy. Serialized keeps its own art
      since the stamp is genuinely different.
- [x] **Unselected cells are muted again** (brightness 0.62 / saturate 0.75, 0.85 on
      hover, full on selection). The count/rarity overlay stays at full brightness so it
      is still readable on dimmed cells.

- [x] **Global text size bumped one step** — the whole type scale (xs 12→13, sm 14→15,
      md 16→17, lg 20→22, xl 28→30), so everything inherits it rather than being patched
      per component.
- [x] **`S` rarity glyph now has a white outline.** Every rarity got a dark halo for
      contrast against artwork; Special is pure black, so it gets a white one instead.
- [x] **Filters regrouped by category** — Aspect / Rarity / Type / Status / Name are now
      separate bordered `fieldset`s with legends, instead of one undifferentiated pool.
      Chips and the status glyphs are larger too.
- [x] **Per-slot count is now the loudest thing in the cell** — ~20px, weight 900, on a
      dark pill, green when the playset is complete.
- [x] **Binder cells now show real card art** (your choice of the two options). Uses the
      most premium printing you own — Prestige > Showcase > Hyperspace > Normal — and
      greyscales the slot when you own none. Foil printings resolve to their non-foil
      sibling's art, because foil URLs 404 on the CDN. Images are downscaled to 360px and
      cached in IndexedDB on first view (~3-4 MB per set instead of 130 MB); the text
      layout is what shows while loading or if an image can't be fetched, so the binder
      still works offline and on a cold cache.
