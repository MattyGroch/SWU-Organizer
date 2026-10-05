#!/usr/bin/env node
// scripts/check-readiness.mjs — hold back new sets until their data and art are published.
//
// Runs after catalog:build in the daily refresh. A set that is new to the catalog (absent
// from SWU_REFERENCE_DIR, the catalog as committed) joins only once every card of its main
// run is listed and every picture it needs is on the CDN. Until then it is held: its file,
// manifest entry and sets.config.json entry are removed from this run, so the data PR does
// not include it, and the next daily run checks it again.
//
// Sets already in the catalog are never held; printings they gain without art yet are
// reported (the binder shows its text layout for them meanwhile).
//
//   node scripts/check-readiness.mjs           # the workflow's mode
//   node scripts/check-readiness.mjs --audit   # check every set, hold nothing
//
// SWU_READINESS_REPORT names a Markdown file to write the result to (for the PR body).
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { missingNumbers, requiredArt } from './lib/readiness.mjs';

const CATALOG_DIR = path.resolve(process.env.SWU_CATALOG_DIR || 'app/public/sets');
const REFERENCE_DIR = process.env.SWU_REFERENCE_DIR && path.resolve(process.env.SWU_REFERENCE_DIR);
const CONFIG_PATH = path.resolve(process.env.SWU_SETS_CONFIG || 'scripts/sets.config.json');
const SETS_API = process.env.SWU_SETS_API || 'https://api.swu-db.com/sets';
const REPORT_PATH = process.env.SWU_READINESS_REPORT;
const AUDIT = process.argv.includes('--audit');
const CONCURRENCY = 16;

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readOptionalJSON(file) {
  try {
    return await readJSON(file);
  } catch {
    return undefined;
  }
}

/**
 * Whether a picture is published: 200 yes; 403/404 (how the CDN answers a missing key)
 * no. Anything else after retries counts as not yet — holding a set a day too long is
 * harmless, letting it in without art is not.
 */
async function published(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) return true;
      if (response.status === 403 || response.status === 404) return false;
    } catch {
      // network hiccup: retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  return false;
}

async function unpublished(urls) {
  const missing = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        if (!(await published(url))) missing.push(url);
      }
    }),
  );
  return missing.sort();
}

const shortName = (url) => url.split('/cards/')[1];
const sample = (items, n = 8) =>
  items.slice(0, n).join(', ') + (items.length > n ? `, … (${items.length} in all)` : '');

(async () => {
  const manifest = await readJSON(path.join(CATALOG_DIR, 'manifest.json'));
  const reference = REFERENCE_DIR
    ? await readOptionalJSON(path.join(REFERENCE_DIR, 'manifest.json'))
    : undefined;
  const known = new Set((reference?.sets ?? []).map((s) => s.key));
  if (!AUDIT && !reference) {
    console.error('✖ SWU_REFERENCE_DIR is required (the catalog as committed), or pass --audit.');
    process.exit(1);
  }

  const listed = new Map(
    (await (await fetch(SETS_API)).json()).map((row) => [row.setId, Number(row.numberCards)]),
  );

  const held = [];
  const ready = [];
  const warnings = [];

  for (const entry of manifest.sets) {
    const isNew = AUDIT || !known.has(entry.key);
    const catalog = await readJSON(path.join(CATALOG_DIR, entry.file));

    if (!isNew) {
      // Existing set: only printings it did not have before are checked, and only reported.
      const before = await readOptionalJSON(path.join(REFERENCE_DIR, entry.file));
      const had = new Set(before?.cards.flatMap((c) => c.printings.map((p) => p.num)) ?? []);
      const added = {
        ...catalog,
        cards: catalog.cards
          .map((c) => ({ ...c, printings: c.printings.filter((p) => !had.has(p.num)) }))
          .filter((c) => c.printings.length),
      };
      const missing = await unpublished(requiredArt(added));
      if (missing.length) {
        warnings.push(
          `**${entry.key}** gained printings without art yet: ${sample(missing.map(shortName))}`,
        );
      }
      continue;
    }

    const gaps = missingNumbers(catalog, listed.get(entry.key));
    const urls = requiredArt(catalog);
    const missing = await unpublished(urls);
    const reasons = [];
    if (gaps.length) {
      reasons.push(
        `${gaps.length} of ${listed.get(entry.key)} cards not listed yet (#${sample(gaps.map(String))})`,
      );
    }
    if (missing.length) {
      reasons.push(
        `${missing.length} of ${urls.length} pictures not published yet (${sample(missing.map(shortName))})`,
      );
    }
    (reasons.length ? held : ready).push({ entry, reasons, pictures: urls.length });
  }

  if (!AUDIT && held.length) {
    const keys = new Set(held.map((h) => h.entry.key));
    for (const { entry } of held) await fs.rm(path.join(CATALOG_DIR, entry.file), { force: true });
    manifest.sets = manifest.sets.filter((s) => !keys.has(s.key));
    await fs.writeFile(
      path.join(CATALOG_DIR, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    const config = await readJSON(CONFIG_PATH);
    for (const key of keys) delete config[key];
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  }

  const lines = [];
  for (const { entry, pictures } of ready) {
    lines.push(
      `- ✅ **${entry.key}** ${entry.label} — ${AUDIT ? 'complete' : 'new, and complete'}: every card listed, all ${pictures} pictures published.`,
    );
  }
  for (const { entry, reasons } of held) {
    lines.push(
      `- ⏸ **${entry.key}** ${entry.label} — ${AUDIT ? 'incomplete' : 'held back until complete'}: ${reasons.join('; ')}.`,
    );
  }
  for (const warning of warnings) lines.push(`- ⚠ ${warning}`);
  if (!lines.length) lines.push('- No new sets.');

  const report = `### Set readiness\n\n${lines.join('\n')}\n`;
  console.log(report);
  if (REPORT_PATH) await fs.writeFile(REPORT_PATH, report);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
