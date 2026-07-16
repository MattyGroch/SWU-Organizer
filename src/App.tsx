import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  binderLayout,
  getSpreadCoords,
  numberFromPagePosition,
  pageToSpread,
  spreadToPrimaryPage,
} from './core/binder';
import {
  buildSearchSuggestions,
  submittedSuggestion,
  type SearchCatalog,
  type SearchSuggestion,
} from './core/search';
import {
  applyImportedInventories,
  canonicalizeInventory,
  collectRawImportEntry,
  loadInventoriesForPersistence,
  persistCanonicalInventory,
  quotaForType,
  removePersistedInventory,
  type CanonicalCatalog,
  type ImportResult,
} from './core/inventory';
import { createLoadCommitGate } from './core/loadGuard';
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type AppSettings,
} from './core/settings';
import { focusedPageForSpread } from './core/binderView';
import {
  selectionAfterMove,
  viewModeAfterSelection,
  type BinderViewMode,
} from './core/selection';
import type { ActiveSelection, Card, Inventory, SetKey, SetMeta } from './core/types';
import { LocatorPanel } from './components/LocatorPanel';
import { SettingsModal } from './components/SettingsModal';

export type { BinderViewMode } from './core/selection';

/** Last entry in `manifest.json` is the newest set (release order). */
function newestSetKeyFromManifest(list: SetMeta[]): SetKey {
  return list.length ? list[list.length - 1]!.key : 'SOR';
}

function initialSettings(): AppSettings {
  try {
    return readSettings(window.localStorage);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const ASPECT_HEX: Record<string, string> = {
  Vigilance: '#3b82f6', // blue
  Command:   '#22c55e', // green
  Aggression:'#ef4444', // red
  Cunning:   '#f59e0b', // yellow
  Heroism:   '#e5e7eb', // white
  Villainy:  '#0b0b0b', // black
};
const NEUTRAL = '#2f3545'; // for numbers that exist but have no aspect

const QTY_FONT = 22;      // size of the centered "1/3"
const QTY_Y_OFFSET = 4;   // nudge up/down if needed
const QTY_SHIFT_DOWN = 14; // Shift QTY and buttons down by 20px
const BTN = 32;          // button diameter
const GAP = 8;           // CSS gap between buttons
const GROUP_W = BTN * 2 + GAP;  // 72
const GROUP_H = BTN;             // 32

const RARITY_STYLE: Record<string, {letter: string; color: string}> = {
  Common:    { letter: 'C',  color: '#8B5E3C' }, // brown
  Uncommon:  { letter: 'U',  color: '#9AA0B4' }, // gray
  Rare:      { letter: 'R',  color: '#FACC15' }, // yellow
  Legendary: { letter: 'L',  color: '#7DD3FC' }, // light blue
  Special:   { letter: 'S', color: '#000000' }, // black
};

// Global constants for filter lists
const ALL_RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'] as const;
const ALL_ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning', 'Heroism', 'Villainy', 'NEUTRAL'];
const ALL_TYPES = ['Leader', 'Base', 'Unit', 'Event', 'Upgrade'];

/** Vigilance / Command / Aggression / Cunning only — not Heroism, Villainy, NEUTRAL (affiliation). */
const PRIMARY_ASPECT_NAMES = new Set<string>([
  'Vigilance',
  'Command',
  'Aggression',
  'Cunning',
]);

/** Dual-primary art: mostly solid left/right; only the middle band blends (like physical cards). */
const DUAL_ASPECT_CENTER_BLEND_PCT = 15;
const DUAL_ASPECT_LEFT_STOP_PCT = (100 - DUAL_ASPECT_CENTER_BLEND_PCT) / 2;
const DUAL_ASPECT_RIGHT_STOP_PCT = (100 + DUAL_ASPECT_CENTER_BLEND_PCT) / 2;

/** Primary aspects only, in order; map to hex; collapse consecutive duplicates (double pip). */
function normalizedPrimaryAspectHexes(aspects?: string[]): string[] {
  if (!aspects?.length) return [];
  const out: string[] = [];
  for (const name of aspects) {
    if (!PRIMARY_ASPECT_NAMES.has(name)) continue;
    const h = ASPECT_HEX[name as keyof typeof ASPECT_HEX];
    if (!h) continue;
    if (out.length && out[out.length - 1] === h) continue;
    out.push(h);
  }
  return out;
}

type AspectFillSpec =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: [string, string] };

function aspectSpecFromCardAspects(aspects?: string[]): AspectFillSpec | null {
  const hexes = normalizedPrimaryAspectHexes(aspects);
  if (hexes.length === 0) return null;
  if (hexes.length === 1) return { kind: 'solid', color: hexes[0] };
  return { kind: 'gradient', colors: [hexes[0], hexes[1]] };
}

function aspectSpecToCssBackground(spec: AspectFillSpec | null | undefined): string | undefined {
  if (!spec) return undefined;
  if (spec.kind === 'solid') return spec.color;
  const [a, b] = spec.colors;
  const L = DUAL_ASPECT_LEFT_STOP_PCT;
  const R = DUAL_ASPECT_RIGHT_STOP_PCT;
  return `linear-gradient(to right, ${a} 0%, ${a} ${L}%, ${b} ${R}%, ${b} 100%)`;
}

/** Inventory table aspect square: diagonal split (primary TL, secondary BR), 1px black divider. */
function aspectSpecToInventorySwatchBackground(spec: AspectFillSpec | null | undefined): string | undefined {
  if (!spec) return undefined;
  if (spec.kind === 'solid') return spec.color;
  const [topLeft, bottomRight] = spec.colors;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">` +
    `<polygon points="0,0 12,0 0,12" fill="${topLeft}"/>` +
    `<polygon points="12,12 12,0 0,12" fill="${bottomRight}"/>` +
    `<line x1="12" y1="0" x2="0" y2="12" stroke="#000" stroke-width="1"/>` +
    `</svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

const INVENTORY_ASPECT_SWATCH_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  borderRadius: 3,
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center',
  boxShadow: '0 0 0 2px #2b2d3d inset',
};

function labelColorForAspectHexes(hexes: string[]): string {
  if (hexes.length === 1 && hexes[0].toLowerCase() === '#e5e7eb') return '#11121a';
  return '#eaeaf0';
}

function rarityOutlineForAspectHexes(hexes: string[]): string {
  if (hexes.length === 1 && hexes[0].toLowerCase() === '#e5e7eb') return '#11121a';
  return '#ffffff';
}

function rarityGlyph(r?: string) {
  if (!r) return null;
  return RARITY_STYLE[r] ?? null;
}

/** Collection status for filter pills (same semantics as the Status column: ✓ / ! / ✕). */
type CollectionStatusKey = 'complete' | 'partial' | 'none';
const ALL_COLLECTION_STATUSES: readonly CollectionStatusKey[] = ['complete', 'partial', 'none'];

function collectionStatusFromQty(qty: number, max: number): CollectionStatusKey {
  if (qty >= max) return 'complete';
  if (qty > 0) return 'partial';
  return 'none';
}

type Filters = {
  aspect: string[];
  rarity: string[];
  type: string[];
  status: CollectionStatusKey[];
};

type FilterControlsProps = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
};

// --- FilterControls Component Definition (Used outside App function) ---
function FilterControls({ filters, setFilters }: FilterControlsProps) {
  const handleFilterChange = <K extends keyof Filters>(category: K, value: Filters[K][number]) => {
    setFilters(prev => {
      const cur = prev[category] as Array<Filters[K][number]>;
      const next: Array<Filters[K][number]> = cur.includes(value)
        ? cur.filter(item => item !== value)
        : [...cur, value];

      return { ...prev, [category]: next };
    });
  };

  const handleClearFilters = () => {
    setFilters({ aspect: [], rarity: [], type: [], status: [] });
  };

  // ---- Color helpers ----
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  };

  const relLuminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const srgb = [r, g, b].map(v => v / 255).map(v =>
      v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  };

  const contrast = (bg: string, fg: string) => {
    const L1 = relLuminance(hexToRgb(bg));
    const L2 = relLuminance(hexToRgb(fg));
    const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (a + 0.05) / (b + 0.05);
  };

  // Choose the better text color for readability, prefer ≥ 4.5:1 if possible
  const bestTextOn = (bg: string, light = '#ffffff', dark = '#0e1117') => {
    const cw = contrast(bg, light);
    const cb = contrast(bg, dark);
    if (cw >= 4.5 || cb >= 4.5) return cw >= cb ? light : dark;
    return cw >= cb ? light : dark;
  };

  // For very dark backgrounds, add a subtle outline so it doesn't blend in
  const needsDarkOutline = (bg: string) => relLuminance(hexToRgb(bg)) < 0.12;


  const renderFilterGroup = <K extends 'aspect' | 'rarity' | 'type'>(
    category: K,
    items: readonly Filters[K][number][],
  ) => (
  <div className="toolbar-group" role="group" style={{ marginRight: 12 }}>
    {items.map(item => {
      const isActive = (filters[category] as Filters[K][number][]).includes(item);
      const label = item.replace('NEUTRAL', 'Neutral');

      // Determine highlight color from your maps
      let highlightColor = '#213c6a';
      if (category === 'aspect') {
        highlightColor = ASPECT_HEX[item as keyof typeof ASPECT_HEX] || highlightColor;
      } else if (category === 'rarity') {
        const rarityStyle = RARITY_STYLE[item as keyof typeof RARITY_STYLE];
        // If your map stores { color } or { backgroundColor }, support both:
        highlightColor = rarityStyle?.color || highlightColor;
      }

      // Compute legible text color and outline for very dark backgrounds
      const activeText = bestTextOn(highlightColor);
      const outline =
        isActive && needsDarkOutline(highlightColor)
          ? '1px solid rgba(255,255,255,0.22)'
          : isActive
          ? '1px solid rgba(0,0,0,0.25)'
          : 'none';

      return (
        <button
          key={category + item}
          className="tbtn"
          onClick={() => handleFilterChange(category, item)}
          style={{
            fontSize: 14,
            padding: '6px 10px',
            backgroundColor: isActive ? highlightColor : 'transparent',
            color: isActive ? activeText : '#eaeaf0',
            border: isActive
              ? outline
              : '1px solid transparent',
            fontWeight: 600,
            borderRadius: 12,
            boxShadow:
              isActive && needsDarkOutline(highlightColor)
                ? '0 0 0 2px rgba(255,255,255,0.08) inset'
                : undefined,
            textShadow: isActive && activeText === '#ffffff' ? '0 1px 0 rgba(0,0,0,0.30)' : undefined,
            transition: 'background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          }}
          aria-pressed={isActive}
        >
          {label}
        </button>
      );
    })}
  </div>
);

  const STATUS_PILL_BG: Record<CollectionStatusKey, string> = {
    complete: '#22c55e',
    partial: '#f59e0b',
    none: '#ef4444',
  };

  /** Same colors as .check / .warn / .x in index.html — used so inactive matches table badges. */
  const STATUS_INACTIVE_BADGE: Record<CollectionStatusKey, { background: string; color: string; border: string }> = {
    complete: { background: '#093c2d', color: '#34d399', border: '1px solid #1f3d33' },
    partial: { background: '#3a3000', color: '#fcd34d', border: '1px solid #4a3a00' },
    none: { background: '#3a0a0a', color: '#f87171', border: '1px solid #4a1f1f' },
  };

  const STATUS_BADGE_BOX: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    boxSizing: 'border-box',
    flexShrink: 0,
  };

  const renderStatusFilterGroup = () => (
    <div className="toolbar-group" role="group" aria-label="Collection status" style={{ marginRight: 12 }}>
      {ALL_COLLECTION_STATUSES.map(key => {
        const isActive = filters.status.includes(key);
        const highlightColor = STATUS_PILL_BG[key];
        const activeText = bestTextOn(highlightColor);
        const inactive = STATUS_INACTIVE_BADGE[key];
        const innerOutline =
          isActive && needsDarkOutline(highlightColor)
            ? '1px solid rgba(255,255,255,0.22)'
            : isActive
            ? '1px solid rgba(0,0,0,0.25)'
            : inactive.border;
        const aria =
          key === 'complete'
            ? 'Complete playset'
            : key === 'partial'
            ? 'In progress — not a full playset'
            : 'Not collected';
        const glyph = key === 'complete' ? '✓' : key === 'partial' ? '!' : '✕';
        return (
          <button
            key={`status-${key}`}
            type="button"
            className="tbtn"
            onClick={() => handleFilterChange('status', key)}
            title={aria}
            aria-label={aria}
            aria-pressed={isActive}
            style={{
              width: 40,
              height: 36,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              backgroundColor: 'transparent',
              border: '1px solid #424452',
              borderRadius: 12,
              transition: 'background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out, opacity 0.2s ease-in-out',
              opacity: isActive ? 1 : 0.9,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                ...STATUS_BADGE_BOX,
                background: isActive ? highlightColor : inactive.background,
                color: isActive ? activeText : inactive.color,
                border: innerOutline,
                textShadow: isActive && activeText === '#ffffff' ? '0 1px 0 rgba(0,0,0,0.30)' : undefined,
                boxShadow:
                  isActive && needsDarkOutline(highlightColor)
                    ? '0 0 0 2px rgba(255,255,255,0.08) inset'
                    : undefined,
              }}
            >
              {glyph}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="card" style={{ padding: '12px 16px', marginTop: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 600, margin: '0 0 10px', color: '#c8ccd9' }}>
        Card Filters
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
        {renderFilterGroup('aspect', ALL_ASPECTS)}
        {renderFilterGroup('rarity', ALL_RARITIES)}
        {renderFilterGroup('type', ALL_TYPES)}
        {renderStatusFilterGroup()}
        <button
          className="tbtn tbtn-danger"
          onClick={handleClearFilters}
          style={{
            fontSize: 14,
            padding: '6px 10px',
            border: '1px solid #424452',
            borderRadius: 8,
            marginLeft: 'auto',
          }}
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
}

/** Collect raw printing counts before all import formats use the same canonicalization path. */
function addRawCount(
  aggregatedData: Record<SetKey, Inventory>,
  setKey: unknown,
  cardNumber: unknown,
  count: unknown,
): boolean {
  return collectRawImportEntry(aggregatedData, setKey, cardNumber, count);
}

function normalizedImportResult(
  raw: Record<SetKey, Inventory>,
  catalog: CanonicalCatalog,
  malformedSkipped: number,
): ImportResult {
  const result = applyImportedInventories({}, raw, 'replace', catalog);
  return { ...result, skipped: result.skipped + malformedSkipped };
}

function parseCsvContent(fileContent: string): { headers: string[]; rows: string[][] } {
    // FIX 1: Normalize line endings to ensure correct line splitting regardless of OS/source.
    const normalizedContent = fileContent.trim()
        .replace(/\r\n/g, '\n') // Normalize CRLF to LF
        .replace(/\r/g, '');    // Handle stray CR (for older Mac files)

    const lines = normalizedContent.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 1) throw new Error("File is empty or contains no lines.");

    // Simple header parsing (first line)
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    const rows = lines.slice(1).map(line => {
      // Regex to capture fields, respecting quotes.
      const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
      const row = parts.map(p => p.trim().replace(/^"|"$/g, '')); // Trim and remove quotes
      
      // FIX 2: Ensure rows are padded to match header length for trailing empty fields.
      while (row.length < headers.length) {
          row.push('');
      }

      return row;
    });

    return { headers, rows };
}

export async function parseXlsxData(file: File, catalog: CanonicalCatalog): Promise<ImportResult> {
  const aggregatedData: Record<SetKey, Inventory> = {};
  let malformedSkipped = 0;

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('XLSX has no sheets.');

  // Read as rows with header row
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (!rows.length) return normalizedImportResult(aggregatedData, catalog, malformedSkipped);

  // Normalize header names once
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '');
  const headerSet = new Set(Object.keys(rows[0]).map(norm));

  // Required columns
  if (!(headerSet.has('set') && (headerSet.has('basecardid') || headerSet.has('basecardid')) && headerSet.has('normal'))) {
    throw new Error('Invalid XLSX format (need Set, Base card id, Normal).');
  }

  // Construct column name resolvers (case/space tolerant)
  const col = (wanted: string, obj: Record<string, unknown>) => {
    const k = Object.keys(obj).find(h => norm(h) === norm(wanted));
    return k ?? wanted; // fall back, but usually found
  };

  for (const r of rows) {
    const setKey = String(r[col('Set', r)] ?? '').trim().toUpperCase() as SetKey;
    const baseIdNum = Number(r[col('Base card id', r)]);
    // Sum all variant columns starting at "Normal" through the end of the row.
    // We’ll include common known alt headers if present.
    const ALT_HEADERS = [
      'Normal','Foil','Hyperspace','Foil & Hyperspace','Showcase','Organized Play',
      'Event Exclusive','Prerelease Promo','Organized Play Foil','Standard Prestige',
      'Foil Prestige','Serialized Prestige'
    ];
    let totalCount = 0;
    for (const h of ALT_HEADERS) {
      const key = col(h, r);
      if (key in r) {
        const n = Number(r[key]);
        if (Number.isFinite(n)) totalCount += n;
      }
    }
    if (!addRawCount(aggregatedData, setKey, baseIdNum, totalCount)) malformedSkipped += 1;
  }

  return normalizedImportResult(aggregatedData, catalog, malformedSkipped);
}

export function parseCsvData(
  fileName: string, // kept for signature compatibility; not used for detection
  fileContent: string,
  catalog: CanonicalCatalog
): ImportResult {
  const aggregatedData: Record<SetKey, Inventory> = {};
  let malformedSkipped = 0;

  // Parse CSV into headers + rows (rows are string[]; access via indices)
  const { headers, rows } = parseCsvContent(fileContent);

  // -------- Header-based format detection (no filename reliance) --------
  type ImportFormat = "swudb" | "swunlimiteddb" | "unknown";

  // Normalize header for robust matching (lowercase + strip spaces/underscores)
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");
  const headersNorm = headers.map(norm);

  const detectImportFormat = (hdrs: string[]): ImportFormat => {
    const h = hdrs.map(norm);

    // swudb: Set, CardNumber, Count
    if (h.includes(norm("Set")) && h.includes(norm("CardNumber")) && h.includes(norm("Count"))) {
      return "swudb";
    }
    // sw-unlimited: Set, Base card id, Normal
    if (h.includes(norm("Set")) && (h.includes(norm("Base card id")) || h.includes(norm("BaseCardId"))) && h.includes(norm("Normal"))) {
      return "swunlimiteddb";
    }
    return "unknown";
  };

  const format = detectImportFormat(headers);

  // Helper: find column index by any of the provided header names
  const findColAny = (...names: string[]) => {
    for (const n of names) {
      const idx = headersNorm.indexOf(norm(n));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  if (format === "swunlimiteddb") {
    // --- sw-unlimited-db export (CSV or XLSX->CSV) ---
    const setCol = findColAny("Set");
    const idCol = findColAny("Base card id", "BaseCardId", "Base cardid", "Basecardid");
    const normalCol = findColAny("Normal");

    if (setCol === -1 || idCol === -1 || normalCol === -1) {
      throw new Error("Invalid format for SW-Unlimited export (missing Set, Base card id, or Normal column).");
    }

    // Variant columns start at "Normal" and run to the end; sum them all
    for (const row of rows) {
      const rawSet = (row[setCol] ?? "").toString().trim();
      const setKey = rawSet.toUpperCase() as SetKey;

      const baseIdNum = Number(row[idCol]);
      let totalCount = 0;
      for (let i = normalCol; i < row.length; i++) {
        const v = Number(row[i]);
        if (Number.isFinite(v)) totalCount += v;
      }

      if (!addRawCount(aggregatedData, setKey, baseIdNum, totalCount)) malformedSkipped += 1;
    }

  } else if (format === "swudb") {
    // --- swudb.com CSV export ---
    const setCol = findColAny("Set");
    const numCol = findColAny("CardNumber");
    const countCol = findColAny("Count");

    if (setCol === -1 || numCol === -1 || countCol === -1) {
      throw new Error("Invalid format for SWUDB export (missing Set, CardNumber, or Count column).");
    }

    for (const row of rows) {
      const setKey = (row[setCol] ?? "").toString().trim().toUpperCase() as SetKey;

      const cardNumRaw = (row[numCol] ?? "").toString().trim();
      const count = Number(row[countCol]);

      // Strip leading zeros so keys match your index (e.g., "079" -> "79")
      const numericId = Number(cardNumRaw);

      if (!addRawCount(aggregatedData, setKey, numericId, count)) malformedSkipped += 1;
    }

  } else {
    // Fallback: try your existing JSON format
    try {
      const raw = JSON.parse(fileContent);
      if (raw?.version === 1 && raw?.sets) {
        const jsonSets = raw.sets as Record<SetKey, Record<string, number>>;
        for (const k of Object.keys(jsonSets) as SetKey[]) {
          for (const [numStr, count] of Object.entries(jsonSets[k])) {
            if (!addRawCount(aggregatedData, k, numStr, count)) malformedSkipped += 1;
          }
        }
        return normalizedImportResult(aggregatedData, catalog, malformedSkipped);
      }
    } catch {
      // not JSON; fall through
    }

    throw new Error("File format not recognized. Expected a SWUDB or SW-Unlimited CSV (or a valid app JSON export).");
  }

  return normalizedImportResult(aggregatedData, catalog, malformedSkipped);
}

type ParsedSet = {
  key: SetKey;
  allCards: Card[];
  baseCards: Card[];
  byNumber: Map<number, Card>;
  baseToAll: Map<number, number[]>;
  altToBase: Map<number, number>;
};

type UnknownRecord = Record<string, unknown>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNamedValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isUnknownRecord(value) && typeof value.Name === 'string') return value.Name;
  return undefined;
}

function canonicalCatalogFromParsedSets(parsedSets: Iterable<ParsedSet>): CanonicalCatalog {
  const catalog: CanonicalCatalog = new Map();
  for (const parsed of parsedSets) {
    for (const card of parsed.allCards) {
      const baseNumber = parsed.altToBase.get(card.Number) ?? card.Number;
      const baseCard = parsed.byNumber.get(baseNumber);
      catalog.set(`${parsed.key}:${card.Number}`, {
        setKey: parsed.key,
        printingNumber: card.Number,
        baseNumber,
        type: baseCard?.Type ?? card.Type,
      });
    }
  }
  return catalog;
}

export default function App() {
  const [sets, setSets] = useState<SetMeta[]>([]);
  const [setKey, setSetKey] = useState<SetKey>('SOR'); // placeholder until manifest loads (then newest set)
  const setKeys = useMemo(() => sets.map(set => set.key as SetKey), [sets]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const submitSearchRef = useRef<() => void>(() => {});
  const importRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const closeSettingsModal = useCallback(() => setShowSettingsModal(false), []);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<Record<SetKey, Inventory>>({});
  const [importStats, setImportStats] = useState({ recognized: 0, skipped: 0 });
  const [importingFileName, setImportingFileName] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [listView, setListView] = React.useState<'inventory' | 'missing'>('inventory');

  // In-app toast notifications (replaces window.alert)
  type ToastKind = 'success' | 'error' | 'warning';
  type ToastItem = { id: number; kind: ToastKind; message: string };
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3200);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  const changeSettings = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
    try {
      writeSettings(localStorage, nextSettings);
    } catch {
      showToast('Settings could not be saved on this device.', 'error');
    }
  }, [showToast]);

  // cache parsed data for sets (so we don't refetch repeatedly)
  const parsedCacheRef = useRef<Map<string, ParsedSet>>(new Map());
  const loadCommitGateRef = useRef(createLoadCommitGate());
  const [canonicalCatalog, setCanonicalCatalog] = useState<CanonicalCatalog>(new Map());

  useEffect(() => {
    fetch('/sets/manifest.json')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('no manifest')))
      .then((m: { sets: SetMeta[] }) => {
        const list = Array.isArray(m?.sets) ? m.sets : [];
        setSets(list);
        setSetKey(newestSetKeyFromManifest(list));
      })
      .catch(() => {
        // fallback (optional) if manifest missing in dev
        const fallback: SetMeta[] = [
          { key:'SOR', label:'Spark of Rebellion (SOR)', file:'SWU-SOR.json' },
          { key:'SHD', label:'Shadows of the Galaxy (SHD)', file:'SWU-SHD.json' },
          { key:'TWI', label:'Twilight of the Republic (TWI)', file:'SWU-TWI.json' },
          { key:'JTL', label:'Jump to Lightspeed (JTL)', file:'SWU-JTL.json' },
          { key:'LOF', label:'Legacy of the Force (LOF)', file:'SWU-LOF.json' },
        ];
        setSets(fallback);
        setSetKey(newestSetKeyFromManifest(fallback));
      });
  }, []);

  // Data variants
  const [cardsAll, setCardsAll] = useState<Card[]>([]);     // unique by Number (used to color pages)
  const [cardsBase, setCardsBase] = useState<Card[]>([]);   // base printing per Name (lowest Number)
  // Rarity normalization
  function normalizeRarity(r: unknown): string | undefined {
    if (!r) return undefined;
    const v = String(r).trim();
    const k = v.toLowerCase();
    const map: Record<string,string> = {
      c: 'Common', common: 'Common',
      u: 'Uncommon', uncommon: 'Uncommon',
      r: 'Rare', rare: 'Rare',
      l: 'Legendary', legendary: 'Legendary',
      s: 'Special',
      starter: 'Special',
      'starter deck exclusive': 'Special',
      'starter deck-exclusive': 'Special',
      special: 'Special'
    };
    return map[k] ?? v; // fall back to the original string
  }

  // stable key for dedupe/show
  function keyNameType(c: {Name: string; Subtitle?: string; Type?: string}) {
    const sub = (c.Subtitle || '').trim().toLowerCase();
    return `${c.Name.trim().toLowerCase()}|${sub}|${(c.Type||'').trim().toLowerCase()}`;
  }

  // 2) collapse alt-arts: keep the LOWEST Number per (Name + Type)
  const baseOnly = useCallback((cards: Card[]): Card[] => {
    const byKey = new Map<string, Card>();
    for (const c of cards) {
      const k = keyNameType(c);
      const prev = byKey.get(k);
      if (!prev || c.Number < prev.Number) byKey.set(k, c);
    }
    return Array.from(byKey.values()).sort((a,b)=>a.Number - b.Number);
  }, []);

  // 3) Build alt maps for search display and number→base resolution
  const buildAltMaps = useCallback((allCards: Card[]) => {
    // name+type → sorted numbers
    const ntToNums = new Map<string, number[]>();
    for (const c of allCards) {
      const k = keyNameType(c);
      const arr = ntToNums.get(k) || [];
      arr.push(c.Number);
      ntToNums.set(k, arr);
    }
    for (const arr of ntToNums.values()) arr.sort((a,b)=>a - b);

    // baseNum → all numbers (base first), altNum → baseNum
    const baseToAll = new Map<number, number[]>();
    const altToBase = new Map<number, number>();

    for (const [, nums] of ntToNums) {
      const base = nums[0];
      baseToAll.set(base, nums);
      for (const n of nums) {
        if (n !== base) altToBase.set(n, base);
      }
    }
    return { baseToAll, altToBase };
  }, []);

  // Datetime
  function tsStamp(utc = false) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const Y = utc ? d.getUTCFullYear() : d.getFullYear();
    const M = pad((utc ? d.getUTCMonth() : d.getMonth()) + 1);
    const D = pad(utc ? d.getUTCDate() : d.getDate());
    const h = pad(utc ? d.getUTCHours() : d.getHours());
    const m = pad(utc ? d.getUTCMinutes() : d.getMinutes());
    // add seconds if you want: const s = pad(utc ? d.getUTCSeconds() : d.getSeconds());
    return `${Y}${M}${D}-${h}${m}`; // e.g. 20250813-0031
  }

  // Quick lookups
  const byNumber = useMemo(() => new Map(cardsBase.map(c => [c.Number, c])), [cardsBase]);

  // Inventory
  const [inventory, setInventory] = useState<Inventory>({});
  const [inventoryReadyForSet, setInventoryReadyForSet] = useState<SetKey | null>(null);
  useEffect(() => {
    if (inventoryReadyForSet === setKey) {
      persistCanonicalInventory(localStorage, setKey, inventory, canonicalCatalog);
    }
  }, [canonicalCatalog, inventory, inventoryReadyForSet, setKey]);
  const pruneZeros = (inv: Inventory) =>
    Object.fromEntries(Object.entries(inv).filter(([,q]) => (q as number) > 0)) as Inventory;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if (typing) return;

      if (e.key === 'Escape') {
        setActive(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  // UI state
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<ActiveSelection | null>(null);

  // NEW: State to hold card details for selection after a set switch
  const [pendingSelection, setPendingSelection] = useState<{
    setKey: SetKey;
    baseNumber: number;
  } | null>(null);

  const [showHelpModal, setShowHelpModal] = useState(false); 

  const [highlightedRowNumber, setHighlightedRowNumber] = useState<number | null>(null); 

  const [showBulkActionsModal, setShowBulkActionsModal] = useState(false); 
  
  // Global Filter State
  const [filters, setFilters] = useState<Filters>({
    aspect: [],
    rarity: [],
    type: [],
    status: [],
  });

  type TcgCopyMode = 'fullNeeded' | 'oneEach';
  const [tcgCopyMode, setTcgCopyMode] = useState<TcgCopyMode>('fullNeeded');
  type TcgCopyFeedback = 'idle' | 'copied' | 'failed';
  const [tcgCopyFeedback, setTcgCopyFeedback] = useState<TcgCopyFeedback>('idle');
  const tcgCopyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTcgCopyFeedbackTimer() {
    if (tcgCopyFeedbackTimerRef.current != null) {
      clearTimeout(tcgCopyFeedbackTimerRef.current);
      tcgCopyFeedbackTimerRef.current = null;
    }
  }

  useEffect(() => () => clearTcgCopyFeedbackTimer(), []);

  // Spreads (instead of pages)
  const maxNumber = useMemo(() => cardsBase.reduce((m,c)=>Math.max(m,c.Number), 0), [cardsBase]);
  const totalPages = Math.max(1, Math.ceil(maxNumber / 12));
  const totalSpreads = 1 + Math.ceil(Math.max(0, totalPages - 1) / 2);
  const [binderViewMode, setBinderViewMode] = useState<BinderViewMode>('spread');
  const [focusedPage, setFocusedPage] = useState(1);
  const viewSpread = pageToSpread(focusedPage);
  const setViewSpread = useCallback<React.Dispatch<React.SetStateAction<number>>>(next => {
    setFocusedPage(currentPage => {
      const currentSpread = pageToSpread(currentPage);
      const requestedSpread = typeof next === 'function' ? next(currentSpread) : next;
      return focusedPageForSpread(currentPage, requestedSpread, totalPages);
    });
  }, [totalPages]);

  const binderRef = useRef<HTMLDivElement>(null); 

  const activateCard = useCallback((card: Card, forceView?: BinderViewMode) => {
    const { page, row, column } = binderLayout(card.Number);
    const { spreadCol, spreadRow } = getSpreadCoords(page, row, column);
    setActive({ number: card.Number, card, page, row, column, spreadCol, spreadRow });
    setError('');
    setFocusedPage(page);
    setBinderViewMode(forceView ?? viewModeAfterSelection(settings, binderViewMode));
    setHighlightedRowNumber(card.Number);

    window.setTimeout(() => setHighlightedRowNumber(null), 500);
    binderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [binderViewMode, settings]);

  // Suggestions dropdown
  const [openSug, setOpenSug] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Build an overview of what will be imported per set
  const importOverview = React.useMemo(() => {
    const lines: Array<{ set: SetKey; counts: Record<string, number> }> = [];

    for (const [set, inv] of Object.entries(importData)) {
      const parsed = parsedCacheRef.current.get(set);
      const counts: Record<string, number> = {
        Leader: 0, Base: 0, Unit: 0, Event: 0, Upgrade: 0, Other: 0
      };

      for (const numStr of Object.keys(inv)) {
        const baseNum = Number(numStr);
        if (!Number.isFinite(baseNum)) continue;

        // Prefer byNumber (base-only list), fall back to allCards if needed
        const card =
          parsed?.byNumber.get(baseNum) ??
          parsed?.allCards.find(c => c.Number === baseNum);

        const t = (card?.Type || '').trim();
        if (t === 'Leader' || t === 'Base' || t === 'Unit' || t === 'Event' || t === 'Upgrade') {
          counts[t] += 1;
        } else {
          counts.Other += 1;
        }
      }

      // Only push if the set has any entries
      if (Object.values(counts).some(v => v > 0)) {
        lines.push({ set: set as SetKey, counts });
      }
    }

    // Optional: sort by set key for stable display
    lines.sort((a, b) => a.set.localeCompare(b.set));
    return lines;
  }, [importData]);

  // Load set JSON
    useEffect(() => {
      const loadCommitGate = loadCommitGateRef.current;
      const loadToken = loadCommitGate.begin();
      // Helper function defined inside useEffect to access local scope functions (like baseOnly)
      const parseAndCache = async (meta: SetMeta): Promise<ParsedSet> => {
        // Check cache first
        if (parsedCacheRef.current.has(meta.key)) {
            return parsedCacheRef.current.get(meta.key)!;
        }
        
        const url = meta.file.startsWith('/') ? meta.file : `/sets/${meta.file}`;
        const res = await fetch(url);
        const payload: unknown = await res.json();
        const data = Array.isArray(payload)
          ? payload
          : isUnknownRecord(payload) && Array.isArray(payload.data)
            ? payload.data
            : [];

        const pricesName = meta.file.replace(/\.json$/i, '.prices.json');
        const pricesUrl = pricesName.startsWith('/') ? pricesName : `/sets/${pricesName}`;
        let priceByNumber: Record<string, number> | null = null;
        try {
          const pr = await fetch(pricesUrl);
          if (pr.ok) {
            const pricePayload: unknown = await pr.json();
            if (isUnknownRecord(pricePayload) && isUnknownRecord(pricePayload.prices)) {
              priceByNumber = Object.fromEntries(
                Object.entries(pricePayload.prices)
                  .map(([number, price]) => [number, Number(price)] as const)
                  .filter(([, price]) => Number.isFinite(price)),
              );
            }
          }
        } catch {
          /* optional overlay */
        }

        const mapped: Card[] = data.map((value: unknown) => {
          const c = isUnknownRecord(value) ? value : {};
          const rawName = String(c.Name || '').trim();
          const rawSubtitle = String(c.Subtitle || '').trim();
          const cardName = rawName;
          const num = Number(c.Number);
          let marketPrice = Number(c.MarketPrice ?? c.Price ?? 0);
          if (priceByNumber) {
            const p = priceByNumber[String(num)];
            if (p !== undefined && Number.isFinite(Number(p))) {
              marketPrice = Number(p);
            }
          }
          
          return {
            Name: cardName,
            Subtitle: rawSubtitle || undefined,
            Number: num,
            Aspects: Array.isArray(c.Aspects)
              ? c.Aspects.filter((aspect): aspect is string => typeof aspect === 'string')
              : [],
            Type: stringOrNamedValue(c.Type)?.trim(),
            Rarity: normalizeRarity(
              stringOrNamedValue(c.Rarity ?? c.rarity ?? c.RarityCode),
            ),
            MarketPrice: marketPrice,
            Set: meta.key,
          };
        }).filter((c: Card) => !!c.Name && Number.isFinite(c.Number));

        // 1) unique by Number
        const byNum = new Map<number, Card>();
        for (const c of mapped.sort((a,b) => {
            const hasA = (a.Aspects?.length ?? 0) > 0 ? 1 : 0;
            const hasB = (b.Aspects?.length ?? 0) > 0 ? 1 : 0;
            return hasB - hasA || a.Number - b.Number;
        })) {
            if (!byNum.has(c.Number)) byNum.set(c.Number, c);
        }
        const allCards = Array.from(byNum.values()).sort((a,b)=>a.Number-b.Number);

        // 2) base-only view = dedupe by (Name + Subtitle + Type), keep lowest Number
        const baseCards = baseOnly(allCards);

        // 3) build alt maps
        const { baseToAll, altToBase } = buildAltMaps(allCards);

        const parsed: ParsedSet = {
            key: meta.key,
            allCards: allCards,
            baseCards: baseCards,
            byNumber: new Map(baseCards.map(c => [c.Number, c])),
            baseToAll: baseToAll,
            altToBase: altToBase,
        };
        parsedCacheRef.current.set(meta.key, parsed);
        return parsed;
      }; // end parseAndCache

      async function load() {
        setError(''); 
        setActive(null); 
        setViewSpread(0); 
        setInventoryReadyForSet(null);

        const meta = sets.find(s => s.key === setKey);
        if (!meta) return;

        // 1. Load and cache data for the current set
        const currentSetData = await parseAndCache(meta);
        
        // 2. Load and cache data for ALL other sets concurrently
        await Promise.all(
          sets
            .filter(s => s.key !== setKey)
            .map(parseAndCache)
        );
        if (!loadCommitGate.canCommit(loadToken)) return;

        const catalog = canonicalCatalogFromParsedSets(parsedCacheRef.current.values());
        const loadedInventory = loadInventoriesForPersistence(localStorage, setKeys, catalog);
        if (!loadCommitGate.canCommit(loadToken)) return;

        if (!loadedInventory.migrationSucceeded) {
          showToast(
            loadedInventory.backupPreserved
              ? 'Inventory migration could not finish. Your original backup remains preserved.'
              : 'Inventory migration could not create a backup. Automatic saving is disabled to protect your original data.',
            'warning',
          );
        }

        // 3. Update the state for the current view
        setCanonicalCatalog(catalog);
        setCardsAll(currentSetData.allCards);
        setCardsBase(currentSetData.baseCards);
        setInventory(loadedInventory.inventories[setKey] ?? {});
        setInventoryReadyForSet(loadedInventory.persistenceAllowed ? setKey : null);

        // REMOVED: Deferred navigation logic (moved to a new hook below)
      }
      load().catch(() => {
        if (loadCommitGate.canCommit(loadToken)) setError('Failed to load set data.');
      });
      return () => loadCommitGate.cancel(loadToken);
    // Dependencies only include set changes (NO pendingSelection)
    }, [baseOnly, buildAltMaps, setKey, sets, setKeys, setViewSpread, showToast]);

    // Deferred Navigation Hook: Runs after new set data is loaded
    useEffect(() => {
      // Only run if there is a pending card AND the current set data has loaded cards
      if (
        pendingSelection &&
        pendingSelection.setKey === setKey &&
        cardsBase.length > 0 &&
        cardsBase.some(card => card.Set === setKey)
      ) {
          // IMPORTANT: Clear any previous error before attempting the new lookup
          setError(''); 

          // Find the base card in the newly loaded set
          const card = cardsBase.find(c => c.Number === pendingSelection.baseNumber);

          if (card) {
              activateCard(card);
              // Clear query so search bar looks clean after selection
              setQuery('');
          } else {
              // Only set an error if the card truly cannot be found in the loaded set
              setError(`Failed to find card #${pendingSelection.baseNumber} in set ${setKey}.`);
          }
          
          // Always clear the pending state after attempting selection
          setPendingSelection(null); 
      }
    }, [activateCard, pendingSelection, cardsBase, setKey]);
  // Build coloring map + presence
  const presentNumbers = useMemo(() => new Set(cardsBase.map(c => c.Number)), [cardsBase]);
  const numToAspectSpec = useMemo(() => {
    const m = new Map<number, AspectFillSpec>();
    for (const c of cardsBase) {
      const spec = aspectSpecFromCardAspects(c.Aspects);
      if (spec) m.set(c.Number, spec);
    }
    return m;
  }, [cardsBase]);

  // Suggestions retain the exact set and base-card identity selected by the user.
  const searchCatalogs: SearchCatalog[] = useMemo(
    () => {
      if (canonicalCatalog.size === 0) return [];
      return Array.from(parsedCacheRef.current.entries()).map(([catalogSetKey, parsed]) => ({
        setKey: catalogSetKey,
        cards: parsed.baseCards,
        printingNumbersByBase: parsed.baseToAll,
        baseByPrintingNumber: new Map([
          ...parsed.baseCards.map(card => [card.Number, card.Number] as const),
          ...parsed.altToBase.entries(),
        ]),
      }));
    },
    [canonicalCatalog],
  );
  const suggestions = useMemo(
    () => buildSearchSuggestions(query, searchCatalogs, setKey),
    [query, searchCatalogs, setKey],
  );
  // Click outside to close dropdown
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (
        boxRef.current &&
        e.target instanceof Node &&
        !boxRef.current.contains(e.target)
      ) {
        setOpenSug(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function chooseSuggestion(suggestion: SearchSuggestion) {
    if (suggestion.setKey !== setKey) {
      setPendingSelection({
        setKey: suggestion.setKey,
        baseNumber: suggestion.baseNumber,
      });
      setSetKey(suggestion.setKey);
      setQuery('');
      setOpenSug(false);
      return;
    }

    selectCardByNumber(suggestion.baseNumber);
    setQuery('');
    setOpenSug(false);
  }

  function submitSearch() {
    const suggestion = submittedSuggestion(suggestions, highlightIdx);
    if (!suggestion) {
      setError(query.trim() ? 'No matching card found.' : 'Enter a name or number.');
      return;
    }
    chooseSuggestion(suggestion);
  }
  submitSearchRef.current = submitSearch;

  function selectCardByNumber(baseNum: number) {
    const card = byNumber.get(baseNum);
    if (!card) { 
      setError('Card not found in current set data.');
      return; 
    }
    activateCard(card);
  }

  const updateActivePosition = useCallback((deltaCol: number, deltaRow: number) => {
    if (!active) return;
    const direction = deltaCol < 0
      ? 'left'
      : deltaCol > 0
        ? 'right'
        : deltaRow < 0
          ? 'up'
          : 'down';
    const next = selectionAfterMove(active, direction, totalPages, byNumber);
    if (next === active) return;

    setActive(next);
    setFocusedPage(next.page);
  }, [active, totalPages, byNumber]);
  

  const [prevSetKey, nextSetKey] = useMemo(() => {
      const currentIndex = sets.findIndex(s => s.key === setKey);
      if (currentIndex === -1) return [null, null];

      const prevIndex = (currentIndex - 1 + sets.length) % sets.length;
      const nextIndex = (currentIndex + 1) % sets.length;

      // Only return prev/next if there's more than one set
      if (sets.length <= 1) return [null, null];
      
      // Check if the wrap-around is needed; if so, return the correct key.
      const prevKey = (currentIndex === 0) ? sets[prevIndex].key : sets[prevIndex].key;
      const nextKey = (currentIndex === sets.length - 1) ? sets[nextIndex].key : sets[nextIndex].key;

      // Use null if they wrap to the same key (should only happen if length <= 1, but added check)
      if (prevKey === setKey) return [null, nextKey];
      if (nextKey === setKey) return [prevKey, null];

      return [prevKey, nextKey];
  }, [setKey, sets]);

  const changeSet = useCallback((direction: 'prev' | 'next') => {
      const targetKey = direction === 'prev' ? prevSetKey : nextSetKey;
      if (targetKey) {
          setSetKey(targetKey as SetKey);
          // Reset view/search state upon set change
          setQuery('');
          setActive(null);
          setViewSpread(0);
      }
  }, [prevSetKey, nextSetKey, setSetKey, setQuery, setActive, setViewSpread]);

  // Inventory helpers
  function readSetInv(k: SetKey): Inventory {
    try {
      return canonicalizeInventory(
        k,
        JSON.parse(localStorage.getItem(`inv:${k}`) || '{}') as Inventory,
        canonicalCatalog,
      );
    }
    catch { return {}; }
  }
  function writeSetInv(k: SetKey, inv: Inventory): boolean {
    return persistCanonicalInventory(localStorage, k, inv, canonicalCatalog);
  }
  const inc = useCallback((n: number) => {
    const baseNumber = canonicalCatalog.get(`${setKey}:${n}`)?.baseNumber ?? null;
    if (baseNumber === null) return;
    const ref = canonicalCatalog.get(`${setKey}:${baseNumber}`);
    const max = quotaForType(ref?.type);
    setInventory(prev => ({
      ...prev,
      [baseNumber]: Math.min((prev[baseNumber] || 0) + 1, max),
    }));
  }, [canonicalCatalog, setKey]);
  const dec = useCallback((n: number) => {
    const baseNumber = canonicalCatalog.get(`${setKey}:${n}`)?.baseNumber ?? null;
    if (baseNumber === null) return;
    setInventory(prev => {
      const next = Math.max((prev[baseNumber] || 0) - 1, 0);
      if (next === 0) {
        const { [baseNumber]: _removed, ...rest } = prev; // drop the key entirely
        return rest;
      }
      return { ...prev, [baseNumber]: next };
    });
  }, [canonicalCatalog, setKey]);
  function exportAllInv() {
    const payload = {
      version: 1 as const,
      sets: Object.fromEntries(setKeys.map(k => [k, readSetInv(k)])) as Record<SetKey, Inventory>,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SWU-Inventory-${tsStamp()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function RarityBadge({ rarity }: { rarity?: string }) {
    const sty = rarityGlyph(rarity);
    if (!sty) return null;

    const strokeColor = (sty.color === '#000000') ? '#ffffff' : '#11121a';
    // SVG text with stroke matches the binder’s corner glyph look
    return (
      <svg
        width="30" height="26" viewBox="0 0 22 20"
        role="img" aria-label={`Rarity ${rarity}`}
        style={{ display: 'block' }}
      >
        <text
          x="50%" y="60%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="14"
          fontWeight={900}
          fill={sty.color}
          stroke={strokeColor}
          strokeWidth={2}
          paintOrder="stroke"
        >
          {sty.letter}
        </text>
      </svg>
    );
  }

  /** Shared leading cells (#, aspect dot, rarity, name/subtitle, type) for the Inventory and Missing tables. */
  function CardIdentityCells({
    number, aspectSpec, rarity, name, subtitle, type,
  }: {
    number: number;
    aspectSpec: AspectFillSpec | undefined;
    rarity?: string;
    name: string;
    subtitle?: string;
    type?: string;
  }) {
    const dotBg = aspectSpecToInventorySwatchBackground(aspectSpec);
    return (
      <>
        <td className="mono numcol">#{number}</td>
        <td className="dotcol">
          {dotBg && (
            <span
              title="Aspect color"
              aria-label="Aspect color"
              style={{ ...INVENTORY_ASPECT_SWATCH_STYLE, background: dotBg }}
            />
          )}
        </td>
        <td className="rarcol">
          <RarityBadge rarity={rarity} />
        </td>
        <td>
          {name}
          {subtitle && (
            <span style={{ opacity: 0.7, fontSize: '0.9em', display: 'block', lineHeight: 1 }}>
              {subtitle}
            </span>
          )}
        </td>
        <td>{type || ''}</td>
      </>
    );
  }

  /** Shared collection-status glyph (✓ complete / ! partial / ✕ none) used by the Inventory and Missing tables. */
  function CollectionStatusBadge({ have, max }: { have: number; max: number }) {
    if (have >= max) return <span className="check" title="Complete" aria-label="Complete">✓</span>;
    if (have > 0) return <span className="warn" title="Partially collected" aria-label="Partially collected">!</span>;
    return <span className="x" title="Not collected" aria-label="Not collected">✕</span>;
  }

  const CORE_RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary']; // List of non-special core rarities

  function performBulkAction(
    action: 'add' | 'remove' | 'add_max' | 'remove_all',
    target: 'all' | string, // string means Rarity or Type key
    qty: number = 1
  ) {
    // REMOVED BROWSER CONFIRMATION for all actions per user request.
    
    setInventory(prevInv => {
      const nextInv: Inventory = { ...prevInv };

      for (const card of cardsBase) {
        let processCard = false;

        if (target === 'all') {
          processCard = true;
        } else if (CORE_RARITIES.includes(target)) {
          // Check for core Rarity targets
          if (card.Rarity === target) {
            processCard = true;
          }
        } else if (target === 'Special') {
          const cardRarity = card.Rarity;
          if (cardRarity === 'Special') {
            processCard = true;
          }
        } else {
          // Assume target is a Card Type (Leader, Unit, Event, Upgrade, etc.)
          if (card.Type === target) {
            processCard = true;
          }
        }

        if (processCard) {
          const max = quotaForType(card.Type);
          const currentQty = nextInv[card.Number] || 0;

          if (action === 'add' || action === 'add_max') {
            const amount = action === 'add' ? qty : max;
            nextInv[card.Number] = Math.min(currentQty + amount, max);
          } else if (action === 'remove') {
            const nextQty = Math.max(currentQty - qty, 0);
            if (nextQty === 0) {
              delete nextInv[card.Number];
            } else {
              nextInv[card.Number] = nextQty;
            }
          } else if (action === 'remove_all') {
             delete nextInv[card.Number];
          }
        }
      }
      return pruneZeros(nextInv);
    });
    setShowBulkActionsModal(false);
  }

  const handleResetInventory = (scope: 'current' | 'all') => {
      if (scope === 'current') {
          if (removePersistedInventory(localStorage, setKey, canonicalCatalog)) {
              setInventory({});
              showToast(`Inventory for the current set (${setKey}) has been cleared.`);
          } else {
              showToast('Inventory could not be cleared while protected persistence is locked.', 'warning');
          }
      } else if (scope === 'all') {
          let allRemoved = true;
          // Clear set inventories without deleting the migration backup or schema marker.
          if (!sets.length) {
              for (const key of Object.keys(localStorage)) {
                  if (/^inv:[A-Z0-9]+$/.test(key)) {
                      allRemoved = removePersistedInventory(localStorage, key.slice(4), canonicalCatalog) && allRemoved;
                  }
              }
          } else {
              // Clear based on loaded set keys
              for (const set of sets) {
                  allRemoved = removePersistedInventory(localStorage, set.key, canonicalCatalog) && allRemoved;
              }
          }
          if (allRemoved) {
              setInventory({}); // Reset current view as well
              showToast('Inventory for ALL sets has been cleared.');
          } else {
              showToast('Inventories could not be cleared while protected persistence is locked.', 'warning');
          }
      }
      setShowResetModal(false);
  };

  function resetInv() {
      setShowResetModal(true);
  }

  const applyImport = (mode: 'merge' | 'replace') => {
      const current = Object.fromEntries(setKeys.map(key => [key, readSetInv(key)])) as Record<SetKey, Inventory>;
      const knownSetKeys = new Set(setKeys);
      const safeImportData = Object.fromEntries(
        Object.entries(importData).filter(([key]) => knownSetKeys.has(key)),
      ) as Record<SetKey, Inventory>;
      const result = applyImportedInventories(current, safeImportData, mode, canonicalCatalog);
      let importedCount = 0;
      let persistenceBlocked = false;

      for (const key of Object.keys(safeImportData) as SetKey[]) {
          if (!knownSetKeys.has(key)) continue;
          const nextInventory = pruneZeros(result.inventories[key] ?? {});
          if (writeSetInv(key, nextInventory)) {
              importedCount += Object.keys(nextInventory).length;
              if (key === setKey) setInventory(nextInventory);
          } else {
              persistenceBlocked = true;
          }
      }
      
      setShowImportModal(false);
      setImportData({});
      showToast(
        persistenceBlocked
          ? 'Import was not saved while protected persistence is locked.'
          : `Applied ${importedCount} canonical card entries in ${mode} mode (${importStats.recognized} recognized, ${importStats.skipped} skipped).`,
        persistenceBlocked ? 'warning' : 'success',
      );
      setImportStats({ recognized: 0, skipped: 0 });
  };
  
  // File change handler to parse the file and open the modal
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImportingFileName(file.name);
      setError('');

      try {
          const ext = file.name.split('.').pop()?.toLowerCase();
          
          if (canonicalCatalog.size === 0) throw new Error('Card catalog is still loading. Please try again.');
          
          const parsedImport =
            ext === 'xlsx'
              ? await parseXlsxData(file, canonicalCatalog)
              : parseCsvData(file.name, await file.text(), canonicalCatalog);
          const knownSetKeys = new Set(setKeys);
          const safeInventories = Object.fromEntries(
            Object.entries(parsedImport.inventories).filter(([key]) => knownSetKeys.has(key)),
          ) as Record<SetKey, Inventory>;
          setImportData(safeInventories);
          setImportStats({ recognized: parsedImport.recognized, skipped: parsedImport.skipped });
          setShowImportModal(true);
      } catch (e) {
          setError(`Import failed: ${e instanceof Error ? e.message : 'Invalid file format.'}`);
      } finally {
          e.target.value = '';
      }
  };

  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = (node.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || node.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);

      // Focus search
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select?.();
        return;
      }

      // Run search
      if (e.key === 'Enter' && !typing) {
        if ((query || '').trim()) {
          e.preventDefault();
          submitSearchRef.current();
        }
        return;
      }

      // Key bindings (selection movement + page flipping)
      if (!typing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setActive(null);
          return;
        }
        
        let deltaSpread = 0;
        
        // NEW: Page flipping shortcuts ("," and ".")
        if ((e.key === ',' || e.key === '<') && binderViewMode === 'spread') { // Comma
          e.preventDefault();
          deltaSpread = -1;
        } else if ((e.key === '.' || e.key === '>') && binderViewMode === 'spread') { // Period
          e.preventDefault();
          deltaSpread = 1;
        }
        
        // Browsing changes the viewed anchor only; selection and locator remain stable.
        if (deltaSpread !== 0) {
          setViewSpread(currentSpread => (
            Math.max(0, Math.min(totalSpreads - 1, currentSpread + deltaSpread))
          ));
          return;
        } // End Page Flip Logic

        // Card selection movement (Arrow keys) and Qty Adjust
        if (active) {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            updateActivePosition(-1, 0); // Move 1 column left (literal)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            updateActivePosition(1, 0); // Move 1 column right (literal)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateActivePosition(0, -1); // Move 1 row up (literal)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateActivePosition(0, 1); // Move 1 row down (literal)
          } else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
            e.preventDefault();
            inc(active.card.Number);
          } else if (e.key === '-' || e.code === 'NumpadSubtract') {
            e.preventDefault();
            dec(active.card.Number);
          }
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, query, setViewSpread, totalSpreads, updateActivePosition, inc, dec, byNumber, totalPages, binderViewMode]);

  const fmtUSD = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const passesAllFilters = useCallback((card: Card) => {
    const activeAspects = filters.aspect;
    const activeRarities = filters.rarity;
    const activeTypes = filters.type;

    // 1) Aspect — match if any card aspect is selected (multi-aspect cards match any listed aspect)
    if (activeAspects.length > 0) {
      const labels = card.Aspects?.length ? card.Aspects : ['NEUTRAL'];
      if (!labels.some(a => activeAspects.includes(a))) return false;
    }

    // 2) Rarity
    if (activeRarities.length > 0) {
      if (!activeRarities.includes(card.Rarity || '')) return false;
    }

    // 3) Type
    if (activeTypes.length > 0) {
      if (!activeTypes.includes(card.Type || '')) return false;
    }

    return true;
  }, [filters.aspect, filters.rarity, filters.type]);

  /** True if any card passes aspect/rarity/type filters and is not a complete playset (ignores status pills). */
  const hasIncompleteUnderCardFilters = useMemo(() => {
    for (const baseCard of cardsBase) {
      if (!passesAllFilters(baseCard)) continue;
      const baseNum = baseCard.Number;
      const have = inventory[baseNum] || 0;
      const max = quotaForType(baseCard.Type);
      if (have < max) return true;
    }
    return false;
  }, [cardsBase, inventory, passesAllFilters]);

  // Build ONE list over base cards, then partition.
  // Each row has Qty (across base + alts), Max, Needed, and other fields you already use.
  const filteredAllRows = useMemo(() => {
    const rows: Array<{
      Number: number;
      Name: string;
      Subtitle?: string;
      Type?: string;
      Rarity?: string;
      Price: number;    // MarketPrice (unit)
      Qty: number;      // have across base+alts
      Max: number;
      Needed: number;   // Max - Qty
    }> = [];

    for (const baseCard of cardsBase) {
      if (!passesAllFilters(baseCard)) continue;

      const baseNum = baseCard.Number;
      const have = inventory[baseNum] || 0;
      const max = quotaForType(baseCard.Type);
      const needed = Math.max(0, max - have);
      const collStatus = collectionStatusFromQty(have, max);
      if (filters.status.length > 0 && !filters.status.includes(collStatus)) continue;

      rows.push({
        Number: baseNum,
        Name: baseCard.Name,
        Subtitle: baseCard.Subtitle,
        Type: baseCard.Type,
        Rarity: baseCard.Rarity,
        Price: Number(baseCard?.MarketPrice ?? 0),
        Qty: have,
        Max: max,
        Needed: needed,
      });
    }

    return rows.sort((a, b) => a.Number - b.Number);
  }, [cardsBase, inventory, passesAllFilters, filters.status]);

  // Projections for the two tabs (shape-compatible with your tables)
  const filteredInvRows = useMemo(() => {
    // rows with Qty > 0
    return filteredAllRows
      .filter(r => r.Qty > 0)
      .map(r => ({ Number: r.Number, Name: r.Name, Type: r.Type, Qty: r.Qty, Max: r.Max }));
  }, [filteredAllRows]);

  const filteredMissingRows = useMemo(() => {
    return filteredAllRows
      .filter(r => r.Qty < r.Max)
      .map(r => ({
        Number: r.Number,
        Name: r.Name,
        Type: r.Type,
        Have: r.Qty,
        Max: r.Max,
        Needed: r.Needed,
        Price: r.Price,
        RowTotal: r.Needed * r.Price,
      }));
  }, [filteredAllRows]);

  const invRows = filteredInvRows;

  // Inventory Status Counts (Complete, Incomplete, Missing) from the single list
  const inventoryStatus = useMemo(() => {
    let complete = 0, incomplete = 0, missing = 0;

    for (const r of filteredAllRows) {
      if (r.Qty >= r.Max) complete++;
      else if (r.Qty > 0) incomplete++;
      else missing++;
    }

    return {
      complete,
      incomplete,
      missing,
      totalCards: filteredAllRows.length, // <- single source of truth
    };
  }, [filteredAllRows]);

  const collectionValue = useMemo(
    () => filteredAllRows.reduce((sum, r) => sum + r.Qty * r.Price, 0),
    [filteredAllRows]
  );

  const missingCost = useMemo(
    () => filteredMissingRows.reduce((sum, r) => sum + r.RowTotal, 0),
    [filteredMissingRows]
  );

  function copyMissingToClipboard() {
    const list = filteredMissingRows.map(r => {
        // r.Number is the base number for this row
        // Use byNumber to retrieve the Card object which contains Subtitle
        const card = byNumber.get(r.Number);
        
        // Construct the card name part: "Name - Subtitle"
        const cardNamePart = card?.Subtitle 
            ? `${r.Name} - ${card.Subtitle}` 
            : r.Name;
        
        const qty = tcgCopyMode === 'oneEach' ? 1 : r.Needed;
        // Final format: QTY Name - Subtitle [setKey]
        return `${qty} ${cardNamePart} [${setKey}]`;
    }).join('\n');

    if (list.length === 0) {
        showToast('No missing cards matching current filters to copy!', 'warning');
        return;
    }

    clearTcgCopyFeedbackTimer();

    navigator.clipboard.writeText(list).then(() => {
        setTcgCopyFeedback('copied');
        tcgCopyFeedbackTimerRef.current = window.setTimeout(() => {
          setTcgCopyFeedback('idle');
          tcgCopyFeedbackTimerRef.current = null;
        }, 2200);
    }).catch(err => {
        setTcgCopyFeedback('failed');
        tcgCopyFeedbackTimerRef.current = window.setTimeout(() => {
          setTcgCopyFeedback('idle');
          tcgCopyFeedbackTimerRef.current = null;
        }, 3200);
        console.error('Copy error:', err);
    });
  }

  return (
    <div 
            className="container"
            style={{
                maxWidth: 'min(1920px, calc(100vw - 24px))',
                width: '100%',
                padding: '10px 12px',
                margin: '0 auto',
                boxSizing: 'border-box',
            }}
        >
      {/* Top bar (no page control here anymore) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 className="title">SWU Binder Organizer</h1>
        <div className="row controls-row" style={{ marginTop: 8 }} ref={boxRef}>
          <div
            className="set-switch-group"
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
            role="group"
            aria-label="Card set"
          >
            <button
              type="button"
              className="btn set-switch-btn"
              disabled={!prevSetKey}
              onClick={() => changeSet('prev')}
              title={prevSetKey ? `Switch to set ${prevSetKey}` : undefined}
              aria-label={prevSetKey ? `Previous set: ${prevSetKey}` : 'Previous set (none)'}
            >
              ‹
            </button>
            <label className="pill">
              <span className="set-label">Set</span>
              <select value={setKey} onChange={e => {
                setSetKey(e.target.value as SetKey);
                setQuery('');
              }}>
                {sets.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn set-switch-btn"
              disabled={!nextSetKey}
              onClick={() => changeSet('next')}
              title={nextSetKey ? `Switch to set ${nextSetKey}` : undefined}
              aria-label={nextSetKey ? `Next set: ${nextSetKey}` : 'Next set (none)'}
            >
              ›
            </button>
          </div>

          <div className="autocomplete search">
            <span className="search-kbd" aria-hidden="true">/</span>
            <input
              ref={searchRef}
              placeholder="Search name or number (e.g., 'Vader' or '216')"
              value={query}
              onChange={e => { setQuery(e.target.value); setOpenSug(true); setHighlightIdx(0); }}
              onKeyDown={(e) => {
                // Close + blur on Esc
                if (e.key === 'Escape' || e.key === 'Esc') {
                  e.preventDefault();
                  setOpenSug(false);
                  setHighlightIdx(0);
                  (e.currentTarget as HTMLInputElement).blur();
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setOpenSug(true);
                  setHighlightIdx(i => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightIdx(i => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitSearch();
                  setOpenSug(false);
                  setHighlightIdx(0);
                  (e.currentTarget as HTMLInputElement).blur();   // <-- defocus on Enter
                  return;
                }
              }}
              onFocus={() => suggestions.length && setOpenSug(true)}
              aria-label="Search cards"
            />
            <button
              type="button"
              className="search-icon"
              onClick={submitSearch}
              title="Search"
              aria-label="Search"
            >
              <span className="icon" aria-hidden="true">search</span>
            </button>
            {openSug && suggestions.length > 0 && (
              <div className="sug">
                {suggestions.map((s, i) => {
                  const typeText = s.type ? s.type : ''; 

                  const nums = s.printingNumbers;
                  const numsLabel = nums.map((n) => `#${n}`).join(', ');

                  return (
                    <div
                      key={`${s.setKey}:${s.baseNumber}`} // Ensure unique key across sets
                      className={`sug-item ${i === highlightIdx ? 'active' : ''}`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                      role="option"
                      aria-selected={i === highlightIdx}
                      // Apply flex styling to arrange items horizontally
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }} 
                    >
                      {/* NEW: Set Key Pill at the beginning */}
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          // Highlight the current set
                          border: '1px solid currentColor', 
                          opacity: s.setKey === setKey ? 1 : 0.6,
                          color: s.setKey === setKey ? '#ffffff' : '#999', 
                          backgroundColor: s.setKey === setKey ? '#0b0b0b' : 'transparent',
                          flexShrink: 0,
                        }}
                      >
                        {s.setKey}
                      </span>

                      <span className="sug-name" style={{ flexGrow: 1, minWidth: 0 }}>
                        {s.name}
                        {s.subtitle && <span className="sug-subtitle muted" style={{ opacity: 0.7, fontSize: '0.9em' }}> - {s.subtitle}</span>}
                        {typeText && <span className="sug-type">{typeText}</span>}
                      </span>
                      <span className="sug-num mono">{numsLabel}</span>
                      <span className="sug-kind">{s.kind === 'number' ? 'num' : 'name'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right side controls */}
          <div className="toolbar-block">
            <div className="toolbar-label">Inventory Controls</div>
            <div className="toolbar-group">
              {/* Import button points to the hidden file input */}
              <button className="tbtn" onClick={() => importRef.current?.click()} title="Import inventory data (JSON / CSV / XLSX)" aria-label="Import inventory data">
                  <span className="icon" aria-hidden="true">upload</span> <span>Import…</span>
              </button>
              <input 
                  ref={importRef} 
                  type="file" 
                  accept=".json,.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  style={{ display: 'none' }} 
                  onChange={handleFileChange}
              />
              {/* Save / Export */}
              <button
                className="tbtn"
                onClick={() => exportAllInv()}
                title="Save inventory to JSON"
                aria-label="Save inventory to JSON"
              >
                <span className="icon" aria-hidden="true">save</span>
                <span>Save</span>
              </button>

              {/* Reset */}
              <button 
                  className="tbtn tbtn-danger" 
                  onClick={resetInv} 
                  title="Reset inventory" 
                  aria-label="Reset inventory" 
              > 
                  <span className="icon" aria-hidden="true">delete</span> <span>Reset</span> 
              </button>
              <button
                ref={settingsButtonRef}
                type="button"
                className="tbtn"
                onClick={() => setShowSettingsModal(true)}
                title="Settings"
                aria-label="Open settings"
              >
                <span className="icon" aria-hidden="true">settings</span>
                <span>Settings</span>
              </button>
            </div>
          </div>

          {error && <span className="err">{error}</span>}
        </div>
      </div>

      {/* Binder (with spread pager + dropdown) — minimal padding so the grid can use width */}
      <div className="card" ref={binderRef} style={{ padding: 8 }}>
        {active && (
          <LocatorPanel
            selection={active}
            quantity={inventory[active.number] || 0}
            maximum={quotaForType(active.card.Type)}
            aspectBackground={aspectSpecToCssBackground(numToAspectSpec.get(active.number))}
            onDecrease={() => dec(active.number)}
            onIncrease={() => inc(active.number)}
          />
        )}
        <Binder
          viewSpread={viewSpread}
          setViewSpread={setViewSpread}
          totalSpreads={totalSpreads}
          totalPages={totalPages}
          viewMode={binderViewMode}
          focusedPage={focusedPage}
          onFocusedPageChange={setFocusedPage}
          onViewModeChange={setBinderViewMode}
          onActivateCard={activateCard}
          active={active}
          presentNumbers={presentNumbers}
          numToAspectSpec={numToAspectSpec}
          byNumber={byNumber}
          inventory={inventory}
          inc={inc}
          dec={dec}
          setKey={setKey}
          showHelpModal={showHelpModal}
          setShowHelpModal={setShowHelpModal}
        />
      </div>

      {/* Inventory table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent:'space-between', alignItems: 'center' }}>
          
          {/* LEFT SIDE: Toggles (New Header) + Copy Button */}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {/* Set Key Pill Badge (Matching the Binder's badge style) */}
            <span
              style={{
                fontSize: '14px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px',
                border: '1px solid #ffffff', 
                color: '#ffffff', 
                backgroundColor: '#0b0b0b',
                flexShrink: 0,
              }}
            >
              {setKey}
            </span>
            
            {/* 1. Inventory/Missing Toggles (Tab Selector - Anchor Left) */}
            <div className="toolbar-group" role="tablist" aria-label="Inventory view">
              <button
                className="tbtn"
                role="tab"
                aria-selected={listView === 'inventory'}
                onClick={() => setListView('inventory')}
                title="Show your current inventory"
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  padding: '10px 16px',
                  ...(listView === 'inventory' ? { backgroundColor: '#213c6a', color: '#fff', border: '1px solid #213c6a' } : {})
                }}
              >
                Inventory
              </button>
              <button
                className="tbtn"
                role="tab"
                aria-selected={listView === 'missing'}
                onClick={() => setListView('missing')}
                title="Show cards you don’t have yet"
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  padding: '10px 16px',
                  ...(listView === 'missing' ? { backgroundColor: '#213c6a', color: '#fff', border: '1px solid #213c6a' } : {})
                }}
              >
                Missing
              </button>
            </div>
            
            {/* 2. Action Button (Conditional: Copy TCG or Bulk Actions) */}
            {listView === 'missing' && hasIncompleteUnderCardFilters ? (
              <>
                <div className="toolbar-group" role="group" aria-label="TCG copy quantity">
                  <button
                    type="button"
                    className="tbtn"
                    aria-pressed={tcgCopyMode === 'fullNeeded'}
                    onClick={() => setTcgCopyMode('fullNeeded')}
                    title="Copy quantities equal to copies still needed for a full playset"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      padding: '6px 12px',
                      ...(tcgCopyMode === 'fullNeeded'
                        ? { backgroundColor: '#213c6a', color: '#fff', border: '1px solid #213c6a' }
                        : {}),
                    }}
                  >
                    Full need
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    aria-pressed={tcgCopyMode === 'oneEach'}
                    onClick={() => setTcgCopyMode('oneEach')}
                    title="Copy 1 of each listed card (e.g. binder singles without a full 3× set)"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      padding: '6px 12px',
                      ...(tcgCopyMode === 'oneEach'
                        ? { backgroundColor: '#213c6a', color: '#fff', border: '1px solid #213c6a' }
                        : {}),
                    }}
                  >
                    1 each
                  </button>
                </div>
                <button
                  type="button"
                  className="tbtn tbtn-primary"
                  onClick={copyMissingToClipboard}
                  title={
                    tcgCopyFeedback === 'failed'
                      ? 'Could not write to the clipboard. Check site permissions.'
                      : tcgCopyMode === 'oneEach'
                      ? 'Copy list with quantity 1 per line: Name - Subtitle [setKey]'
                      : 'Copy list with quantities = copies still needed: QTY Name - Subtitle [setKey]'
                  }
                  aria-label={
                    tcgCopyFeedback === 'copied'
                      ? 'Copied list to clipboard'
                      : tcgCopyFeedback === 'failed'
                      ? 'Copy to clipboard failed'
                      : tcgCopyMode === 'oneEach'
                      ? 'Copy missing cards for TCGPlayer, one of each line'
                      : 'Copy missing cards for TCGPlayer with full needed quantities'
                  }
                  style={{
                    ...(tcgCopyFeedback === 'copied'
                      ? { backgroundColor: '#166534', borderColor: '#166534' }
                      : tcgCopyFeedback === 'failed'
                      ? { backgroundColor: '#7f1d1d', borderColor: '#7f1d1d' }
                      : {}),
                    transition: 'background-color 0.2s ease, border-color 0.2s ease',
                  }}
                >
                  <span className="icon" aria-hidden="true">
                    {tcgCopyFeedback === 'copied' ? 'check_circle' : tcgCopyFeedback === 'failed' ? 'error' : 'content_paste'}
                  </span>
                  <span aria-live="polite">
                    {tcgCopyFeedback === 'copied'
                      ? 'Copied to clipboard'
                      : tcgCopyFeedback === 'failed'
                      ? 'Copy failed'
                      : `Copy TCG List (${filteredMissingRows.length})`}
                  </span>
                </button>
              </>
            ) : listView === 'inventory' ? (
              <button
                className="tbtn tbtn-primary" 
                onClick={() => setShowBulkActionsModal(true)} // Opens the new modal
                title="Perform bulk operations on inventory"
                aria-label="Open bulk inventory actions modal"
              >
                <span className="icon" aria-hidden="true">layers</span>
                <span>Bulk Actions</span>
              </button>
            ) : null}
          </div> {/* End LEFT SIDE */}
          
          {/* RIGHT SIDE: Status/Cost Display (Pinned Right) */}
          <div className="muted"
            style={{
              width: '500px',
              textAlign: 'right',
              whiteSpace: 'nowrap',
            }}
          >
          <div
            className="muted"
            aria-live="polite"
            style={{ paddingTop: 18, paddingBottom: 16 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Collection Status ({inventoryStatus.totalCards} Unique Cards)
              </div>
              <div
                title={`Complete: ${inventoryStatus.complete}, In Progress: ${inventoryStatus.incomplete}, Missing: ${inventoryStatus.missing}`}
                style={{
                  width: '100%',
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: '#ef4444',
                  display: 'flex',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${inventoryStatus.totalCards ? (inventoryStatus.complete / inventoryStatus.totalCards) * 100 : 0}%`,
                    backgroundColor: '#22c55e',
                  }}
                />
                <div
                  style={{
                    width: `${inventoryStatus.totalCards ? (inventoryStatus.incomplete / inventoryStatus.totalCards) * 100 : 0}%`,
                    backgroundColor: '#f59e0b',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 12, opacity: 0.8 }}>
                <span style={{ color: '#34d399' }}>✓ {inventoryStatus.complete}</span>
                <span style={{ color: '#fcd34d' }}>! {inventoryStatus.incomplete}</span>
                <span style={{ color: '#f87171' }}>✕ {inventoryStatus.missing}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {listView === 'inventory' ? (
                  <>Collection value: {fmtUSD(collectionValue)}</>
                ) : (
                  <>Cost to Complete: {fmtUSD(missingCost)}</>
                )}
              </div>
            </div>
          </div>
          </div> {/* End RIGHT SIDE content */}
        </div>

        {/* Global Filter Controls */}
        <FilterControls filters={filters} setFilters={setFilters} />

        {listView === 'inventory' ? (
          filteredInvRows.length ? (
            <div className="inventory-scroll" style={{ maxHeight: '500px' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="mono numcol">#</th>
                    <th className="dotcol"></th>
                    <th className="rarcol"></th>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="mono qtycol">Qty</th>
                    <th className="compcol">Status</th>
                    <th className="adjcol">Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvRows.map(r => {
                    const aspectSpec = numToAspectSpec.get(r.Number);
                    const card = byNumber.get(r.Number) || cardsAll.find(x => x.Number === r.Number);
                    const isHighlighted = r.Number === highlightedRowNumber;
                    return (
                      <tr
                        key={r.Number}
                        style={{
                          cursor: 'pointer',
                          // Conditional inline styling for the highlight
                          transition: 'background-color 0.5s ease',
                          backgroundColor: isHighlighted ? '#424452' : 'transparent',
                        }}
                        onClick={() => selectCardByNumber(r.Number)} // Added click handler
                      >
                        <CardIdentityCells
                          number={r.Number}
                          aspectSpec={aspectSpec}
                          rarity={card?.Rarity}
                          name={r.Name}
                          subtitle={card?.Subtitle}
                          type={r.Type}
                        />
                        <td className="mono qtycol">{r.Qty}</td>
                        <td className="compcol">
                          <CollectionStatusBadge have={r.Qty} max={r.Max} />
                        </td>
                        <td className="adjcol">
                          <div className="qtybtns circle">
                            <button className="minus" aria-label="Decrease" onClick={()=>dec(r.Number)}>−</button>
                            <button className="plus" aria-label="Increase" onClick={()=>inc(r.Number)}>+</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">
              {invRows.length ? 
                'No inventory entries match current filters.' : // NEW: Filtered empty message
                'No entries yet. Click any slot’s +/− or use this table once you add cards.'
              }
            </div>
          )
        ) : (
          // Check if there are any missing rows BEFORE rendering the inventory-scroll div
          filteredMissingRows.length ? (
            <div className="inventory-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th className="mono numcol">#</th>
                    <th className="dotcol"></th>
                    <th className="rarcol"></th>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="compcol">Status</th>
                    <th className="mono qtycol">Needed</th>
                    <th className="mono moneycol">Cost</th>
                    <th className="adjcol">Add</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMissingRows.map(r => {
                    const aspectSpec = numToAspectSpec.get(r.Number);
                    const card = byNumber.get(r.Number) || cardsAll.find(x => x.Number === r.Number);
                    const isHighlighted = r.Number === highlightedRowNumber;
                    return (
                      <tr
                        key={r.Number}
                        style={{
                          cursor: 'pointer',
                          transition: 'background-color 0.5s ease',
                          backgroundColor: isHighlighted ? '#424452' : 'transparent',
                        }}
                        onClick={() => selectCardByNumber(r.Number)}
                      >
                        <CardIdentityCells
                          number={r.Number}
                          aspectSpec={aspectSpec}
                          rarity={card?.Rarity}
                          name={r.Name}
                          subtitle={card?.Subtitle}
                          type={r.Type}
                        />
                        <td className="compcol">
                          <CollectionStatusBadge have={r.Have} max={r.Max} />
                        </td>
                        <td className="mono qtycol">{r.Needed}</td>
                        <td className="mono moneycol">{fmtUSD(r.RowTotal)}</td>
                        <td className="adjcol">
                          <div className="qtybtns circle">
                            <button
                              className="plus"
                              aria-label={`Add one ${r.Name}`}
                              onClick={(e) => { e.stopPropagation(); inc(r.Number); }} 
                              disabled={r.Have >= r.Max}
                              title={r.Have >= r.Max ? 'Complete' : 'Add one'}
                            >
                              +
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            // Simple muted message matching the Inventory tab's empty look
            <div className="muted" style={{ marginTop: 20 }}>
              {hasIncompleteUnderCardFilters ?
                'No missing cards match current filters.' :
                'Nothing missing — nice!'
              }
            </div>
          )
        )}
      </div>

      {/* NEW: Reset Confirmation Modal JSX */}
      {showResetModal && (
          <div 
              style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} 
              onClick={() => setShowResetModal(false)}
          >
              <div 
                  style={{ backgroundColor: '#2b2d3d', padding: 30, borderRadius: 12, maxWidth: 450, width: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', color: '#e5e7eb' }} 
                  onClick={(e) => e.stopPropagation()}
              >
                  <h2 style={{ marginTop: 0, color: '#e5e7eb' }}>Confirm Inventory Reset</h2>
                  <p style={{ opacity: 0.8, marginBottom: 10 }}>
                      Please choose the scope of the inventory data you wish to clear.
                  </p>
                  <div style={{
                      color: '#ef4444',
                      fontWeight: 400,
                      padding: '8px 16px',
                      marginBottom: 20,
                      border: '2px solid #ef4444',
                      borderRadius: 8,
                      textAlign: 'center',
                      backgroundColor: 'rgba(239, 68, 68, 0.23)',
                  }}>
                      WARNING: This cannot be undone. Use the 'Save' button to download a JSON backup first if you want to keep a copy.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                    <button
                        className="modal-btn"
                        onClick={() => handleResetInventory('current')}
                        style={{
                            padding: '12px 24px', 
                            borderRadius: 8, 
                            backgroundColor: '#63252a', 
                            color: '#fff', 
                            border: 'none', 
                            cursor: 'pointer', 
                            fontWeight: 600, 
                            fontSize: '1em',
                            display: 'flex', 
                            justifyContent: 'center', 
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        <span>Clear Current Set:</span>
                        <span
                            style={{
                                fontSize: '14px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                border: '1px solid #ffffff', 
                                color: '#ffffff', 
                                backgroundColor: '#0b0b0ba4',
                                flexShrink: 0,
                            }}
                        >
                            {setKey}
                        </span>
                    </button>
                    <button
                        className="modal-btn"
                        style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: '#8a1d29', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '1em' }}
                        onClick={() => handleResetInventory('all')}
                    >
                        Clear ALL Set Data
                    </button>
                </div>
              </div>
          </div>
      )}

      {/* NEW: Import Modal JSX */}
      {showImportModal && (
          <div 
              style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} 
              onClick={() => setShowImportModal(false)}
          >
              <div 
                  style={{ backgroundColor: '#2b2d3d', padding: 30, borderRadius: 12, maxWidth: 600, width: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', color: '#e5e7eb' }} 
                  onClick={(e) => e.stopPropagation()}
              >
                  <h2 style={{ marginTop: 0, color: '#e5e7eb' }}>Import Options</h2>
                  <p style={{ opacity: 0.8, marginBottom: 20 }}>
                      You are importing data from <strong>{importingFileName}</strong>, which contains entries for {Object.keys(importData).length} set(s).
                  </p>
                  <p className="muted" style={{ marginTop: -12, marginBottom: 16 }}>
                    {plural(importStats.recognized, 'recognized entry')} · {plural(importStats.skipped, 'skipped entry')}
                  </p>
                  {/* Overview of what will be imported per set */}
                  {importOverview.length > 0 ? (
                    <div style={{ 
                      background: '#1f2333', border: '1px solid #424452', borderRadius: 8,
                      padding: '10px 12px', marginBottom: 16, fontSize: 14 
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Overview</div>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                        {importOverview.map(({ set, counts }) => {
                          const parts: string[] = [];
                          if (counts.Leader)  parts.push(plural(counts.Leader, 'Leader'));
                          if (counts.Base)    parts.push(plural(counts.Base, 'Base'));
                          if (counts.Unit)    parts.push(plural(counts.Unit, 'Unit'));
                          if (counts.Event)   parts.push(plural(counts.Event, 'Event'));
                          if (counts.Upgrade) parts.push(plural(counts.Upgrade, 'Upgrade'));
                          if (counts.Other)   parts.push(plural(counts.Other, 'Other'));
                          return (
                            <li key={set}>
                              <strong>{set}:</strong> {parts.join(', ')}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <div className="muted" style={{ marginBottom: 16 }}>
                      No recognizable card entries found in this import.
                    </div>
                  )}
                  <p style={{ fontWeight: 700, marginBottom: 15 }}>
                      How would you like to process this imported data?
                  </p>
                  <div style={{
                      color: '#ef4444',
                      fontWeight: 400,
                      padding: '8px 16px',
                      marginBottom: 15,
                      border: '2px solid #ef4444',
                      borderRadius: 8,
                      textAlign: 'center',
                      backgroundColor: 'rgba(239, 68, 68, 0.23)',
                  }}>
                      WARNING: Replace deletes all existing inventory data and cannot be undone.
                  </div>
                  <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
                      <button
                          className="modal-btn"
                          style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: '#185434', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => applyImport('merge')}
                      >
                          Merge into Current Data (Add counts)
                      </button>
                      <button
                          className="modal-btn"
                          style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: '#63252a', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => applyImport('replace')}
                      >
                          Replace Current Data
                      </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                      <button 
                          onClick={() => setShowImportModal(false)} 
                          style={{ padding: '8px 16px', borderRadius: 6, backgroundColor: '#424452', color: '#e5e7eb', border: 'none', cursor: 'pointer' }}
                      >
                          Cancel
                      </button>
                  </div>
              </div>
          </div>
      )}
      
      {/* Bulk Actions Modal JSX */}
      {showBulkActionsModal && (
        <div 
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', 
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
          }}
          onClick={() => setShowBulkActionsModal(false)}
        >
          <div 
            style={{ 
              backgroundColor: '#2b2d3d', padding: 30, borderRadius: 12, 
              maxWidth: 600, width: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', 
              color: '#e5e7eb',
            }}
            onClick={(e) => e.stopPropagation()} // Prevent click from closing modal
          >
            <h2 style={{ marginTop: 0, color: '#e5e7eb' }}>Bulk Inventory Actions</h2>
            <p style={{ opacity: 0.8, marginBottom: 10 }}>
              Apply actions to all cards or filter by rarity. Action applies to <strong>Base Cards</strong>.
            </p>
            
            {/* NEW: DESTRUCTIVE ACTION WARNING */}
            <div style={{ 
              color: '#ef4444', // Aggression Red
              fontWeight: 400,
              padding: '8px 16px',
              marginBottom: 10,
              border: '2px solid #ef4444',
              borderRadius: 8,
              textAlign: 'center',
              backgroundColor: 'rgba(239, 68, 68, 0.23)'
            }}>
              WARNING: These actions are destructive. Please use the 'Save' button to download a JSON backup before proceeding.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>Target</div>
              <div style={{ fontWeight: 700 }}>Add 1 / Add Max</div>
              <div style={{ fontWeight: 700 }}>Remove 1</div>
              <div style={{ fontWeight: 700 }}>Remove All</div>

              {/* ROW: All Cards */}
              <div style={{ fontWeight: 600 }}>All Cards</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="modal-btn" style={{ backgroundColor: '#185434' }} onClick={() => performBulkAction('add', 'all')}>+1</button>
                <button className="modal-btn" style={{ backgroundColor: '#185434' }} onClick={() => performBulkAction('add_max', 'all')}>Max</button>
              </div>
              <button className="modal-btn" style={{ backgroundColor: '#63252a' }} onClick={() => performBulkAction('remove', 'all')}>-1</button>
              <button className="modal-btn" style={{ backgroundColor: '#424452' }} onClick={() => performBulkAction('remove_all', 'all')}>Clear</button>

              <div style={{ gridColumn: '1 / span 4', height: 1, backgroundColor: '#424452', margin: '10px 0' }} />

              {/* Rarity Rows */}
              {['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'].map(rarity => (
                <React.Fragment key={rarity}>
                  <div style={{ fontWeight: 600 }}>{rarity}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="modal-btn" style={{ backgroundColor: '#185434' }} onClick={() => performBulkAction('add', rarity)}>{`+1`}</button>
                    <button className="modal-btn" style={{ backgroundColor: '#185434' }} onClick={() => performBulkAction('add_max', rarity)}>{`Max`}</button>
                  </div>
                  <button className="modal-btn" style={{ backgroundColor: '#63252a' }} onClick={() => performBulkAction('remove', rarity)}>{`-1`}</button>
                  <button className="modal-btn" style={{ backgroundColor: '#424452' }} onClick={() => performBulkAction('remove_all', rarity)}>{`Clear`}</button>
                </React.Fragment>
              ))}

              <div style={{ gridColumn: '1 / span 4', height: 1, backgroundColor: '#424452', margin: '10px 0' }} />

              <div style={{ gridColumn: '1 / span 4', fontWeight: 700, marginTop: 10 }}>Card Types</div>
              
              {/* Card Type Rows (Leader, Base, Unit, Event, Upgrade) */}
              {['Leader', 'Base', 'Unit', 'Event', 'Upgrade'].map(type => (
                <React.Fragment key={type}>
                  <div style={{ fontWeight: 600 }}>{type}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="modal-btn" style={{ backgroundColor: '#185434' }} onClick={() => performBulkAction('add', type)}>{`+1`}</button>
                    <button className="modal-btn" style={{ backgroundColor: '#185434' }} onClick={() => performBulkAction('add_max', type)}>{`Max`}</button>
                  </div>
                  <button className="modal-btn" style={{ backgroundColor: '#63252a' }} onClick={() => performBulkAction('remove', type)}>{`-1`}</button>
                  <button className="modal-btn" style={{ backgroundColor: '#424452' }} onClick={() => performBulkAction('remove_all', type)}>{`Clear`}</button>
                </React.Fragment>
              ))}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                <button 
                    onClick={() => setShowBulkActionsModal(false)}
                    style={{ 
                        padding: '8px 16px', borderRadius: 6, 
                        backgroundColor: '#424452', color: '#e5e7eb', border: 'none', cursor: 'pointer' 
                    }}
                >
                    Close
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications (replaces window.alert) */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxWidth: 360,
          }}
        >
          {toasts.map(t => (
            <div
              key={t.id}
              role="status"
              onClick={() => dismissToast(t.id)}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                color: '#eaeaf0',
                boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                border: '1px solid',
                borderColor:
                  t.kind === 'error' ? '#4a1f1f' : t.kind === 'warning' ? '#4a3a00' : '#1f3d33',
                backgroundColor:
                  t.kind === 'error' ? '#3a0a0a' : t.kind === 'warning' ? '#3a3000' : '#093c2d',
              }}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
      <SettingsModal
        open={showSettingsModal}
        settings={settings}
        onChange={changeSettings}
        onClose={closeSettingsModal}
        returnFocusRef={settingsButtonRef}
      />
    </div>
  );
}

export function Binder({
  viewSpread,
  setViewSpread,
  totalSpreads,
  totalPages,
  viewMode,
  focusedPage,
  onFocusedPageChange,
  onViewModeChange,
  onActivateCard,
  active,
  presentNumbers,
  numToAspectSpec,
  byNumber,
  inventory,
  inc,
  dec,
  setKey,
  showHelpModal,
  setShowHelpModal,
}: {
  viewSpread: number;
  setViewSpread: React.Dispatch<React.SetStateAction<number>>;
  totalSpreads: number;
  totalPages: number;
  viewMode: BinderViewMode;
  focusedPage: number;
  onFocusedPageChange: (page: number) => void;
  onViewModeChange: (mode: BinderViewMode) => void;
  onActivateCard: (card: Card) => void;
  active: ActiveSelection | null;
  presentNumbers: Set<number>;
  numToAspectSpec: Map<number, AspectFillSpec>;
  byNumber: Map<number, Card>;
  inventory: Inventory;
  inc: (n:number)=>void;
  dec: (n:number)=>void;
  setKey: SetKey;
  showHelpModal: boolean;
  setShowHelpModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const singlePage = viewMode === 'single';
  const page = spreadToPrimaryPage(viewSpread);     // 1, 2, 4, 6, ...
  const leftPage = page % 2 === 0 ? page : page - 1;
  const rightPage = page % 2 === 1 ? page : page + 1;
  const showLeft = leftPage >= 2;

  const cols = singlePage ? 4 : 8, rows = 3;
  const cellW = 120, cellH = 170, gap = 12;
  const vbPad = 8;
  const vbW = cols * cellW + (cols - 1) * gap + vbPad * 2;
  const vbH = rows * cellH + (rows - 1) * gap + vbPad * 2;
  const gridBottom = (rows - 1) * (cellH + gap) + cellH;

  const spreadLabel = page === 1
    ? 'Spread: Page 1'
    : `Spread: Page ${leftPage} (left) | Page ${rightPage} (right)`;
  const binderLabel = singlePage ? `Page ${focusedPage}` : spreadLabel;

  const isActive = (p:number, r:number, c:number) =>
    active && p === active.page && r === active.row && c === active.column;

  // spread dropdown labels: Page 1, Page 2/3, Page 4/5, ...
  const spreadOptions = useMemo(() => {
    return Array.from({ length: totalSpreads }, (_, i) => {
      if (i === 0) return { value: 0, label: 'Page 1' };
      const left = 2 + (i - 1) * 2;
      const right = left + 1;
      return { value: i, label: `Page ${left}/${right}` };
    });
  }, [totalSpreads]);
  const pageOptions = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages],
  );

  const binderGradientDefs = useMemo(() => {
    const out: { n: number; spec: Extract<AspectFillSpec, { kind: 'gradient' }> }[] = [];
    for (const n of presentNumbers) {
      const spec = numToAspectSpec.get(n);
      if (spec?.kind === 'gradient') out.push({ n, spec });
    }
    return out;
  }, [presentNumbers, numToAspectSpec]);

  return (
    <>
      <div className="binder-toolbar">
        <div className="toolbar-group" role="group" aria-label="Binder view">
          <button
            type="button"
            className="tbtn"
            aria-pressed={singlePage}
            onClick={() => onViewModeChange('single')}
          >
            Single Page
          </button>
          <button
            type="button"
            className="tbtn"
            aria-pressed={!singlePage}
            onClick={() => onViewModeChange('spread')}
          >
            Spread
          </button>
        </div>
      </div>
      {/* Row 1: selection header + tip (right) */}
      <div
        className="row"
        style={{
          marginBottom: 6,
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* left: selected card (or placeholder) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {active ? (
            <>
              {(() => {
                const spec = numToAspectSpec.get(active.card.Number);
                const bg = aspectSpecToCssBackground(spec);
                return bg ? (
                  <span
                    style={{
                      width: 12, height: 12, borderRadius: 3, background: bg,
                      boxShadow: '0 0 0 2px #2b2d3d inset', display: 'inline-block'
                    }}
                  />
                ) : null;
              })()}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <div className="big" style={{ fontSize: 20 }}>{active.card.Name}</div>
                {active.card.Subtitle && (
                  <span className="muted" style={{ opacity: 0.7, fontSize: '1rem', fontWeight: 500, paddingBottom: 2 }}>
                    — {active.card.Subtitle}
                  </span>
                )}
              </div>
              <span className="pill">Page {active.page}</span>
              <span className="pill">Column {active.column}</span>
              <span className="pill">Row {active.row}</span>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 25 }}>No card selected</div>
          )}
        </div>

         {/* right: tip / Help Button */}
        <div style={{ whiteSpace: 'nowrap' }}>
          <button
            onClick={() => setShowHelpModal(true)}
            title="Show Keyboard Shortcuts"
            style={{
              padding: '6px 12px',
              borderRadius: '50%', // Circle shape
              backgroundColor: '#213c6a',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '1.2em',
              width: '32px',
              height: '32px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }}
          >
            ?
          </button>
        </div>
      </div>

      {/* Row 2: binder subtitle + pager */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
          gap: 12,
        }}
      >
        <div className="binder-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid #ffffff', 
              color: '#ffffff', 
              backgroundColor: '#0b0b0b',
              flexShrink: 0,
            }}
          >
            {setKey}
          </span>
          <span style={{ fontWeight: 600 }}>Binder</span> — {binderLabel}
        </div>
        <div className="pager">
          <label className="spread-jump-label">
            <span className="spread-jump-hint">Jump</span>
            {singlePage ? (
              <select
                className="spread-jump-select"
                value={focusedPage}
                onChange={event => onFocusedPageChange(Number(event.target.value))}
                aria-label="Jump to page"
              >
                {pageOptions.map(option => <option key={option} value={option}>Page {option}</option>)}
              </select>
            ) : (
              <select
                className="spread-jump-select"
                value={viewSpread}
                onChange={event => setViewSpread(Number(event.target.value))}
                aria-label="Jump to spread"
              >
                {spreadOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
          </label>
        </div>
      </div>

      <div className="spread-nav-row">
        <button
          type="button"
          className="spread-nav-edge"
          disabled={singlePage ? focusedPage <= 1 : totalSpreads === 0 || viewSpread <= 0}
          onClick={() => singlePage
            ? onFocusedPageChange(Math.max(1, focusedPage - 1))
            : setViewSpread(spread => Math.max(0, spread - 1))}
          aria-label={singlePage ? 'Previous page' : 'Previous spread, keyboard comma'}
          title={singlePage ? 'Previous page' : 'Previous spread — keyboard ,'}
        >
          <span className="spread-nav-chevron" aria-hidden>‹</span>
          {!singlePage && <span className="key-pill">,</span>}
        </button>
        <div className="grid-wrap">
        <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet">
          <defs>
            {binderGradientDefs.map(({ n, spec }) => (
              <linearGradient
                key={`binder-fill-${setKey}-${n}`}
                id={`binder-fill-${setKey}-${n}`}
                gradientUnits="objectBoundingBox"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor={spec.colors[0]} />
                <stop offset={`${DUAL_ASPECT_LEFT_STOP_PCT}%`} stopColor={spec.colors[0]} />
                <stop offset={`${DUAL_ASPECT_RIGHT_STOP_PCT}%`} stopColor={spec.colors[1]} />
                <stop offset="100%" stopColor={spec.colors[1]} />
              </linearGradient>
            ))}
          </defs>
          <g transform={`translate(${vbPad},${vbPad})`}>
            {Array.from({ length: rows }).map((_, rIdx) =>
              Array.from({ length: cols }).map((__, cIdx) => {
                const r = rIdx + 1;
                const c = cIdx + 1;
                const x = cIdx * (cellW + gap);
                const y = rIdx * (cellH + gap);

                const isLeftHalf = !singlePage && c <= 4;
                const pForCell = singlePage ? focusedPage : isLeftHalf ? leftPage : rightPage;
                const colOnPage = singlePage ? c : isLeftHalf ? c : c - 4;
                const hidden = !singlePage && isLeftHalf && !showLeft;

                const n = numberFromPagePosition(pForCell, r, colOnPage);
                const cardAt = byNumber.get(n);

                let fill = '#0f1017';
                let opacity = hidden ? 0.25 : 0.9;
                let stroke = '#2b2d3d';
                let strokeWidth = 2;

                if (!hidden && presentNumbers.has(n)) {
                  const spec = numToAspectSpec.get(n);
                  if (spec?.kind === 'gradient') {
                    fill = `url(#binder-fill-${setKey}-${n})`;
                  } else if (spec?.kind === 'solid') {
                    fill = spec.color;
                  } else {
                    fill = NEUTRAL;
                  }
                  const activeHere = isActive(pForCell, r, colOnPage);
                  opacity = activeHere ? 1.0 : 0.35;
                  stroke = activeHere ? '#ffffff' : '#2b2d3d';
                  strokeWidth = activeHere ? 4 : 2;
                }

                return (
                  <g
                    key={`${r}-${c}`}
                    className="cell"
                    onClick={() => {
                      if (hidden || !presentNumbers.has(n)) return;

                      const card = byNumber.get(n);      // exact card in this set
                      if (!card) return;

                      onActivateCard(card);
                    }}
                  >
                    {/* the card rectangle */}
                    <rect
                      x={x} y={y} width={cellW} height={cellH} rx="16"
                      fill={fill} opacity={opacity}
                      stroke={stroke} strokeWidth={strokeWidth}
                    />

                  {(() => {
                    if (hidden || !presentNumbers.has(n)) return null;

                    const aspectHexes = normalizedPrimaryAspectHexes(cardAt?.Aspects);
                    const labelColor = labelColorForAspectHexes(aspectHexes);

                    // data for this slot
                    const qty = inventory[n] || 0;
                    const max = quotaForType(cardAt?.Type);
                    const qtyText = `${qty}/${max}`;

                    // rarity + outline (will render bottom-right)
                    const sty = cardAt?.Rarity ? rarityGlyph(cardAt.Rarity) : null;
                    const rarityOutline = rarityOutlineForAspectHexes(aspectHexes);

                    return (
                      <>
                        {/* TOP-LEFT: Type then Name/Subtitle */}
                        <g transform={`translate(${x + 10}, ${y + 8})`} style={{ pointerEvents: 'none' }}>
                          <foreignObject width={cellW - 20} height={60}>
                            <div
                                style={{
                                  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
                                  color: labelColor,
                                  lineHeight: 1.18,
                                  display: 'flex', flexDirection: 'column', gap: 2,
                                }}>
                              <div style={{ fontSize: 10, opacity: 0.85 }}>{cardAt?.Type || ''}</div>
                              
                              {/* Main Name */}
                              <div style={{
                                fontSize: 12, fontWeight: 600,
                              }}>
                                {cardAt?.Name}
                              </div>
                              
                              {/* Subtitle with smaller font */}
                              {cardAt?.Subtitle && (
                                <div style={{
                                  fontSize: 10, // Smaller font size
                                  opacity: 0.8,
                                  fontWeight: 500,
                                  lineHeight: 1,
                                  marginTop: 1,
                                }}>
                                  {cardAt.Subtitle}
                                </div>
                              )}
                            </div>
                          </foreignObject>
                        </g>

                        {/* CENTER: big quantity, centered */}
                        <text
                          x={x + cellW / 2}
                          y={y + cellH / 2 + QTY_SHIFT_DOWN - QTY_Y_OFFSET}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={QTY_FONT}
                          fontWeight={700}
                          fill={labelColor}
                          style={{ pointerEvents: 'none' }}
                        >
                          {qtyText}
                        </text>

                        {/* CENTER-BOTTOM: +/- controls under qty (clicks don't bubble) */}
                        <g
                          transform={`translate(${x + (cellW - GROUP_W) / 2}, ${y + cellH / 2 + QTY_SHIFT_DOWN + 10})`}
                          onClick={(e)=>e.stopPropagation()}
                        >
                          <foreignObject width={GROUP_W} height={GROUP_H + 4}>
                            <div className="qtybtns circle">
                              <button className="minus" aria-label="Decrease" onClick={()=>dec(n)}>−</button>
                              <button className="plus" aria-label="Increase" onClick={()=>inc(n)}>+</button>
                            </div>
                          </foreignObject>
                        </g>

                        {/* BOTTOM-RIGHT: rarity + card number on one line */}
                        <text
                          x={x + cellW - 10}
                          y={y + cellH - 10}
                          textAnchor="end"
                          dominantBaseline="alphabetic"
                          fontSize="12"
                          style={{ pointerEvents: 'none' }}
                        >
                          {sty && (
                            <tspan
                              fontSize="14"
                              fontWeight={800}
                              fill={sty.color}
                              stroke={rarityOutline}
                              strokeWidth={2}
                              paintOrder="stroke"
                            >
                              {sty.letter}
                            </tspan>
                          )}
                          <tspan dx={sty ? 6 : 0} fill={labelColor} fontWeight={600}>
                            #{n}
                          </tspan>
                        </text>
                      </>
                    );
                  })()}

                  </g>
                );
              })
            )}
            {!singlePage && (
              <line
                className="binder-divider"
                x1={(cellW + gap) * 4 - gap / 2}
                y1={-8}
                x2={(cellW + gap) * 4 - gap / 2}
                y2={gridBottom + 8}
                stroke="#424452ff"
                strokeOpacity={0.75}
                strokeWidth={4}
                strokeDasharray="0 12"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        </svg>
        {/* NEW: Help Modal JSX */}
      {showHelpModal && (
        <div 
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', 
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
          }}
          onClick={() => setShowHelpModal(false)}
        >
          <div 
            style={{ 
              backgroundColor: '#2b2d3d', padding: 30, borderRadius: 12, 
              maxWidth: 500, width: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' 
            }}
            onClick={(e) => e.stopPropagation()} // Prevent click from closing modal
          >
            <h2 style={{ marginTop: 0, color: '#e5e7eb' }}>Keyboard Controls</h2>
            <p style={{ color: '#e5e7eb', marginBottom: 20 }}>
              The binder view is optimized for keyboard navigation.
            </p>
            <table style={{ width: '100%', color: '#e5e7eb', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid #424452' }}>Action</th>
                        <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid #424452' }}>Key(s)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style={{ borderBottom: '1px dotted #424452' }}>
                        <td style={{ padding: '8px 0' }}>Deselect Card / Close Popups</td>
                        <td style={{ padding: '8px 0' }}><span className="key-pill">Esc</span></td>
                    </tr>
                    <tr style={{ borderBottom: '1px dotted #424452' }}>
                        <td style={{ padding: '8px 0' }}>Focus Search Bar</td>
                        <td style={{ padding: '8px 0' }}><span className="key-pill">/</span></td>
                    </tr>
                    <tr style={{ borderBottom: '1px dotted #424452' }}>
                        <td style={{ padding: '8px 0' }}>Flip Page Left/Right</td>
                        <td style={{ padding: '8px 0' }}>
                          <span className="key-pill">,</span> / <span className="key-pill">.</span>
                        </td>
                    </tr>
                    <tr style={{ borderBottom: '1px dotted #424452' }}>
                        <td style={{ padding: '8px 0' }}>Move Selection (Literal)</td>
                        <td style={{ padding: '8px 0' }}>
                          <span className="key-pill">↑</span><span className="key-pill">↓</span><span className="key-pill">←</span><span className="key-pill">→</span>
                        </td>
                    </tr>
                    <tr style={{ borderBottom: '1px dotted #424452' }}>
                        <td style={{ padding: '8px 0' }}>Increase/Decrease Quantity</td>
                        <td style={{ padding: '8px 0' }}><span className="key-pill">+</span> / <span className="key-pill">&minus;</span></td>
                    </tr>
                </tbody>
            </table>
            <button 
                onClick={() => setShowHelpModal(false)}
                style={{ 
                    marginTop: 20, padding: '8px 16px', borderRadius: 6, 
                    backgroundColor: '#213c6a', color: 'white', border: 'none', cursor: 'pointer' 
                }}
            >
                Close
            </button>
          </div>
        </div>
      )}
      </div>
        <button
          type="button"
          className="spread-nav-edge"
          disabled={singlePage ? focusedPage >= totalPages : totalSpreads === 0 || viewSpread >= totalSpreads - 1}
          onClick={() => singlePage
            ? onFocusedPageChange(Math.min(totalPages, focusedPage + 1))
            : setViewSpread(spread => Math.min(totalSpreads - 1, spread + 1))}
          aria-label={singlePage ? 'Next page' : 'Next spread, keyboard period'}
          title={singlePage ? 'Next page' : 'Next spread — keyboard .'}
        >
          <span className="spread-nav-chevron" aria-hidden>›</span>
          {!singlePage && <span className="key-pill">.</span>}
        </button>
      </div>
    </>
  );
}
