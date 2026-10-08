#!/usr/bin/env node
// scripts/fetch-catalog.mjs — build the v2 card-centric catalog under app/public/sets/.
//
// Differs from the legacy scripts/fetch-sets.mjs in three ways that matter:
//   1. Printing numbers stay strings, so SOR-era foils ("059F") survive instead of
//      becoming NaN and being silently dropped.
//   2. Every printing records its VariantType, so the app can track what you own.
//   3. Base-number resolution happens here, at build time, instead of being re-derived
//      in the browser on every page load.
//
// Prices are deliberately NOT written here — they live in a separate overlay refreshed
// on its own schedule (see fetch-catalog-prices.mjs), so a price move never churns the
// card catalog in git.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  attachEventPromos,
  attachPromos,
  buildSetCatalog,
  isEventPromoSet,
} from './lib/catalog.mjs';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(
    `✖ Node ${process.versions.node} detected. Please use Node 18+ (global fetch required).`,
  );
  process.exit(1);
}

const CONFIG_PATH = path.resolve(process.env.SWU_SETS_CONFIG || 'scripts/sets.config.json');
const OUT_DIR = path.resolve(process.env.SWU_CATALOG_DIR || 'app/public/sets');
const API_BASE = process.env.SWU_DB_BASE || 'https://api.swu-db.com/cards';
const SETS_API = process.env.SWU_SETS_API || 'https://api.swu-db.com/sets';

/**
 * Each set's weekly-play promo set (`SOR` → `SOROP`, `HMW` → `HMWP`): the child set whose
 * name ends "OP Promo".
 */
function promoSetsByParent(setRows) {
  const map = new Map();
  for (const row of setRows) {
    if (row.parentSetId && /- OP Promo$/i.test(String(row.fullName ?? '').trim())) {
      map.set(String(row.parentSetId).toUpperCase(), String(row.setId));
    }
  }
  return map;
}

const OVERRIDES_PATH = path.resolve(
  process.env.SWU_CARD_OVERRIDES || 'scripts/card-overrides.json',
);

const args = process.argv.slice(2);
const KEYS_FILTER = args.filter((a) => !a.startsWith('--'));

function log(msg) {
  process.stdout.write(msg + '\n');
}

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  const kv = JSON.parse(raw);
  const all = Object.entries(kv).map(([key, name]) => ({
    key,
    label: `${name} (${key})`,
    file: `SWU-${key}.json`,
  }));
  return KEYS_FILTER.length ? all.filter((s) => KEYS_FILTER.includes(s.key)) : all;
}

/**
 * Manual corrections for known-bad upstream data. These must be merged into each raw
 * printing *before* grouping, because an override may supply a `Subtitle` — and the
 * subtitle is part of the identity that decides which printings are the same card.
 */
async function readOverrides() {
  let raw;
  try {
    raw = await fs.readFile(OVERRIDES_PATH, 'utf8');
  } catch {
    return new Map();
  }
  const bySet = new Map();
  for (const entry of JSON.parse(raw)) {
    const forSet = bySet.get(entry.setKey) ?? [];
    forSet.push(entry);
    bySet.set(entry.setKey, forSet);
  }
  return bySet;
}

function applyOverrides(overridesForSet, card, appliedRules) {
  if (!overridesForSet?.length) return card;
  const match = overridesForSet.find(
    (o) =>
      o.name === card.Name && (o.number === undefined || String(o.number) === String(card.Number)),
  );
  if (!match) return card;
  appliedRules.add(match);
  return { ...card, ...match.fields };
}

async function fetchJSON(url, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  log(`SWU fetch-catalog • Node ${process.versions.node} • base=${API_BASE}`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const sets = await readConfig();
  if (!sets.length) {
    console.error('✖ No sets to fetch (check scripts/sets.config.json or the CLI filter).');
    process.exit(1);
  }

  const overridesBySet = await readOverrides();
  const setRows = await fetchJSON(SETS_API);
  const promoSets = promoSetsByParent(Array.isArray(setRows) ? setRows : []);
  const rowsOf = (payload) =>
    Array.isArray(payload) ? payload : (payload?.data ?? payload?.cards ?? []);
  const built = [];

  for (const { key, label, file } of sets) {
    process.stdout.write(`→ ${key} ${label} … `);
    try {
      const rows = rowsOf(await fetchJSON(`${API_BASE}/${encodeURIComponent(key)}`));

      const overridesForSet = overridesBySet.get(key);
      const appliedRules = new Set();
      const patched = rows.map((card) => applyOverrides(overridesForSet, card, appliedRules));

      const catalog = buildSetCatalog(key, patched);
      catalog.label = label;

      // Weekly-play promos are printings of these cards. A promo that matches no card
      // fails the run: dropping it would silently lose a printing someone owns.
      const promoSet = promoSets.get(key.toUpperCase());
      let promoCount = 0;
      if (promoSet) {
        const promoRows = rowsOf(await fetchJSON(`${API_BASE}/${encodeURIComponent(promoSet)}`));
        const unmatched = attachPromos(catalog, promoSet, promoRows);
        if (unmatched.length) {
          throw new Error(`${promoSet} promos match no ${key} card: ${unmatched.join('; ')}`);
        }
        promoCount = promoRows.length;
      }

      built.push({ key, label, file, catalog, promoSet, eventPromoSets: [] });

      if (overridesForSet?.length && overridesForSet.length !== appliedRules.size) {
        const stale = overridesForSet.filter((o) => !appliedRules.has(o));
        console.log(
          `\n  ⚠ ${stale.length} override rule(s) for ${key} matched nothing (stale?): ` +
            stale.map((o) => o.name + (o.number !== undefined ? ` #${o.number}` : '')).join(', '),
        );
        process.stdout.write('  ');
      }

      const printings = catalog.cards.reduce((n, c) => n + c.printings.length, 0);
      const overrideNote = appliedRules.size ? `, ${appliedRules.size} override rule(s)` : '';
      const promoNote = promoSet ? `, ${promoCount} ${promoSet} promos` : '';
      console.log(
        `${catalog.cards.length} cards / ${printings} printings${promoNote}${overrideNote}`,
      );
    } catch (e) {
      console.log(`failed: ${e.message}`);
      process.exitCode = 1;
    }
  }

  // Event, judge, convention, gift box and other promos reprint cards from any set, so
  // they attach once every set is built. Unlike weekly OP promos they only warn when they
  // match nothing: they often promote a card from a set that isn't out yet.
  const mainKeys = new Set(Object.keys(JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'))));
  const eventSets = (Array.isArray(setRows) ? setRows : []).filter((row) =>
    isEventPromoSet(row, mainKeys),
  );
  const catalogs = built.map((b) => b.catalog);
  for (const row of eventSets) {
    const promoSet = String(row.setId).trim().toUpperCase();
    process.stdout.write(`→ ${promoSet} ${row.fullName} … `);
    try {
      const promoRows = rowsOf(await fetchJSON(`${API_BASE}/${encodeURIComponent(promoSet)}`));
      const { unmatched, touched } = attachEventPromos(catalogs, promoSet, promoRows);
      for (const b of built) if (touched.has(b.key)) b.eventPromoSets.push(promoSet);
      console.log(`attached to ${[...touched].join(', ') || 'nothing'}`);
      // A filtered run only builds some sets, so most rows are expected to miss.
      if (unmatched.length && !KEYS_FILTER.length) {
        console.log(`  ⚠ ${unmatched.length} match no card: ${unmatched.join('; ')}`);
      }
    } catch (e) {
      console.log(`failed: ${e.message}`);
      process.exitCode = 1;
    }
  }

  const manifest = [];
  for (const { key, label, file, catalog, promoSet, eventPromoSets } of built) {
    await fs.writeFile(path.join(OUT_DIR, file), JSON.stringify(catalog, null, 2) + '\n');
    const printings = catalog.cards.reduce((n, c) => n + c.printings.length, 0);
    manifest.push({
      key,
      label,
      file,
      cards: catalog.cards.length,
      printings,
      ...(promoSet ? { promoSet } : {}),
      ...(eventPromoSets.length ? { eventPromoSets } : {}),
    });
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, sets: manifest }, null, 2) + '\n');
  log(`✓ manifest written: ${path.relative(process.cwd(), manifestPath)}`);
})();
