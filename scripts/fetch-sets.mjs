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

const CONFIG_PATH = path.resolve('scripts/sets.config.json');
const OUT_DIR = path.resolve('public/sets');
const API_BASE = process.env.SWU_DB_BASE || 'https://api.swu-db.com/cards';

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

  const manifest = [];

  for (const { key, label, file } of sets) {
    const url = `${API_BASE}/${encodeURIComponent(key)}`;
    process.stdout.write(`→ ${key} ${label} … `);
    try {
      const data = await fetchJSON(url);
      const arr = Array.isArray(data) ? data : (data?.data ?? data?.cards ?? []);
      const outPath = path.join(OUT_DIR, file);

      if (SLIM) {
        const mapped = arr.map(slimCard).filter(c => c.Name && Number.isFinite(c.Number));
        await fs.writeFile(outPath, JSON.stringify({ data: mapped }, null, 2));
      } else {
        await fs.writeFile(outPath, JSON.stringify(data, null, 2));
      }

      manifest.push({ key, label, file });
      console.log(`saved ${path.relative(process.cwd(), outPath)} (${arr?.length ?? 0} cards)`);
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
