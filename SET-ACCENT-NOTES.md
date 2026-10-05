# Set accent tint: unverified, please test (delete this file when done)

Written on a machine with no Node, so **nothing here has been run**: no typecheck, lint, unit tests, or visual check.

## What changed
- `app/src/features/binder/setAccent.ts`: new map of set code to accent hex (SOR, SHD, TWI, JTL, LOF, SEC, LAW, ASH, HMW). IBH and TS26 deliberately have none.
- `app/src/features/binder/BinderPage.tsx`: new `useEffect` sets/clears `--set-accent` on `document.documentElement` for the current set, and clears it on unmount.
- `app/src/styles/global.css`: `body` background is now a fixed top-down gradient, `color-mix(in srgb, var(--set-accent, transparent) 26%, transparent)` fading to transparent over 520px, layered over `--color-bg`.

## Checks to run (from `app/`)
1. `npm ci && npm run typecheck && npm run lint && npm test`. The only new import is `setAccent` in BinderPage.tsx; confirm import-order lint is happy.
2. `npm run e2e`. Confirm no existing test is affected by the body background change.
3. Visual (Playwright screenshots, or `npm run dev`): open `/binder/<SET>` for every set in `app/public/sets/manifest.json` at desktop and phone widths (e.g. 390x844), and screenshot each.
   - Each of the 9 sets shows its colour as a wash at the top of the page. IBH and TS26 show the plain background.
   - **Fallback case:** with `--set-accent` unset, `color-mix(... transparent ...)` must render as no tint, not as a broken or black background. Check IBH, TS26, and the non-binder pages (Decks, Intake, Scan, Put away). If the whole `background` declaration is dropped, the page goes white; fix by giving the unset case an explicit fallback.
   - Navigating between sets updates the tint; leaving the binder (click Decks) clears it.
   - **Contrast:** JTL (yellow) and LOF (light blue) are the brightest, so check that text, toolbar controls and the card table stay readable over the wash. Run an axe check if one exists in the e2e setup.
   - Scrolling a long table doesn't make the gradient scroll or flicker (it uses `background-attachment: fixed`). Note that iOS Safari ignores `fixed` backgrounds, so check whether it looks acceptable there; if not, move the gradient to a `position: fixed` pseudo-element.
4. Judgement calls for the owner: 26% strength and 520px height. Tune in `global.css`. Colours were picked from ranges sampled off the boxes, so adjust any that look wrong in context.

## Optional follow-ups
- A unit test for `setAccent` (known set returns a hex; unknown returns undefined).
- A BinderPage test that `--set-accent` is set on `<html>` and removed on unmount.
