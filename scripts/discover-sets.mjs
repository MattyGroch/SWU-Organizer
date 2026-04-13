#!/usr/bin/env node
// scripts/discover-sets.mjs — write scripts/sets.config.json from GET /sets
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(`✖ Node ${process.versions.node} detected. Please use Node 18+ (global fetch required).`);
  process.exit(1);
}

const OUT_PATH = path.resolve('scripts/sets.config.json');
const OVERRIDES_PATH = path.resolve('scripts/sets.discover-overrides.json');
const SETS_API = process.env.SWU_SETS_API || 'https://api.swu-db.com/sets';
const MIN_CARDS = Math.max(0, Number(process.env.SWU_DISCOVER_MIN_CARDS || 200) || 200);

function log(msg) {
  process.stdout.write(msg + '\n');
}

async function fetchJSON(url, timeoutMs = 30000) {
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

/**
 * @typedef {{ setId: string, fullName: string, numberCards?: number, parentSetId?: string, releaseDate?: string }} ApiSet
 */

/**
 * @param {ApiSet[]} rows
 * @param {{ includeSetIds: string[], excludeSetIds: string[] }} ov
 */
function discover(rows, ov) {
  const exclude = new Set((ov.excludeSetIds || []).map(s => s.toUpperCase()));
  const include = new Set((ov.includeSetIds || []).map(s => s.toUpperCase()));

  /** @type {Map<string, string>} */
  const out = new Map();

  for (const r of rows) {
    const id = String(r.setId || '').trim();
    if (!id) continue;
    const up = id.toUpperCase();

    if (exclude.has(up)) continue;

    const parent = r.parentSetId != null && String(r.parentSetId).trim() !== '';
    const n = Number(r.numberCards);
    const cardsOk = Number.isFinite(n) && n >= MIN_CARDS;
    const name = String(r.fullName || '').trim();
    const nameLooksPromoSubset = name.includes(' - ');

    if (include.has(up)) {
      out.set(id, name || id);
      continue;
    }

    if (parent) continue;
    if (!cardsOk) continue;
    if (nameLooksPromoSubset) continue;

    out.set(id, name || id);
  }

  return out;
}

function sortKeys(map) {
  return [...map.keys()].sort((a, b) => a.localeCompare(b));
}

(async () => {
  log(`SWU discover-sets • ${SETS_API} • minCards=${MIN_CARDS}`);

  let overrides = { includeSetIds: [], excludeSetIds: [] };
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, 'utf8');
    overrides = JSON.parse(raw);
  } catch (e) {
    log(`(no overrides file or empty: ${OVERRIDES_PATH})`);
  }

  const rows = await fetchJSON(SETS_API);
  if (!Array.isArray(rows)) {
    console.error('✖ Expected array from /sets');
    process.exit(1);
  }

  const map = discover(rows, overrides);
  const keys = sortKeys(map);
  /** @type {Record<string, string>} */
  const obj = {};
  for (const k of keys) {
    obj[k] = map.get(k) ?? k;
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(obj, null, 2) + '\n');
  log(`✓ wrote ${OUT_PATH} (${keys.length} sets)`);
})();
