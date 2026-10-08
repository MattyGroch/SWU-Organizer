#!/usr/bin/env node
// scripts/validate-catalog.mjs — the CI gate for the card catalog.
//
// The check that matters most is STABILITY: every owned card is filed under its base card
// number (its binder slot), so if a data refresh ever resolved a card to a different base,
// a collection would silently re-point at the wrong slots. CI therefore snapshots the
// committed catalog before regenerating it, and this script compares the two
// (SWU_REFERENCE_DIR). With no reference given, that comparison is skipped.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { VARIANTS, numericPart, promoParts } from './lib/catalog.mjs';

const CATALOG_DIR = path.resolve(process.env.SWU_CATALOG_DIR || 'app/public/sets');
const REFERENCE_DIR = process.env.SWU_REFERENCE_DIR
  ? path.resolve(process.env.SWU_REFERENCE_DIR)
  : null;

const failures = [];
const notes = [];
function fail(msg) {
  failures.push(msg);
}

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function v2Key(card) {
  return [
    card.name.trim().toLowerCase(),
    String(card.subtitle ?? '')
      .trim()
      .toLowerCase(),
    String(card.type ?? '')
      .trim()
      .toLowerCase(),
  ].join('|');
}

(async () => {
  const manifest = await readJSON(path.join(CATALOG_DIR, 'manifest.json'));
  if (manifest.version !== 2) fail(`manifest.json is version ${manifest.version}, expected 2`);

  let totalCards = 0;
  let totalPrintings = 0;
  let suffixFoils = 0;
  let promoPrintings = 0;

  for (const entry of manifest.sets) {
    const { key, file } = entry;
    const catalog = await readJSON(path.join(CATALOG_DIR, file));

    if (catalog.setKey !== key) fail(`${key}: catalog setKey is ${catalog.setKey}`);
    if (!catalog.cards.length) fail(`${key}: catalog has no cards`);

    const seenBases = new Set();
    const seenPrintings = new Set();

    for (const card of catalog.cards) {
      totalCards += 1;

      if (seenBases.has(card.base)) fail(`${key}: duplicate base number ${card.base}`);
      seenBases.add(card.base);

      if (!card.printings.length) fail(`${key}#${card.base}: no printings`);
      if (!card.name) fail(`${key}#${card.base}: missing name`);
      if (!card.type) fail(`${key}#${card.base}: missing type`);

      // Tokens are play aids, never binder slots.
      if (/token/i.test(card.type ?? ''))
        fail(`${key}#${card.base}: token type leaked in (${card.type})`);

      let normalAtBase = false;
      for (const printing of card.printings) {
        totalPrintings += 1;

        if (!VARIANTS.includes(printing.variant)) {
          fail(`${key}#${card.base}: unknown variant slug "${printing.variant}"`);
        }
        if (/^T\d+$/i.test(printing.num))
          fail(`${key}#${card.base}: token number ${printing.num} leaked in`);
        if (seenPrintings.has(printing.num))
          fail(`${key}: printing ${printing.num} appears on two cards`);
        seenPrintings.add(printing.num);

        if (/^\d+F$/.test(printing.num)) suffixFoils += 1;

        // A promo is numbered in its own promo set's run, so it is checked for
        // shape and kind only: its number says nothing about the base card's slot.
        const promo = promoParts(printing.num);
        if (promo || printing.variant === 'promo' || printing.variant === 'promo-foil') {
          if (!promo || !(printing.variant === 'promo' || printing.variant === 'promo-foil')) {
            fail(
              `${key}#${card.base}: promo printing ${printing.num} (${printing.variant}) is malformed`,
            );
          }
          promoPrintings += 1;
          continue;
        }

        // Every printing must resolve back to its own card.
        if (numericPart(printing.num) < card.base) {
          fail(`${key}#${card.base}: printing ${printing.num} sorts below its own base`);
        }
        if (printing.variant === 'normal' && numericPart(printing.num) === card.base)
          normalAtBase = true;
      }

      if (!normalAtBase) {
        fail(`${key}#${card.base}: no Normal printing sits at the base number`);
      }
    }

    // Price overlay must only reference printings that exist.
    const pricesFile = path.join(CATALOG_DIR, file.replace(/\.json$/, '.prices.json'));
    try {
      const priceDoc = await readJSON(pricesFile);
      const unknown = Object.keys(priceDoc.prices).filter((num) => !seenPrintings.has(num));
      if (unknown.length) {
        fail(
          `${key}: price overlay references ${unknown.length} unknown printing(s), e.g. ${unknown.slice(0, 5).join(', ')}`,
        );
      }
    } catch (e) {
      if (e.code === 'ENOENT')
        notes.push(`${key}: no price overlay yet (run fetch-catalog-prices)`);
      else fail(`${key}: price overlay unreadable — ${e.message}`);
    }

    // THE STABILITY GATE: no card may change binder slot between refreshes.
    if (!REFERENCE_DIR) continue;
    let reference;
    try {
      reference = await readJSON(path.join(REFERENCE_DIR, file));
    } catch (e) {
      if (e.code === 'ENOENT') {
        notes.push(`${key}: not in the previous catalog (new set?)`);
        continue;
      }
      throw e;
    }

    const previousBase = new Map((reference.cards ?? []).map((card) => [v2Key(card), card.base]));
    let compared = 0;
    for (const card of catalog.cards) {
      const before = previousBase.get(v2Key(card));
      if (before === undefined) continue; // a card added by this refresh
      compared += 1;
      if (before !== card.base) {
        fail(`${key}: BASE DRIFT for "${card.name}" — was ${before}, now ${card.base}`);
      }
    }
    if (compared === 0) notes.push(`${key}: matched no cards in the previous catalog`);
  }

  console.log(
    `Validated ${manifest.sets.length} sets • ${totalCards} cards • ${totalPrintings} printings`,
  );
  console.log(`Suffix-numbered foils present: ${suffixFoils} • promo printings: ${promoPrintings}`);
  for (const note of notes) console.log(`  note: ${note}`);

  if (failures.length) {
    console.error(`\n✖ ${failures.length} validation failure(s):`);
    for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
    if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
    process.exit(1);
  }
  console.log(
    REFERENCE_DIR
      ? '\n✓ catalog valid — every card kept its binder slot since the previous catalog'
      : '\n✓ catalog valid (no previous catalog given, so slot stability was not compared)',
  );
})().catch((e) => {
  console.error(`✖ ${e.stack ?? e.message}`);
  process.exit(1);
});
