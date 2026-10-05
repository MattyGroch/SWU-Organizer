#!/usr/bin/env node
// scripts/fetch-catalog-prices.mjs — v2 price overlays, keyed by string printing number.
//
// Kept separate from the card catalog on purpose: the Docker entrypoint refreshes prices
// every 24h independent of git, so bundling them into the catalog would make the daily CI
// job open pull requests on price drift alone.
//
// The v1 overlay was keyed by base number, which meant every copy you owned was valued at
// the Normal printing's price. Keying by printing number lets a Prestige Serialized be
// worth what a Prestige Serialized is actually worth.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { buildPriceTable } from './lib/catalog.mjs';

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
const MAX_ATTEMPTS = Math.max(1, Number(process.env.SWU_FETCH_RETRIES || 3) || 3);
const BASE_DELAY_MS = Math.max(100, Number(process.env.SWU_FETCH_RETRY_MS || 1500) || 1500);

const args = process.argv.slice(2);
const KEYS_FILTER = args.filter((a) => !a.startsWith('--'));

function log(msg) {
  process.stdout.write(msg + '\n');
}

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  // The catalog manifest names each set's weekly-play promo set, whose printings are
  // priced alongside the set's own.
  let manifest = { sets: [] };
  try {
    manifest = JSON.parse(await fs.readFile(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
  } catch {
    // no manifest yet: base printings only
  }
  const promoSets = new Map(manifest.sets.map((s) => [s.key, s.promoSet]));
  const all = Object.keys(JSON.parse(raw)).map((key) => ({
    key,
    promoSet: promoSets.get(key),
    pricesFile: `SWU-${key}.prices.json`,
  }));
  return KEYS_FILTER.length ? all.filter((s) => KEYS_FILTER.includes(s.key)) : all;
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

async function fetchWithRetry(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchJSON(url);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * attempt;
        log(`  … retry ${attempt}/${MAX_ATTEMPTS} in ${delay}ms (${e.message})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

(async () => {
  log(`SWU fetch-catalog-prices • Node ${process.versions.node} • out=${OUT_DIR}`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const sets = await readConfig();
  if (!sets.length) {
    console.error('✖ No sets (check scripts/sets.config.json or the CLI filter).');
    process.exit(1);
  }

  const rowsOf = (payload) =>
    Array.isArray(payload) ? payload : (payload?.data ?? payload?.cards ?? []);
  for (const { key, promoSet, pricesFile } of sets) {
    process.stdout.write(`→ ${key} prices … `);
    try {
      const payload = await fetchWithRetry(`${API_BASE}/${encodeURIComponent(key)}`);
      const prices = buildPriceTable(rowsOf(payload));
      if (promoSet) {
        const promoPayload = await fetchWithRetry(`${API_BASE}/${encodeURIComponent(promoSet)}`);
        Object.assign(prices, buildPriceTable(rowsOf(promoPayload), promoSet));
      }
      const outPath = path.join(OUT_DIR, pricesFile);
      await fs.writeFile(
        outPath,
        JSON.stringify(
          { version: 2, setKey: key, updatedAt: new Date().toISOString(), prices },
          null,
          2,
        ) + '\n',
      );
      console.log(`${Object.keys(prices).length} printings priced`);
    } catch (e) {
      console.log(`failed: ${e.message}`);
      process.exitCode = 1;
    }
  }

  log('✓ fetch-catalog-prices done');
})();
