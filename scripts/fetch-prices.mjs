#!/usr/bin/env node
// scripts/fetch-prices.mjs — compact price overlays for runtime refresh (no full card JSON rewrite)
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(`✖ Node ${process.versions.node} detected. Please use Node 18+ (global fetch required).`);
  process.exit(1);
}

const CONFIG_PATH = path.resolve(process.env.SWU_SETS_CONFIG || 'scripts/sets.config.json');
const OUT_DIR = path.resolve(process.env.SWU_SETS_DIR || 'public/sets');
const API_BASE = process.env.SWU_DB_BASE || 'https://api.swu-db.com/cards';
const MAX_ATTEMPTS = Math.max(1, Number(process.env.SWU_FETCH_RETRIES || 3) || 3);
const BASE_DELAY_MS = Math.max(100, Number(process.env.SWU_FETCH_RETRY_MS || 1500) || 1500);

const args = process.argv.slice(2);
const KEYS_FILTER = args.filter(a => !a.startsWith('--'));

function log(msg) {
  process.stdout.write(msg + '\n');
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const kv = JSON.parse(raw);
    const all = Object.entries(kv).map(([key, name]) => ({
      key,
      label: `${name} (${key})`,
      file: `SWU-${key}.json`,
      pricesFile: `SWU-${key}.prices.json`,
    }));
    return KEYS_FILTER.length ? all.filter(s => KEYS_FILTER.includes(s.key)) : all;
  } catch (e) {
    console.error(`✖ Could not read ${CONFIG_PATH}: ${e.message}`);
    process.exit(1);
  }
}

async function fetchJSON(url, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally {
    clearTimeout(t);
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
        const d = BASE_DELAY_MS * attempt;
        log(`  … retry ${attempt}/${MAX_ATTEMPTS} in ${d}ms (${e.message})`);
        await new Promise(r => setTimeout(r, d));
      }
    }
  }
  throw lastErr;
}

function parsePrice(c) {
  const v = c?.MarketPrice ?? c?.Price ?? c?.marketPrice ?? c?.price;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractPrices(arr) {
  /** @type {Record<string, number>} */
  const prices = {};
  for (const c of arr) {
    const num = Number(c?.Number ?? c?.number);
    const p = parsePrice(c);
    if (!Number.isFinite(num) || p === null) continue;
    prices[String(num)] = p;
  }
  return prices;
}

(async () => {
  log(`SWU fetch-prices • Node ${process.versions.node} • out=${OUT_DIR} • api=${API_BASE}`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const sets = await readConfig();
  if (!sets.length) {
    console.error('✖ No sets (check scripts/sets.config.json or CLI filter).');
    process.exit(1);
  }

  for (const { key, pricesFile } of sets) {
    const url = `${API_BASE}/${encodeURIComponent(key)}`;
    process.stdout.write(`→ ${key} prices … `);
    try {
      const data = await fetchWithRetry(url);
      const arr = Array.isArray(data) ? data : (data?.data ?? data?.cards ?? []);
      const prices = extractPrices(arr);
      const payload = {
        version: 1,
        setKey: key,
        updatedAt: new Date().toISOString(),
        prices,
      };
      const outPath = path.join(OUT_DIR, pricesFile);
      await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
      console.log(`saved ${path.relative(process.cwd(), outPath)} (${Object.keys(prices).length} rows)`);
    } catch (e) {
      console.log(`failed: ${e.message}`);
      process.exitCode = 1;
    }
  }

  log('✓ fetch-prices done');
})();
