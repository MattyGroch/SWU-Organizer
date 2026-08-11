#!/usr/bin/env node
// scripts/fetch-sets.mjs
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
const OVERRIDES_PATH = path.resolve(process.env.SWU_CARD_OVERRIDES || 'scripts/card-overrides.json');

// CLI: node scripts/fetch-sets.mjs [KEY ...] [--slim]
const args = process.argv.slice(2);
const SLIM = args.includes('--slim');
const KEYS_FILTER = args.filter(a => !a.startsWith('--'));

function log(msg) { process.stdout.write(msg + '\n'); }

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const kv = JSON.parse(raw); // {"SOR":"Spark of Rebellion", ...}
    const all = Object.entries(kv).map(([key, name]) => ({
      key,
      label: `${name} (${key})`,
      file: `SWU-${key}.json`,
    }));
    return KEYS_FILTER.length ? all.filter(s => KEYS_FILTER.includes(s.key)) : all;
  } catch (e) {
    console.error(`✖ Could not read ${CONFIG_PATH}: ${e.message}`);
    process.exit(1);
  }
}

// Manual corrections for known-bad upstream data (e.g. wrong/missing Subtitle) that would
// otherwise get silently reverted every time this script re-fetches from the API.
// Each entry matches by setKey + card name (all printings of that name in that set, unless
// `number` narrows it to one printing) and merges `fields` on top of the fetched card.
async function readOverrides() {
  let raw;
  try {
    raw = await fs.readFile(OVERRIDES_PATH, 'utf8');
  } catch {
    return new Map(); // no overrides file — nothing to apply
  }
  const list = JSON.parse(raw);
  const bySet = new Map();
  for (const entry of list) {
    const forSet = bySet.get(entry.setKey) ?? [];
    forSet.push(entry);
    bySet.set(entry.setKey, forSet);
  }
  return bySet;
}

function applyOverrides(overridesForSet, card, appliedRules) {
  if (!overridesForSet?.length) return card;
  const name = card.Name ?? card.name;
  const number = Number(card.Number ?? card.number);
  const match = overridesForSet.find(
    o => o.name === name && (o.number === undefined || o.number === number),
  );
  if (!match) return card;
  appliedRules?.add(match);
  return { ...card, ...match.fields };
}

async function fetchJSON(url, timeoutMs = 20000) {
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

function slimCard(c) {
  return {
    Name: c?.Name?.trim?.() ?? c?.name ?? '',
    Subtitle: (c?.Subtitle ?? c?.subtitle ?? '').trim?.() || undefined,
    Number: Number(c?.Number ?? c?.number),
    Aspects: Array.isArray(c?.Aspects) ? c.Aspects : (c?.aspects ?? []),
    Type:
      typeof c?.Type === 'string' ? c.Type :
      (c?.Type?.Name ?? c?.type?.Name ?? c?.type ?? undefined),
    Rarity:
      typeof c?.Rarity === 'string' ? c.Rarity :
      (c?.Rarity?.Name ?? c?.rarity?.Name ?? c?.rarity ?? undefined),
  };
}

(async () => {
  log(`SWU fetch-sets • Node ${process.versions.node} • base=${API_BASE} • mode=${SLIM ? 'slim' : 'raw'}`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const sets = await readConfig();
  if (!sets.length) {
    console.error('✖ No sets to fetch (check scripts/sets.config.json or CLI filter).');
    process.exit(1);
  }

  const overridesBySet = await readOverrides();

  const manifest = [];

  for (const { key, label, file } of sets) {
    const url = `${API_BASE}/${encodeURIComponent(key)}`;
    process.stdout.write(`→ ${key} ${label} … `);
    try {
      const data = await fetchJSON(url);
      const arr = Array.isArray(data) ? data : (data?.data ?? data?.cards ?? []);
      const outPath = path.join(OUT_DIR, file);
      const overridesForSet = overridesBySet.get(key);
      const appliedRules = new Set();

      if (SLIM) {
        const mapped = arr
          .map(slimCard)
          .filter(c => c.Name && Number.isFinite(c.Number))
          .map(c => applyOverrides(overridesForSet, c, appliedRules));
        await fs.writeFile(outPath, JSON.stringify({ data: mapped }, null, 2));
      } else {
        const patchedArr = arr.map(c => applyOverrides(overridesForSet, c, appliedRules));
        const patchedData = Array.isArray(data) ? patchedArr : { ...data, data: patchedArr };
        await fs.writeFile(outPath, JSON.stringify(patchedData, null, 2));
      }

      manifest.push({ key, label, file });
      const overrideNote = appliedRules.size ? `, ${appliedRules.size} override rule(s) applied` : '';
      if (overridesForSet?.length && overridesForSet.length !== appliedRules.size) {
        const stale = overridesForSet.filter(o => !appliedRules.has(o));
        console.log(
          `\n  ⚠ ${stale.length} override rule(s) for ${key} matched nothing (stale?): ` +
            stale.map(o => o.name + (o.number !== undefined ? ` #${o.number}` : '')).join(', '),
        );
        process.stdout.write(`  `);
      }
      console.log(`saved ${path.relative(process.cwd(), outPath)} (${arr?.length ?? 0} cards${overrideNote})`);
    } catch (e) {
      console.log(`failed: ${e.message}`);
      // keep going to build manifest for the rest, but mark non-zero exit
      process.exitCode = 1;
    }
  }

  // Always write a manifest of what we just processed
  const mPath = path.join(OUT_DIR, 'manifest.json');
  await fs.writeFile(mPath, JSON.stringify({ sets: manifest }, null, 2));
  log(`✓ manifest written: ${path.relative(process.cwd(), mPath)}`);
})();
