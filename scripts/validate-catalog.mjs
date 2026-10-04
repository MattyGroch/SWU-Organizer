#!/usr/bin/env node
// scripts/validate-catalog.mjs — Phase 0 gate for the v2 catalog.
//
// The check that matters most is BACKWARD COMPATIBILITY: a saved inventory is keyed by
// base card number, so if v2 ever resolves a different base than the legacy pipeline did,
// a user's collection silently re-points at the wrong cards. That is unrecoverable
// without a backup, so it is asserted on every run against the committed legacy data.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { VARIANTS, numericPart } from './lib/catalog.mjs';

const CATALOG_DIR = path.resolve(process.env.SWU_CATALOG_DIR || 'app/public/sets');
const LEGACY_DIR = path.resolve(process.env.SWU_LEGACY_SETS_DIR || 'public/sets');

const failures = [];
const notes = [];
function fail(msg) {
  failures.push(msg);
}

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** The legacy base rule: group by name|subtitle|type, take the lowest integer Number. */
function legacyBases(legacyCards) {
  const groups = new Map();
  for (const c of legacyCards) {
    if (!Number.isFinite(Number(c.Number))) continue;
    const key = [
      String(c.Name ?? '')
        .trim()
        .toLowerCase(),
      String(c.Subtitle ?? '')
        .trim()
        .toLowerCase(),
      String(c.Type ?? '')
        .trim()
        .toLowerCase(),
    ].join('|');
    const current = groups.get(key);
    if (current === undefined || Number(c.Number) < current) groups.set(key, Number(c.Number));
  }
  return groups;
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

        if (/F$/.test(printing.num)) suffixFoils += 1;

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

    // THE BACKWARD-COMPATIBILITY GATE.
    const legacyFile = path.join(LEGACY_DIR, file);
    let legacy;
    try {
      legacy = await readJSON(legacyFile);
    } catch (e) {
      if (e.code === 'ENOENT') {
        notes.push(`${key}: no legacy catalog to compare against (new set?)`);
        continue;
      }
      throw e;
    }

    const legacyMap = legacyBases(legacy.data ?? []);
    let compared = 0;
    for (const card of catalog.cards) {
      const legacyBase = legacyMap.get(v2Key(card));
      if (legacyBase === undefined) continue; // card absent from the older snapshot
      compared += 1;
      if (legacyBase !== card.base) {
        fail(`${key}: BASE DRIFT for "${card.name}" — legacy ${legacyBase}, v2 ${card.base}`);
      }
    }
    if (compared === 0) notes.push(`${key}: legacy comparison matched zero cards`);
  }

  console.log(
    `Validated ${manifest.sets.length} sets • ${totalCards} cards • ${totalPrintings} printings`,
  );
  console.log(
    `Suffix-numbered foils present: ${suffixFoils} (legacy pipeline dropped all of these)`,
  );
  for (const note of notes) console.log(`  note: ${note}`);

  if (failures.length) {
    console.error(`\n✖ ${failures.length} validation failure(s):`);
    for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
    if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
    process.exit(1);
  }
  console.log(
    '\n✓ catalog valid — base numbers match the legacy pipeline, saved inventories stay correctly keyed',
  );
})().catch((e) => {
  console.error(`✖ ${e.stack ?? e.message}`);
  process.exit(1);
});
