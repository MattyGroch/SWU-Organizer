import { parseDeckLibrary } from '~/domain/decks';
import { BULK_KEY_SUFFIX } from '~/domain/ownership';

import { parseCsv, type CsvTable } from './csv';
import { PrintingResolver, type CatalogLookup } from './resolve';
import { emptyResult, type ImportFormat, type ImportResult } from './types';
import { columnMeaning, hasVariantColumns, normalizeHeader } from './variantColumns';

export type { CatalogLookup } from './resolve';
export type { ImportedPrinting, ImportFormat, ImportResult, ImportSkip, SkipReason } from './types';
export { parseCsv } from './csv';
export { columnMeaning, hasVariantColumns, normalizeHeader } from './variantColumns';

export class UnrecognizedImportError extends Error {
  constructor() {
    super(
      'File format not recognized. Expected a SWUDB or SW-Unlimited export, or a SWU Organizer JSON backup.',
    );
    this.name = 'UnrecognizedImportError';
  }
}

function findColumn(headers: readonly string[], ...names: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const index = normalized.indexOf(normalizeHeader(name));
    if (index !== -1) return index;
  }
  return -1;
}

export function detectFormat(headers: readonly string[]): ImportFormat {
  if (
    findColumn(headers, 'set_code') !== -1 &&
    findColumn(headers, 'card_number') !== -1 &&
    findColumn(headers, 'quantity') !== -1
  ) {
    return 'hyperspace-vault';
  }
  const hasSet = findColumn(headers, 'Set') !== -1;
  if (hasSet && findColumn(headers, 'CardNumber', 'Card Number') !== -1) return 'swudb-csv';
  if (hasSet && findColumn(headers, 'Base card id', 'BaseCardId') !== -1) return 'sw-unlimited';
  return 'unknown';
}

/**
 * SW-Unlimited export: one row per card, one column per printing variant.
 *
 * Each variant column becomes its own printing. The legacy importer summed them.
 */
function importSwUnlimited(table: CsvTable, catalog: CatalogLookup): ImportResult {
  const resolver = new PrintingResolver(catalog);
  const setCol = findColumn(table.headers, 'Set');
  const idCol = findColumn(table.headers, 'Base card id', 'BaseCardId');

  for (const row of table.rows) {
    const setKey = row[setCol] ?? '';
    const base = row[idCol] ?? '';
    const label = `${setKey} ${base}`;

    let sawAny = false;
    let promoCopies = 0;

    for (let col = 0; col < table.headers.length; col++) {
      const header = table.headers[col];
      if (!header) continue;
      const raw = row[col];
      if (raw === undefined || raw.trim() === '') continue;

      const count = Number(raw);
      if (!Number.isFinite(count) || count <= 0) continue;

      const meaning = columnMeaning(header);
      if (meaning.kind === 'variant') {
        sawAny = true;
        const isPromo = meaning.variant === 'promo' || meaning.variant === 'promo-foil';
        if (isPromo && !resolver.hasPrinting(setKey, base, meaning.variant)) {
          // An OP copy of a card the catalog has no promo printing for: keep the card.
          promoCopies += count;
          continue;
        }
        resolver.addByBase(setKey, base, meaning.variant, count, `${label} (${header})`);
      } else if (meaning.kind === 'promo') {
        // No catalog printing corresponds to these (prerelease, event promos), so fold
        // them into ordinary copies rather than losing cards the user owns.
        promoCopies += count;
      }
    }

    if (promoCopies > 0) {
      sawAny = true;
      resolver.addByBase(setKey, base, 'normal', promoCopies, `${label} (promo)`);
    }

    if (!sawAny && (setKey.trim() || base.trim())) {
      resolver.skipped.push({ reason: 'malformed', detail: label.trim() || '(blank row)' });
    }
  }

  return {
    printings: resolver.printings,
    recognized: resolver.recognized,
    skipped: resolver.skipped,
    copies: resolver.copies,
    format: 'sw-unlimited',
  };
}

/** SWUDB CSV: `Set,CardNumber,Count`, where CardNumber identifies a printing. */
function importSwudb(table: CsvTable, catalog: CatalogLookup): ImportResult {
  const resolver = new PrintingResolver(catalog);
  const setCol = findColumn(table.headers, 'Set');
  const numCol = findColumn(table.headers, 'CardNumber', 'Card Number');
  const countCol = findColumn(table.headers, 'Count', 'Quantity', 'Qty');

  for (const row of table.rows) {
    const setKey = row[setCol] ?? '';
    const num = row[numCol] ?? '';
    const count = countCol === -1 ? '1' : (row[countCol] ?? '');
    resolver.addByPrinting(setKey, num, count, `${setKey} ${num} x${count}`);
  }

  return {
    printings: resolver.printings,
    recognized: resolver.recognized,
    skipped: resolver.skipped,
    copies: resolver.copies,
    format: 'swudb-csv',
  };
}

/**
 * Hyperspace Vault's `swu-inv-export` (CSV) / `swu-inv/1` (JSON): one row per printing,
 * with `card_number` being the *printing* number — `ASH 815 Standard Prestige` is the
 * Prestige printing itself, not base card 815. So rows resolve like the SWUDB CSV, by
 * printing, and the printing's own variant is recorded.
 */
function importVaultRows(
  rows: Iterable<{ set: unknown; number: unknown; quantity: unknown; label: string }>,
  catalog: CatalogLookup,
): ImportResult {
  const resolver = new PrintingResolver(catalog);
  for (const row of rows) {
    resolver.addByPrinting(String(row.set ?? ''), row.number, row.quantity, row.label);
  }
  return {
    printings: resolver.printings,
    recognized: resolver.recognized,
    skipped: resolver.skipped,
    copies: resolver.copies,
    format: 'hyperspace-vault',
  };
}

function importVaultCsv(table: CsvTable, catalog: CatalogLookup): ImportResult {
  const setCol = findColumn(table.headers, 'set_code');
  const numCol = findColumn(table.headers, 'card_number');
  const qtyCol = findColumn(table.headers, 'quantity');
  const variantCol = findColumn(table.headers, 'variant_type');
  const nameCol = findColumn(table.headers, 'name');
  return importVaultRows(
    table.rows.map((row) => ({
      set: row[setCol],
      number: row[numCol],
      quantity: row[qtyCol],
      label: [row[setCol], row[numCol], row[nameCol], row[variantCol], `x${row[qtyCol] ?? ''}`]
        .filter(Boolean)
        .join(' '),
    })),
    catalog,
  );
}

function isVaultJson(payload: unknown): payload is { cards: unknown[] } {
  return (
    isRecord(payload) &&
    Array.isArray(payload.cards) &&
    (String(payload.format_version ?? '').startsWith('swu-inv') ||
      payload.source === 'hyperspacevault')
  );
}

function importVaultJson(payload: { cards: unknown[] }, catalog: CatalogLookup): ImportResult {
  return importVaultRows(
    payload.cards.filter(isRecord).map((card) => ({
      set: card.set_code,
      number: card.card_number,
      quantity: card.quantity,
      label: `${String(card.set_code)} ${String(card.card_number)} ${String(card.name ?? '')} ${String(card.variant_type ?? '')} x${String(card.quantity)}`,
    })),
    catalog,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * This app's own JSON backup.
 *
 * v2 backups carry printings. v1 backups (the legacy app's `{version:1, sets}`) only
 * carry base numbers, so each count is read as that card's printing — which for a base
 * number is its Normal printing. v3 backups add the deck library under `decks`; v4
 * backups add each printing's bulk-box copies under "059@bulk" beside "059".
 */
export function importAppJson(payload: unknown, catalog: CatalogLookup): ImportResult {
  if (!isRecord(payload) || !isRecord(payload.sets)) throw new UnrecognizedImportError();

  const resolver = new PrintingResolver(catalog);
  const bulk = new Map<string, number>();

  for (const [setKey, inventory] of Object.entries(payload.sets)) {
    if (!isRecord(inventory)) {
      throw new UnrecognizedImportError();
    }
    for (const [num, count] of Object.entries(inventory)) {
      if (num.endsWith(BULK_KEY_SUFFIX)) {
        bulk.set(`${setKey}:${num.slice(0, -BULK_KEY_SUFFIX.length)}`, Number(count) || 0);
        continue;
      }
      resolver.addByPrinting(setKey, num, count, `${setKey} ${num} x${String(count)}`);
    }
  }

  const tracksBulk = typeof payload.version === 'number' && payload.version >= 4;
  return {
    printings: resolver.printings.map((p) => {
      const inBulk = Math.min(bulk.get(`${p.setKey}:${p.num}`) ?? 0, p.count);
      return inBulk > 0 ? { ...p, bulk: inBulk } : p;
    }),
    ...(tracksBulk && { tracksBulk: true as const }),
    recognized: resolver.recognized,
    skipped: resolver.skipped,
    copies: resolver.copies,
    format: 'app-json',
    ...(isRecord(payload.decks) && {
      deckLibrary: parseDeckLibrary(JSON.stringify(payload.decks)),
    }),
  };
}

/** Parses any supported text format. Throws `UnrecognizedImportError` if none match. */
export function importText(text: string, catalog: CatalogLookup): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) return emptyResult('unknown');

  if (trimmed.startsWith('{')) {
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      throw new UnrecognizedImportError();
    }
    if (isVaultJson(payload)) return importVaultJson(payload, catalog);
    return importAppJson(payload, catalog);
  }

  // Some exports open with `# comment` lines (Hyperspace Vault: `# swu-inv-export v1`)
  // before the header row.
  const withoutComments = trimmed.replace(/^(?:#[^\n]*\r?\n)+/, '');
  const table = parseCsv(withoutComments);
  switch (detectFormat(table.headers)) {
    case 'hyperspace-vault':
      return importVaultCsv(table, catalog);
    case 'swudb-csv':
      return importSwudb(table, catalog);
    case 'sw-unlimited':
      return importSwUnlimited(table, catalog);
    default:
      throw new UnrecognizedImportError();
  }
}

/** Rows already extracted from a spreadsheet, as `[header, ...dataRows]`. */
export function importSheet(
  headers: string[],
  rows: string[][],
  catalog: CatalogLookup,
): ImportResult {
  const table: CsvTable = { headers, rows };
  switch (detectFormat(headers)) {
    case 'hyperspace-vault':
      return importVaultCsv(table, catalog);
    case 'swudb-csv':
      return importSwudb(table, catalog);
    case 'sw-unlimited':
      return importSwUnlimited(table, catalog);
    default:
      throw new UnrecognizedImportError();
  }
}

export { hasVariantColumns as sheetHasVariantColumns };
