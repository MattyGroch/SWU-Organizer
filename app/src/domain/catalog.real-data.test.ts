import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  numericPart,
  promoParts,
  parsePriceTable,
  parseSetCatalog,
  parseSetManifest,
  toLoadedSet,
  toSearchCatalog,
} from './catalog';

/**
 * Runs the app's parser over the actual committed catalog, rather than fixtures.
 *
 * `scripts/validate-catalog.mjs` checks the pipeline's output on its own terms; this
 * checks that the app agrees. Together they catch drift in either direction — most
 * importantly a new upstream variant slug, which `parseSetCatalog` throws on.
 */

const setsDir = join(dirname(fileURLToPath(import.meta.url)), '../../public/sets');
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(setsDir, file), 'utf8'));

const manifest = parseSetManifest(readJson('manifest.json'));

describe('committed catalog', () => {
  it('lists every configured set', () => {
    expect(manifest.length).toBeGreaterThanOrEqual(11);
  });

  it.each(manifest.map((entry) => [entry.key, entry] as const))('parses %s', (setKey, entry) => {
    const catalog = parseSetCatalog(readJson(entry.file));
    expect(catalog.setKey).toBe(setKey);
    expect(catalog.cards.length).toBe(entry.cards);

    const prices = parsePriceTable(readJson(entry.file.replace(/\.json$/, '.prices.json')));
    const set = toLoadedSet(catalog, prices);

    expect(set.baseCards.length).toBe(entry.cards);
    // Every printing resolves, and so does each promo alias (a badge variant of a promo).
    const aliases = catalog.cards.flatMap((c) => c.printings.flatMap((p) => p.aliases ?? []));
    expect(set.baseByPrinting.size).toBe(entry.printings + aliases.length);

    for (const card of catalog.cards) {
      // Every card files into a binder slot at or below its lowest printing number.
      expect(card.base).toBe(
        Math.min(
          ...card.printings.filter((p) => !promoParts(p.num)).map((p) => numericPart(p.num)),
        ),
      );
      // Every card is reachable through the maps the binder and scanner rely on.
      expect(set.byNumber.get(card.base)?.Name).toBe(card.name);
      for (const printing of card.printings) {
        expect(set.baseByPrinting.get(printing.num)).toBe(card.base);
      }
    }
  });

  it.each(manifest.map((entry) => [entry.key, entry] as const))(
    'builds search suggestions for %s',
    (_setKey, entry) => {
      const set = toLoadedSet(parseSetCatalog(readJson(entry.file)), new Map());
      const search = toSearchCatalog(set);

      expect(search.cards.length).toBe(entry.cards);
      for (const [base, numbers] of search.printingNumbersByBase) {
        expect(numbers.length).toBeGreaterThan(0);
        expect(numbers[0]).toBe(base);
      }
    },
  );

  it('recovers the suffix-numbered foils the legacy pipeline dropped', () => {
    const sor = parseSetCatalog(readJson('SWU-SOR.json'));
    const suffixFoils = sor.cards.flatMap((c) => c.printings.filter((p) => /^\d+F$/.test(p.num)));

    expect(suffixFoils.length).toBeGreaterThan(0);
    // Each one collapses onto the same binder slot as its non-foil sibling.
    const set = toLoadedSet(sor, new Map());
    for (const foil of suffixFoils) {
      expect(set.baseByPrinting.get(foil.num)).toBe(set.baseByPrinting.get(foil.num.slice(0, -1)));
    }
  });

  it('exposes every variant the collection actually contains', () => {
    const seen = new Set<string>();
    for (const entry of manifest) {
      for (const card of parseSetCatalog(readJson(entry.file)).cards) {
        for (const printing of card.printings) seen.add(printing.variant);
      }
    }
    expect([...seen].sort()).toEqual([
      'foil',
      'hyperspace',
      'hyperspace-foil',
      'normal',
      'prestige',
      'prestige-foil',
      'prestige-serialized',
      'promo',
      'promo-foil',
      'showcase',
    ]);
  });
});
