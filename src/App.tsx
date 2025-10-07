import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';

type Card = {
  Name: string;
  Subtitle?: string;
  Number: number;
  Aspects?: string[];
  Type?: string;
  Rarity?: string;
  MarketPrice?: number;
  Set: string
};
type Inventory = Record<number, number>;
type SetKey = string;
type SetMeta = { key: string; label: string; file: string };

const ASPECT_HEX: Record<string, string> = {
  Vigilance: '#3b82f6', // blue
  Command:   '#22c55e', // green
  Aggression:'#ef4444', // red
  Cunning:   '#f59e0b', // yellow
  Heroism:   '#e5e7eb', // white
  Villainy:  '#0b0b0b', // black
};
const NEUTRAL = '#2f3545'; // for numbers that exist but have no aspect

const NAME_MAX_LINES = 2;
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

function rarityGlyph(r?: string) {
  if (!r) return null;
  return RARITY_STYLE[r] ?? null;
}

function binderLayout(n: number) {
  const page = Math.floor((n - 1) / 12) + 1;
  const row = Math.floor(((n - 1) % 12) / 4) + 1;
  const column = ((n - 1) % 4) + 1;
  return { page, row, column };
}
function getSpreadCoords(page: number, row: number, column: number) {
  const isOddPage = page % 2 !== 0;
  return {
    spreadCol: isOddPage ? column + 4 : column,
    spreadRow: row,
  };
}
function numberFromPRC(page: number, row: number, col: number) {
  return (page - 1) * 12 + (row - 1) * 4 + col;
}
function quotaForType(type?: string) {
  const t = (type || '').toLowerCase();
  return (t === 'leader' || t === 'base') ? 1 : 3;
}

// Spread math ---------------------------------------------------------------
// spread 0 -> Page 1 (right-only)
// spread 1 -> Pages 2/3, spread 2 -> 4/5, ...
function pageToSpread(p: number) { return p <= 1 ? 0 : Math.floor((p - 2) / 2) + 1; }
function spreadToPrimaryPage(s: number) { return s <= 0 ? 1 : 2 + (s - 1) * 2; } // even page

type Filters = {
  aspect: string[];
  rarity: string[];
  type: string[];
};

type FilterControlsProps = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
};

// --- FilterControls Component Definition (Used outside App function) ---
function FilterControls({ filters, setFilters }: FilterControlsProps) {
  const handleFilterChange = (category: keyof Filters, value: string) => {
    setFilters(prev => {
      const currentFilters = prev[category];
      const newFilters = currentFilters.includes(value)
        ? currentFilters.filter(item => item !== value)
        : [...currentFilters, value];

      return { ...prev, [category]: newFilters };
    });
  };

  const handleClearFilters = () => {
    setFilters({ aspect: [], rarity: [], type: [] });
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


  const renderFilterGroup = (category: keyof Filters, items: readonly string[]) => (
  <div className="toolbar-group" role="group" style={{ marginRight: 12 }}>
    {items.map(item => {
      const isActive = filters[category].includes(item);
      const label = item.replace('NEUTRAL', 'Neutral');

      // Determine highlight color from your maps
      let highlightColor = '#213c6a';
      if (category === 'aspect') {
        highlightColor = ASPECT_HEX[item as keyof typeof ASPECT_HEX] || highlightColor;
      } else if (category === 'rarity') {
        const rarityStyle = RARITY_STYLE[item as keyof typeof RARITY_STYLE];
        // If your map stores { color } or { backgroundColor }, support both:
        highlightColor = (rarityStyle?.color || (rarityStyle as any)?.backgroundColor) || highlightColor;
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

  return (
    <div className="card" style={{ padding: '12px 16px', marginTop: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 600, margin: '0 0 10px', color: '#c8ccd9' }}>
        Card Filters
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
        {renderFilterGroup('aspect', ALL_ASPECTS)}
        {renderFilterGroup('rarity', ALL_RARITIES)}
        {renderFilterGroup('type', ALL_TYPES)}
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

type CardUtilities = {
    quotaForType: (type?: string) => number;
    fullCardIndex: Map<string, { baseNumber: number, type?: string, name: string }>;
};

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

async function parseXlsxData(file: File, cardUtilities: CardUtilities): Promise<Record<SetKey, Inventory>> {
  const { quotaForType, fullCardIndex } = cardUtilities;
  const aggregatedData: Record<SetKey, Inventory> = {};

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('XLSX has no sheets.');

  // Read as rows with header row
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  if (!rows.length) return aggregatedData;

  // Normalize header names once
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '');
  const headerSet = new Set(Object.keys(rows[0]).map(norm));

  // Required columns
  if (!(headerSet.has('set') && (headerSet.has('basecardid') || headerSet.has('basecardid')) && headerSet.has('normal'))) {
    throw new Error('Invalid XLSX format (need Set, Base card id, Normal).');
  }

  // Construct column name resolvers (case/space tolerant)
  const col = (wanted: string, obj: Record<string, any>) => {
    const k = Object.keys(obj).find(h => norm(h) === norm(wanted));
    return k ?? wanted; // fall back, but usually found
  };

  for (const r of rows) {
    const setKey = String(r[col('Set', r)] ?? '').trim().toUpperCase() as SetKey;
    const baseIdNum = Number(r[col('Base card id', r)]);
    if (!setKey || !Number.isFinite(baseIdNum) || baseIdNum <= 0) continue;

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
    if (totalCount <= 0) continue;

    // Lookup index uses <SET>:<non-padded-number>
    const normalizedKey = `${setKey}:${String(baseIdNum)}`;
    const cardInfo = fullCardIndex.get(normalizedKey);
    if (!cardInfo) continue;

    const { baseNumber, type } = cardInfo;
    const max = quotaForType(type);

    if (!aggregatedData[setKey]) aggregatedData[setKey] = {};
    const current = aggregatedData[setKey][baseNumber] ?? 0;
    aggregatedData[setKey][baseNumber] = Math.min(current + totalCount, max);
  }

  return aggregatedData;
}

function detectImportFormat(headers: string[]): "swudb" | "swunlimiteddb" | "unknown" {
  const lower = headers.map(h => h.trim().toLowerCase());
  const has = (name: string) => lower.includes(name);

  // swudb CSV: Set, CardNumber, Count
  if (has("set") && has("cardnumber") && has("count")) {
    return "swudb";
  }

  // sw-unlimited: Set, Base card id, Normal (plus the alt-art columns)
  if (has("set") && (has("base card id") || has("basecardid")) && has("normal")) {
    return "swunlimiteddb";
  }

  return "unknown";
}

function parseCsvData(
  fileName: string, // kept for signature compatibility; not used for detection
  fileContent: string,
  cardUtilities: CardUtilities
): Record<SetKey, Inventory> {
  const { quotaForType, fullCardIndex } = cardUtilities;
  const aggregatedData: Record<SetKey, Inventory> = {};

  // Parse CSV into headers + rows (rows are string[]; access via indices)
  const { headers, rows } = parseCsvContent(fileContent);

  // -------- Header-based format detection (no filename reliance) --------
  type ImportFormat = "swudb" | "swunlimiteddb" | "unknown";

  // Normalize header for robust matching (lowercase + strip spaces/underscores)
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");
  const headersNorm = headers.map(norm);

  const has = (name: string) => headersNorm.includes(norm(name));
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
      if (!setKey || !Number.isFinite(baseIdNum) || baseIdNum <= 0) continue;

      let totalCount = 0;
      for (let i = normalCol; i < row.length; i++) {
        const v = Number(row[i]);
        if (Number.isFinite(v)) totalCount += v;
      }
      if (totalCount <= 0) continue;

      // Lookup uses normalized "<SET>:<number>" where number is non-padded
      const normalizedKey = `${setKey}:${String(baseIdNum)}`;
      const cardInfo = fullCardIndex.get(normalizedKey);
      if (!cardInfo) continue;

      const { baseNumber, type } = cardInfo;
      const max = quotaForType(type);

      if (!aggregatedData[setKey]) aggregatedData[setKey] = {};
      const current = aggregatedData[setKey][baseNumber] ?? 0;
      aggregatedData[setKey][baseNumber] = Math.min(current + totalCount, max);
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
      const count = Number(row[countCol]) || 0;
      if (!setKey || cardNumRaw === "" || count <= 0) continue;

      // Strip leading zeros so keys match your index (e.g., "079" -> "79")
      const numericId = Number(cardNumRaw);
      if (!Number.isFinite(numericId) || numericId <= 0) continue;

      const normalizedKey = `${setKey}:${String(numericId)}`;
      const cardInfo = fullCardIndex.get(normalizedKey);
      if (!cardInfo) continue;

      const { baseNumber, type } = cardInfo;
      const max = quotaForType(type);

      if (!aggregatedData[setKey]) aggregatedData[setKey] = {};
      const current = aggregatedData[setKey][baseNumber] ?? 0;
      aggregatedData[setKey][baseNumber] = Math.min(current + count, max);
    }

  } else {
    // Fallback: try your existing JSON format
    try {
      const raw = JSON.parse(fileContent);
      if (raw?.version === 1 && raw?.sets) {
        const jsonSets = raw.sets as Record<SetKey, Record<string, number>>;
        for (const k of Object.keys(jsonSets) as SetKey[]) {
          if (!aggregatedData[k]) aggregatedData[k] = {};
          for (const [numStr, count] of Object.entries(jsonSets[k])) {
            const baseNumber = Number(numStr);
            if (!Number.isFinite(baseNumber)) continue;

            const card = fullCardIndex.get(`${k}:${numStr}`);
            const max = card ? quotaForType(card.type) : 3;
            aggregatedData[k][baseNumber] = Math.min(Number(count) || 0, max);
          }
        }
        return aggregatedData;
      }
    } catch {
      // not JSON; fall through
    }

    throw new Error("File format not recognized. Expected a SWUDB or SW-Unlimited CSV (or a valid app JSON export).");
  }

  return aggregatedData;
}

export default function App() {
  const [sets, setSets] = useState<SetMeta[]>([]);
  const [setKey, setSetKey] = useState<SetKey>('LOF'); // default/fallback
  const searchRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<Record<SetKey, Inventory>>({});
  const [importingFileName, setImportingFileName] = useState('');
  const [showResetModal, setShowResetModal] = useState(false); 
  const [listView, setListView] = React.useState<'inventory' | 'missing'>('inventory');
  


  // cache parsed data for sets (so we don't refetch repeatedly)
  type ParsedSet = {
    key: SetKey;
    allCards: Card[];                // All cards (unique by Number)
    baseCards: Card[];               // Base cards (unique by Name+Subtitle+Type)
    byNumber: Map<number, Card>;     // Map<BaseNumber, BaseCard>
    baseToAll: Map<number, number[]>;
    altToBase: Map<number, number>;
  };
  const parsedCacheRef = useRef<Map<string, ParsedSet>>(new Map());

  useEffect(() => {
    fetch('/sets/manifest.json')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('no manifest')))
      .then((m: { sets: SetMeta[] }) => {
        const list = Array.isArray(m?.sets) ? m.sets : [];
        setSets(list);
        if (!list.find(s => s.key === setKey)) setSetKey(list[0]?.key ?? 'LOF');
      })
      .catch(() => {
        // fallback (optional) if manifest missing in dev
        setSets([
          { key:'SOR', label:'Spark of Rebellion (SOR)', file:'SWU-SOR.json' },
          { key:'SHD', label:'Shadows of the Galaxy (SHD)', file:'SWU-SHD.json' },
          { key:'TWI', label:'Twilight of the Republic (TWI)', file:'SWU-TWI.json' },
          { key:'JTL', label:'Jump to Lightspeed (JTL)', file:'SWU-JTL.json' },
          { key:'LOF', label:'Legacy of the Force (LOF)', file:'SWU-LOF.json' },
        ]);
        if (setKey !== 'LOF') setSetKey('LOF');
      });
  }, []);

  // Data variants
  const [cardsAll, setCardsAll] = useState<Card[]>([]);     // unique by Number (used to color pages)
  const [cardsBase, setCardsBase] = useState<Card[]>([]);   // base printing per Name (lowest Number)
  // alt maps for search: baseNumber -> all numbers (base first), altNumber -> baseNumber
  const [baseToAll, setBaseToAll] = useState<Map<number, number[]>>(new Map());
  const [altToBase, setAltToBase] = useState<Map<number, number>>(new Map());

  // Normalization function for search
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Rarity normalization
  function normalizeRarity(r: any): string | undefined {
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

  //Type normalization
  function normalizeType(t: any): string | undefined {
    if (!t) return undefined;
    if (typeof t === 'string') return t.trim();
    if (typeof t?.Name === 'string') return t.Name.trim();
    return undefined;
  }

  // stable key for dedupe/show
  function keyNameType(c: {Name: string; Subtitle?: string; Type?: string}) {
    const sub = (c.Subtitle || '').trim().toLowerCase();
    return `${c.Name.trim().toLowerCase()}|${sub}|${(c.Type||'').trim().toLowerCase()}`;
  }

  // 2) collapse alt-arts: keep the LOWEST Number per (Name + Type)
  function baseOnly(cards: Card[]): Card[] {
    const byKey = new Map<string, Card>();
    for (const c of cards) {
      const k = keyNameType(c);
      const prev = byKey.get(k);
      if (!prev || c.Number < prev.Number) byKey.set(k, c);
    }
    return Array.from(byKey.values()).sort((a,b)=>a.Number - b.Number);
  }

  // 3) Build alt maps for search display and number→base resolution
  function buildAltMaps(allCards: Card[]) {
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
    const nameTypeToBase = new Map<string, number>();

    for (const [k, nums] of ntToNums) {
      const base = nums[0];
      baseToAll.set(base, nums);
      nameTypeToBase.set(k, base);
      for (const n of nums) {
        if (n !== base) altToBase.set(n, base);
      }
    }
    return { baseToAll, altToBase, nameTypeToBase };
  }

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
  const baseByName = useMemo(() => new Map(cardsBase.map(c => [c.Name, c])), [cardsBase]);

  // Inventory
  const [inventory, setInventory] = useState<Inventory>({});
  useEffect(() => {
    const raw = localStorage.getItem(`inv:${setKey}`);
    try { setInventory(raw ? JSON.parse(raw) : {}); } catch { setInventory({}); }
  }, [setKey]);
  useEffect(() => {
    localStorage.setItem(`inv:${setKey}`, JSON.stringify(inventory));
  }, [inventory, setKey]);
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
  const [active, setActive] = useState<{ 
    card: Card; 
    page: number; 
    row: number; 
    column: number; 
    spreadCol: number; 
    spreadRow: number; 
  } | null>(null);

  // NEW: State to hold card details for selection after a set switch
  const [pendingSelection, setPendingSelection] = useState<{ name: string; number: number } | null>(null);

  const [showHelpModal, setShowHelpModal] = useState(false); 

  const [highlightedRowNumber, setHighlightedRowNumber] = useState<number | null>(null); 

  const [showBulkActionsModal, setShowBulkActionsModal] = useState(false); 
  
  // Global Filter State
  const [filters, setFilters] = useState({
    aspect: [] as string[],
    rarity: [] as string[],
    type: [] as string[], 
  });

  // Spreads (instead of pages)
  const maxNumber = useMemo(() => cardsBase.reduce((m,c)=>Math.max(m,c.Number), 0), [cardsBase]);
  const totalPages = Math.max(1, Math.ceil(maxNumber / 12));
  const totalSpreads = 1 + Math.ceil(Math.max(0, totalPages - 1) / 2);
  const [viewSpread, setViewSpread] = useState<number>(0); // 0 => Page 1; >=1 => 2/3, 4/5, ...

  const binderRef = useRef<HTMLDivElement>(null); 

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
      // Helper function defined inside useEffect to access local scope functions (like baseOnly)
      const parseAndCache = async (meta: SetMeta): Promise<ParsedSet> => {
        // Check cache first
        if (parsedCacheRef.current.has(meta.key)) {
            return parsedCacheRef.current.get(meta.key)!;
        }
        
        const url = meta.file.startsWith('/') ? meta.file : `/sets/${meta.file}`;
        const res = await fetch(url);
        const obj = await res.json();
        const data = Array.isArray(obj) ? obj : obj.data;

        const mapped: Card[] = data.map((c: any) => {
          const rawName = String(c.Name || '').trim();
          const rawSubtitle = String(c.Subtitle || '').trim();
          const cardName = rawName;
          
          return {
            Name: cardName,
            Subtitle: rawSubtitle || undefined,
            Number: Number(c.Number),
            Aspects: Array.isArray(c.Aspects) ? c.Aspects : [],
            Type:
              typeof c.Type === 'string'
                ? c.Type
                : (typeof c.Type?.Name === 'string' ? c.Type.Name : undefined),
            Rarity: normalizeRarity(c.Rarity ?? c.rarity ?? c.RarityCode ?? c.Rarity?.Name),
            MarketPrice: Number(c.MarketPrice ?? c.Price ?? 0), 
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

        // 3. Update the state for the current view
        setCardsAll(currentSetData.allCards);
        setCardsBase(currentSetData.baseCards);
        setBaseToAll(currentSetData.baseToAll);
        setAltToBase(currentSetData.altToBase);

        // REMOVED: Deferred navigation logic (moved to a new hook below)
      }
      load().catch(() => setError('Failed to load set data.'));
    // Dependencies only include set changes (NO pendingSelection)
    }, [setKey, sets]);

    // Deferred Navigation Hook: Runs after new set data is loaded
    useEffect(() => {
      // Only run if there is a pending card AND the current set data has loaded cards
      if (pendingSelection && cardsBase.length > 0) {
          // IMPORTANT: Clear any previous error before attempting the new lookup
          setError(''); 

          // Find the base card in the newly loaded set
          const card = cardsBase.find(c => 
              c.Number === pendingSelection.number && c.Name === pendingSelection.name
          );

          if (card) {
              const { page, row, column } = binderLayout(card.Number);
              const { spreadCol, spreadRow } = getSpreadCoords(page, row, column);
              setActive({ card, page, row, column, spreadCol, spreadRow });
              setViewSpread(pageToSpread(page));
              // Clear query so search bar looks clean after selection
              setQuery('');
          } else {
              // Only set an error if the card truly cannot be found in the loaded set
              setError(`Failed to find card #${pendingSelection.number} in set ${setKey}.`);
          }
          
          // Always clear the pending state after attempting selection
          setPendingSelection(null); 
      }
    }, [pendingSelection, cardsBase, setKey, binderLayout, pageToSpread, setActive, setViewSpread, setError, setPendingSelection, setQuery]);
  // Build coloring map + presence
  const presentNumbers = useMemo(() => new Set(cardsBase.map(c => c.Number)), [cardsBase]);
  const numToColor = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cardsBase) {
      const a = c.Aspects?.[0];
      if (a && ASPECT_HEX[a]) m.set(c.Number, ASPECT_HEX[a]);
    }
    return m;
  }, [cardsBase]);

  // Suggestions (name or number)
    type Suggestion = { 
      kind: 'name' | 'number'; 
      label: string; 
      number: number; 
      name: string; 
      setKey: SetKey;
      subtitle?: string;
      type?: string;
    };
    const suggestions: Suggestion[] = useMemo(() => {
      const raw = query.trim();
      if (!raw) return [];
      
      const isDigits = /^[0-9]+$/.test(raw);
      const qnorm = raw.replace(/^0+/, '') || '0';
      const lower = norm(raw);
      
      // 1. Collect all Number Matches (Exact Base Number Match OR Alt-Art Match)
      const qNum = Number(qnorm);
      // Change to track uniqueness by "SetKey:Number"
      const uniqueNumMatches = new Set<string>(); 
      const numberMatches: Suggestion[] = [];
      
      if (isDigits) {
          // Iterate over all sets to find exact Base Number or Alt-Art matches
          for (const [key, parsed] of parsedCacheRef.current.entries()) {
            
            let targetBaseNum = 0;

            // Check 1: Exact Base Number Match
            if (parsed.byNumber.has(qNum)) {
                targetBaseNum = qNum;
            } 
            // Check 2: Alt-Art Number Match
            else if (parsed.altToBase.has(qNum)) {
                targetBaseNum = parsed.altToBase.get(qNum)!;
            }

            if (targetBaseNum > 0) {
                const baseCard = parsed.byNumber.get(targetBaseNum)!; // Card must exist if the number was found
                const uniqueKey = `${key}:${baseCard.Number}`;
                
                // Ensure we haven't already added this base card from this set
                if (!uniqueNumMatches.has(uniqueKey)) {
                    uniqueNumMatches.add(uniqueKey);

                    const suggestion: Suggestion = {
                        kind: 'number' as const,
                        name: baseCard.Name,
                        number: baseCard.Number,
                        type: baseCard.Type || '',
                        setKey: key, 
                        subtitle: baseCard.Subtitle,
                        label: `${baseCard.Name}${baseCard.Subtitle ? ` - ${baseCard.Subtitle}` : ''} — #${baseCard.Number} (${key})`,
                    };

                    // Prioritize current set by putting its match at the front of the list
                    if (key === setKey) {
                        numberMatches.unshift(suggestion);
                    } else {
                        numberMatches.push(suggestion);
                    }
                }
            }
          }
      }
      
      // 2. Collect all Name Matches (for both numeric and non-numeric queries)
      // This handles "HK-47" and general name searches.
      const nameMatches: Suggestion[] = [];
      const nameMatchBaseNums = new Set<number>(numberMatches.map(s => s.number)); // Exclude cards already found by exact number match

      // Search all sets for name matches
      for (const [key, parsed] of parsedCacheRef.current.entries()) {
        const hits = parsed.baseCards
          .map(c => ({ 
            c, 
            // Check if name or subtitle contains the query (using normalized strings)
            idx: norm(c.Name).indexOf(lower),
            subIdx: c.Subtitle ? norm(c.Subtitle).indexOf(lower) : -1,
          }))
          // Filter: at least one name/subtitle match AND card number not already added by exact number match
          .filter(o => (o.idx >= 0 || o.subIdx >= 0) && !nameMatchBaseNums.has(o.c.Number))
          // Sort: by earliest match index (Name before Subtitle) then by Name
          .sort((a,b) => {
              const aIdx = a.idx >= 0 ? a.idx : a.subIdx;
              const bIdx = b.idx >= 0 ? b.idx : b.subIdx;
              return aIdx - bIdx || a.c.Name.localeCompare(b.c.Name);
          })
          .map(o => ({ 
            kind: 'name' as const, 
            name: o.c.Name, 
            number: o.c.Number, 
            type: o.c.Type,
            setKey: key,
            subtitle: o.c.Subtitle,
            label: `${o.c.Name}${o.c.Subtitle ? ` - ${o.c.Subtitle}` : ''} — #${o.c.Number} (${key})`,
          }));
          
          // Prioritize current set's name matches over others
          if (key === setKey) {
            nameMatches.unshift(...hits);
          } else {
            nameMatches.push(...hits);
          }
      }
      
      // 3. Merge: Exact Number matches first, then Name matches
      return [...numberMatches, ...nameMatches].slice(0, 10);

    }, [query, setKey, norm]);

  // Click outside to close dropdown
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as any)) setOpenSug(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Resolve alt-art number -> base printing
  function resolveToBase(n: number): Card | null {
    const found = byNumber.get(n);
    if (!found) return null;
    const base = baseByName.get(found.Name);
    return base || found;
  }

  // Search handlers (jump to spread immediately)
  function goFromNumberString(nStr: string) {
    const n = Number(nStr.replace(/^0+/, '') || '0');
    if (!Number.isFinite(n) || n < 1) { setError('Invalid number.'); return; }
    
    // 1. Resolve to the base number (this defines baseNum)
    const baseNum = altToBase.get(n) ?? n;          // alt → base
    
    // 2. Look up the card using the base number
    const card = byNumber.get(baseNum);
    if (!card) { setError('Number not found in this set.'); return; }
    
    // 3. Set the active state with all required properties
    const { page, row, column } = binderLayout(baseNum);
    const { spreadCol, spreadRow } = getSpreadCoords(page, row, column);
    setActive({ card, page, row, column, spreadCol, spreadRow });
    setError('');
    setViewSpread(pageToSpread(page));
  }
  function goFromName(name: string) {
    const base = baseByName.get(name);
    if (!base) { setError('Name not found in this set.'); return; }
    const { page, row, column } = binderLayout(base.Number);
    const { spreadCol, spreadRow } = getSpreadCoords(page, row, column);
    setActive({ card: base, page, row, column, spreadCol, spreadRow });
    setError('');
    setViewSpread(pageToSpread(page));
  }
  function onEnter() {
    const q = query.trim();
    if (!q) { setError('Enter a name or number.'); return; }
    if (/^[0-9]+$/.test(q)) goFromNumberString(q);
    else goFromName(q);
    setOpenSug(false);
  }
  function onChoose(s: Suggestion) {
    if (s.setKey !== setKey) {
      // If the card is from a different set, store the target and switch sets.
      setPendingSelection({ name: s.name, number: s.number });
      setSetKey(s.setKey);
      setQuery(''); setOpenSug(false);
      return;
    }

    // If it's the current set, navigate as before.
    if (s.kind === 'number') goFromNumberString(String(s.number));
    else goFromName(s.name);
    
    setQuery(''); setOpenSug(false);
  }

  function selectCardByNumber(baseNum: number) {
    const card = byNumber.get(baseNum);
    if (!card) { 
      setError('Card not found in current set data.');
      return; 
    }
    const { page, row, column } = binderLayout(baseNum);
    const { spreadCol, spreadRow } = getSpreadCoords(page, row, column);
    setActive({ card, page, row, column, spreadCol, spreadRow });
    setError('');
    setViewSpread(pageToSpread(page));
    setHighlightedRowNumber(baseNum);
    
    // Clear highlight after 500ms
    setTimeout(() => setHighlightedRowNumber(null), 500);

    // Scroll the binder into view if it's not fully visible
    if (binderRef.current) {
        binderRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Function to move the card selection based on visual coordinates (8 columns, 3 rows)
  const updateActivePosition = useCallback((deltaCol: number, deltaRow: number) => {
    if (!active) return;
    
    const currentNum = active.card.Number;
    const { page } = binderLayout(currentNum);

    // 1. Get current visual coordinates
    let newSpreadCol = active.spreadCol + deltaCol;
    let newSpreadRow = active.spreadRow + deltaRow;
    let targetSpread = pageToSpread(page);

    // 2. Implement Movement/Wrap Logic

    // --- Horizontal Movement/Spread Wrap (X-axis) ---
    if (deltaCol !== 0) {
        if (newSpreadCol > 8) {
            newSpreadCol = 1; 
            targetSpread += 1; // Jumps to next spread
        } else if (newSpreadCol < 1) {
            newSpreadCol = 8; 
            targetSpread -= 1; // Jumps to previous spread
        }
    }
    
    // --- Vertical Movement/Spread Wrap (Y-axis) ---
    if (deltaRow !== 0) {
        if (newSpreadRow > 3) {
            newSpreadRow = 1;
            targetSpread += 1; // Jumps to next spread
        } else if (newSpreadRow < 1) {
            newSpreadRow = 3;
            targetSpread -= 1; // Jumps to previous spread
        }
    }
    
    // 3. Constraint Checks
    if (targetSpread < 0 || targetSpread > totalSpreads - 1) return;

    // 4. Convert Spread Coordinate back to Card Number
    let targetPage = spreadToPrimaryPage(targetSpread);
    let targetColOnPage = 0;

    if (newSpreadCol <= 4) {
      // Target is Left Page (SpreadCol 1-4)
      targetColOnPage = newSpreadCol;
      // If we landed on the left side of the spread, the page number must be even (P2, P4, P6...)
      if (targetPage % 2 !== 0 && targetPage > 1) targetPage -= 1;
      // Handle P1 edge case (Spread 0 is right-page only)
      if (targetPage === 1 && newSpreadCol <= 4) return;
    } else {
      // Target is Right Page (SpreadCol 5-8)
      targetColOnPage = newSpreadCol - 4;
      // If we landed on the right side of the spread, the page number must be odd (P3, P5, P7...)
      if (targetPage % 2 === 0) targetPage += 1;
    }
    
    const newNumCandidate = numberFromPRC(targetPage, newSpreadRow, targetColOnPage);
    
    // Final boundary check against total card slots
    if (newNumCandidate > totalPages * 12) return;

    // 5. Apply Position
    const newCard = byNumber.get(newNumCandidate);
    
    const newActiveState = {
        card: newCard || { ...active.card, Number: newNumCandidate },
        page: targetPage,
        row: newSpreadRow,
        column: targetColOnPage,
        spreadCol: newSpreadCol,
        spreadRow: newSpreadRow,
    };

    setActive(newActiveState);
    setViewSpread(targetSpread);
    
  }, [active, totalPages, totalSpreads, byNumber, setActive, setViewSpread]);
  
  const setKeys = useMemo(() => sets.map(s => s.key as SetKey), [sets]);

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
  type InventoryAll = { version: 1; sets: Record<SetKey, Inventory> };

  function readSetInv(k: SetKey): Inventory {
    try { return JSON.parse(localStorage.getItem(`inv:${k}`) || '{}'); }
    catch { return {}; }
  }
  function writeSetInv(k: SetKey, inv: Inventory) {
    localStorage.setItem(`inv:${k}`, JSON.stringify(inv));
  }
  function inc(n: number) {
    const c = byNumber.get(n) || cardsAll.find(x => x.Number === n);
    const max = quotaForType(c?.Type);
    setInventory(prev => ({ ...prev, [n]: Math.min((prev[n] || 0) + 1, max) }));
  }
  function dec(n: number) {
    setInventory(prev => {
      const next = Math.max((prev[n] || 0) - 1, 0);
      if (next === 0) {
        const { [n]: _removed, ...rest } = prev; // drop the key entirely
        return rest;
      }
      return { ...prev, [n]: next };
    });
  }
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

  function importAllInv(file: File) {
    file.text().then(txt => {
      try {
        const raw = JSON.parse(txt);
        const setsFromFile: Partial<Record<SetKey, Inventory>> =
          raw?.version === 1 && raw?.sets ? raw.sets : {};

        setKeys.forEach(k => {
          const inv = setsFromFile[k] ?? {};
          writeSetInv(k, pruneZeros(inv));
        });
        if (setsFromFile[setKey]) setInventory(pruneZeros(setsFromFile[setKey]!));
      } catch {
        alert('Import failed: invalid JSON format.');
      }
    });
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
          localStorage.removeItem(`inv:${setKey}`);
          setInventory({});
          alert(`Inventory for the current set (${setKey}) has been cleared.`);
      } else if (scope === 'all') {
          // Iterate over all keys in localStorage and remove those that start with 'inv:'
          if (!sets.length) {
              for (const key of Object.keys(localStorage)) {
                  if (key.startsWith('inv:')) {
                      localStorage.removeItem(key);
                  }
              }
          } else {
              // Clear based on loaded set keys
              for (const set of sets) {
                  localStorage.removeItem(`inv:${set.key}`);
              }
          }
          setInventory({}); // Reset current view as well
          alert('Inventory for ALL sets has been cleared.');
      }
      setShowResetModal(false);
  };

  function resetInv() {
      setShowResetModal(true);
  }

  const applyImport = (mode: 'merge' | 'replace') => {
      let importedCount = 0;
      
      for (const [key, importedInv] of Object.entries(importData)) {
          if (!key || Object.keys(importedInv).length === 0) continue;

          const currentInv = readSetInv(key);
          const newInv: Inventory = {};

          // Start with current inventory if merging
          if (mode === 'merge') {
              Object.assign(newInv, currentInv);
          }

          // Apply imported counts (already capped to max in parseCsvData)
          for (const [baseNumberStr, newCount] of Object.entries(importedInv)) {
              const baseNumber = Number(baseNumberStr);
              const currentCount = newInv[baseNumber] || 0;
              
              // Get max quota for final cap check (necessary because the card type needs context)
              const card = cardsAll.find(c => c.Number === baseNumber && c.Set === key);
              const max = quotaForType(card?.Type);
              
              const updatedCount = mode === 'merge' 
                  ? Math.min(newCount + currentCount, max) 
                  : Math.min(newCount, max);

              if (updatedCount > 0) {
                  newInv[baseNumber] = updatedCount;
                  importedCount++;
              } else if (newInv[baseNumber]) {
                  delete newInv[baseNumber];
              }
          }
          
          writeSetInv(key, pruneZeros(newInv));

          if (key === setKey) {
              setInventory(pruneZeros(newInv));
          }
      }
      
      setShowImportModal(false);
      setImportData({});
      alert(`Successfully applied import of ${importedCount} card entries in ${mode} mode.`);
  };
  
  // File change handler to parse the file and open the modal
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImportingFileName(file.name);
      setError('');

      try {
          const ext = file.name.split('.').pop()?.toLowerCase();
          
          const fullCardIndex = new Map<string, { baseNumber: number, type?: string, name: string }>();
          const allSetCards: Card[] = Array.from(parsedCacheRef.current.values()).flatMap(p => p.allCards);

          // Populate the lookup map with normalized data needed for parsing/capping
          for (const card of allSetCards) {
              const baseNum = card.Number; 
              fullCardIndex.set(`${card.Set}:${card.Number}`, {
                  baseNumber: baseNum,
                  type: card.Type,
                  name: card.Name
              });
          }
          
          const cardUtilities: CardUtilities = { quotaForType, fullCardIndex };
          
          const parsedInventory =
            ext === 'xlsx'
              ? await parseXlsxData(file, cardUtilities)  // ← new XLSX path
              : parseCsvData(file.name, await file.text(), cardUtilities); // existing CSV/JSON path
          setImportData(parsedInventory);
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

    const callEnter = () => {
      const q = (query || '').trim();
      if (!q) return;
      if (/^[0-9]+$/.test(q)) goFromNumberString(q);
      else goFromName(q);
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
          callEnter();
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
        if (e.key === ',' || e.key === '<') { // Comma
          e.preventDefault();
          deltaSpread = -1;
        } else if (e.key === '.' || e.key === '>') { // Period
          e.preventDefault();
          deltaSpread = 1;
        }
        
        // Handle Page Flip (if active, anchor the selection)
        if (deltaSpread !== 0) {
            const currentSpread = viewSpread;
            const newSpread = Math.max(0, Math.min(totalSpreads - 1, currentSpread + deltaSpread));

            if (newSpread !== currentSpread) {
                // If a card is active, calculate its new position
                if (active) {
                    // 24 slots per spread (12 cards per page * 2 pages)
                    const deltaNum = deltaSpread * 24;
                    const currentNum = active.card.Number;
                    let newNum = currentNum + deltaNum;

                    // Edge Case: Page 1 (Spread 0) only has 12 slots.
                    // If moving to spread 0, the minimum number is #1
                    if (newSpread === 0) {
                        newNum = Math.max(1, newNum);
                    }
                    
                    // Constrain the number to the set's bounds
                    const maxSetNum = totalPages * 12;
                    newNum = Math.min(maxSetNum, newNum);

                    // Find the nearest existing card near the new position (using the number itself is simplest)
                    const newCard = byNumber.get(newNum) || byNumber.get(Math.max(1, newNum)); // Fallback to #1

                    if (newCard) {
                        const { page, row, column } = binderLayout(newCard.Number);
                        const { spreadCol, spreadRow } = getSpreadCoords(page, row, column); // CALCULATE SPREAD COORDS
                        setActive({ card: newCard, page, row, column, spreadCol, spreadRow }); // PASS SPREAD COORDS
                    } else {
                        // If no card exists at the new relative position, select the first card on the new spread
                        const firstNumOnSpread = newSpread * 24 + 1;
                        const firstCardOnSpread = byNumber.get(firstNumOnSpread) || byNumber.get(Math.max(1, firstNumOnSpread));
                        if(firstCardOnSpread) {
                           const { page, row, column } = binderLayout(firstCardOnSpread.Number);
                           const { spreadCol, spreadRow } = getSpreadCoords(page, row, column); // CALCULATE SPREAD COORDS
                           setActive({ card: firstCardOnSpread, page, row, column, spreadCol, spreadRow }); // PASS SPREAD COORDS
                        } else {
                           setActive(null); // Clear selection if no card is found
                        }
                    }
                }
                setViewSpread(newSpread);
            }
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
  }, [active, query, setViewSpread, totalSpreads, updateActivePosition, inc, dec, byNumber, totalPages]);

  const fmtUSD = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const passesAllFilters = useCallback((card: Card) => {
    const activeAspects = filters.aspect;
    const activeRarities = filters.rarity;
    const activeTypes = filters.type;

    // 1) Aspect
    if (activeAspects.length > 0) {
      const primaryAspect = card.Aspects?.[0] || 'NEUTRAL';
      if (!activeAspects.includes(primaryAspect)) return false;
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
      const nums = baseToAll.get(baseNum) || [baseNum]; // base + alts
      const have = nums.reduce((sum, n) => sum + (inventory[n] || 0), 0);
      const max = quotaForType(baseCard.Type);
      const needed = Math.max(0, max - have);

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
  }, [cardsBase, baseToAll, inventory, passesAllFilters]);

  // Projections for the two tabs (shape-compatible with your tables)
  const filteredInvRows = useMemo(() => {
    // rows with Qty > 0
    return filteredAllRows
      .filter(r => r.Qty > 0)
      .map(r => ({ Number: r.Number, Name: r.Name, Type: r.Type, Qty: r.Qty, Max: r.Max }));
  }, [filteredAllRows]);

  const filteredMissingRows = useMemo(() => {
    // rows with Qty < Max
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
  const missingRows = filteredMissingRows;

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

  // Cost to complete uses the canonical missing projection
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
        
        // Final format: QTY Name - Subtitle [setKey]
        return `${r.Needed} ${cardNamePart} [${setKey}]`;
    }).join('\n');

    if (list.length === 0) {
        alert('No missing cards matching current filters to copy!');
        return;
    }

    // Use modern clipboard API
    navigator.clipboard.writeText(list).then(() => {
        alert(`Successfully copied ${filteredMissingRows.length} filtered card lines to clipboard for TCGPlayer Mass Entry.`);
    }).catch(err => {
        alert('Failed to copy to clipboard. Check browser permissions.');
        console.error('Copy error:', err);
    });
  }

  return (
    <>
        {prevSetKey && (
            <button 
                className="set-nav-arrow"
                onClick={() => changeSet('prev')}
                title={`Switch to ${prevSetKey}`}
                style={{
                    // CRITICAL CHANGE: Use fixed position to anchor to the viewport
                    position: 'fixed', 
                    // Calculate left position: Viewport center minus half content width (1400px) minus button width/gap (e.g., 80px)
                    // max(0px, ...) prevents the button from getting cut off screen on small viewports
                    left: 'max(0px, calc((100vw - 1400px) / 2 - 100px))', 
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: '20px 10px 20px 10px',
                    backgroundColor: '#11121a',
                    color: '#e5e7eb',
                    border: '1px solid #2b2d3d',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    zIndex: 100, 
                    fontSize: '28px',
                    fontWeight: 700,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    width: '90px', 
                    pointerEvents: 'auto',
                }}
            >
                <span style={{ fontSize: '0.45em', fontWeight: 600 }}>Prev. Set</span>
                <span style={{ fontSize: '2em' }}>‹</span>
                <span
                  style={{
                    fontSize: '26px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid #ffffff', 
                    color: '#ffffff', 
                    backgroundColor: '#0b0b0b',
                    flexShrink: 0,
                  }}
                >
                  {prevSetKey}
                </span>
            </button>
        )}

        {nextSetKey && (
            <button
                className="set-nav-arrow"
                onClick={() => changeSet('next')}
                title={`Switch to ${nextSetKey}`}
                style={{
                    // CRITICAL CHANGE: Use fixed position to anchor to the viewport
                    position: 'fixed',
                    // Calculate right position: Viewport center minus half content width (1400px) minus button width/gap (e.g., 80px)
                    right: 'max(0px, calc((100vw - 1400px) / 2 - 100px))',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: '20px 10px 20px 10px',
                    backgroundColor: '#11121a',
                    color: '#e5e7eb',
                    border: '1px solid #2b2d3d',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    zIndex: 100, 
                    fontSize: '28px',
                    fontWeight: 700,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    width: '90px', 
                    pointerEvents: 'auto',
                }}
            >
                <span style={{ fontSize: '0.45em', fontWeight: 600 }}>Next Set</span>
                <span style={{ fontSize: '2em' }}>›</span>
                <span
                  style={{
                    fontSize: '26px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid #ffffff', 
                    color: '#ffffff', 
                    backgroundColor: '#0b0b0b',
                    flexShrink: 0,
                  }}
                >
                  {nextSetKey}
                </span>
            </button>
        )}
    <div 
            className="container"
            style={{
                // IMPORTANT: The `position: relative` should be removed here and kept on the arrow wrapper 
                // to allow the arrows to anchor to the viewport width. Removing it here simplifies the layout.
                maxWidth: '1400px',
                padding: '20px 16px',
                margin: '0 auto',
            }}
        >
      {/* Top bar (no page control here anymore) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 className="title">SWU Binder Organizer</h1>
        <div className="row controls-row" style={{ marginTop: 8 }} ref={boxRef}>
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
                  if (openSug && suggestions.length) {
                    const pick = suggestions[Math.min(highlightIdx, suggestions.length - 1)] || suggestions[0];
                    onChoose(pick);
                  } else {
                    onEnter();
                  }
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
              onClick={() => onEnter()}
              title="Search"
              aria-label="Search"
            >
              <span className="icon" aria-hidden="true">search</span>
            </button>
            {openSug && suggestions.length > 0 && (
              <div className="sug">
                {suggestions.map((s, i) => {
                  const typeText = s.type ? s.type : ''; 

                  // NEW LOGIC: Access the correct set's alt-art map from the cache
                  const targetSetData = parsedCacheRef.current.get(s.setKey);
                  
                  // show base + alt numbers for BOTH kinds
                  // Use the target set's baseToAll map, falling back to just the base number if data is missing
                  const nums = targetSetData?.baseToAll.get(s.number) || [s.number];
                  const numsLabel = nums.map((n) => `#${n}`).join(', ');

                  return (
                    <div
                      key={`${s.setKey}:${s.number}`} // Ensure unique key across sets
                      className={`sug-item ${i === highlightIdx ? 'active' : ''}`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onMouseDown={(e) => { e.preventDefault(); onChoose(s); }}
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
            </div>
          </div>

          {error && <span className="err">{error}</span>}
        </div>
      </div>

      {/* Binder (with spread pager + dropdown) */}
      <div className="card" ref={binderRef}>
        <Binder
          viewSpread={viewSpread}
          setViewSpread={setViewSpread}
          totalSpreads={totalSpreads}
          active={active}
          setActive={setActive}
          presentNumbers={presentNumbers}
          numToColor={numToColor}
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
            {listView === 'missing' && missingRows.length > 0 ? (
              <button
                className="tbtn tbtn-primary" 
                onClick={copyMissingToClipboard}
                title="Copy list in TCGPlayer Mass Entry format: QTY Name - Subtitle [setKey]"
                aria-label="Copy missing cards list for TCGPlayer"
              >
                <span className="icon" aria-hidden="true">content_paste</span>
                <span>Copy TCG List ({filteredMissingRows.length})</span>
              </button>
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
          {listView === 'missing' ? (
            <div 
              className="muted" 
              aria-live="polite"
              style={{ paddingTop: 18, paddingBottom: 16, fontSize: 14, fontWeight: 600 }} 
            >
              Cost to Complete: {fmtUSD(missingCost)}
            </div>
          ) : (
            // Inventory Progress Bar and Status
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Collection Status ({inventoryStatus.totalCards} Unique Cards)
              </div>
              {/* Progress Bar Container */}
              <div 
                title={`Complete: ${inventoryStatus.complete}, In Progress: ${inventoryStatus.incomplete}, Missing: ${inventoryStatus.missing}`}
                style={{ 
                  width: '100%', height: 10, borderRadius: 5, 
                  backgroundColor: '#ef4444', 
                  display: 'flex', overflow: 'hidden' 
                }}
              >
                {/* Green: Complete Playsets */}
                <div style={{ 
                  width: `${(inventoryStatus.complete / inventoryStatus.totalCards) * 100}%`, 
                  backgroundColor: '#22c55e'
                }} />
                {/* Yellow: Incomplete Playsets */}
                <div style={{ 
                  width: `${(inventoryStatus.incomplete / inventoryStatus.totalCards) * 100}%`, 
                  backgroundColor: '#f59e0b'
                }} />
              </div>
              {/* Status Counts */}
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 12, opacity: 0.8 }}>
                <span style={{ color: '#34d399' }}>✓ {inventoryStatus.complete}</span>
                <span style={{ color: '#fcd34d' }}>! {inventoryStatus.incomplete}</span>
                <span style={{ color: '#f87171' }}>✕ {inventoryStatus.missing}</span>
              </div>
            </div>
          )}
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
                    const dot = numToColor.get(r.Number);
                    const card = byNumber.get(r.Number) || cardsAll.find(x => x.Number === r.Number);
                    const complete = r.Qty >= r.Max;
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
                        <td className="mono numcol">#{r.Number}</td>
                        <td className="dotcol">
                          {dot && (
                            <span
                              title="Aspect color"
                              aria-label="Aspect color"
                              style={{
                                display: 'inline-block',
                                width: 12, height: 12, borderRadius: 3,
                                background: dot,
                                boxShadow: '0 0 0 2px #2b2d3d inset',
                              }}
                            />
                          )}
                        </td>
                        <td className="rarcol">
                          <RarityBadge rarity={card?.Rarity} />
                        </td>
                        <td>
                          {r.Name}
                          {card?.Subtitle && (
                            <span style={{ opacity: 0.7, fontSize: '0.9em', display: 'block', lineHeight: 1 }}>
                              {card.Subtitle}
                            </span>
                          )}
                        </td>
                        <td>{r.Type || ''}</td>
                        <td className="mono qtycol">{r.Qty}</td>
                        <td className="compcol">
                          {r.Qty >= r.Max ? (
                            <span className="check" title="Complete" aria-label="Complete">✓</span>
                          ) : (
                            <span className="warn" title="Partially collected" aria-label="Partially collected">!</span>
                          )}
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
                    const dot = numToColor.get(r.Number);
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
                        <td className="mono numcol">#{r.Number}</td>
                        <td className="dotcol">
                          {dot && (
                            <span
                              title="Aspect color"
                              aria-label="Aspect color"
                              style={{
                                display: 'inline-block',
                                width: 12, height: 12, borderRadius: 3,
                                background: dot,
                                boxShadow: '0 0 0 2px #2b2d3d inset',
                              }}
                            />
                          )}
                        </td>
                        <td className="rarcol">
                          <RarityBadge rarity={card?.Rarity} />
                        </td>
                        <td>
                          {r.Name}
                          {card?.Subtitle && (
                            <span style={{ opacity: 0.7, fontSize: '0.9em', display: 'block', lineHeight: 1 }}>
                              {card.Subtitle}
                            </span>
                          )}
                        </td>
                        <td>{r.Type || ''}</td>
                        <td className="compcol">
                          {r.Have >= r.Max ? (
                            <span className="check" title="Complete" aria-label="Complete">✓</span>
                          ) : r.Have > 0 ? (
                            <span className="warn" title="Partially collected" aria-label="Partially collected">!</span>
                          ) : (
                            <span className="x" title="Not collected" aria-label="Not collected">✕</span>
                          )}
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
              {missingRows.length ?
                'No missing cards match current filters.' : // NEW: Filtered empty message
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
                  <p style={{ opacity: 0.8, marginBottom: 20 }}>
                      Please choose the scope of the inventory data you wish to clear.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                    <button
                        className="modal-btn"
                        onClick={() => {
                            if (window.confirm(`Are you sure you want to clear inventory for the current set (${setKey})?`)) {
                                handleResetInventory('current');
                            } else {
                                setShowResetModal(false);
                            }
                        }}
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
                        onClick={() => {
                            if (window.confirm("WARNING: This will clear inventory data for ALL sets stored locally. Are you absolutely sure?")) {
                                handleResetInventory('all');
                            } else {
                                setShowResetModal(false);
                            }
                        }}
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
                          onClick={() => {
                              if (window.confirm("WARNING: Replacing will delete all existing inventory data and replace it with the imported data. Are you sure?")) {
                                  applyImport('replace');
                              }
                          }}
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
              
              {/* Define a base style for the modal's buttons */}
              <style
                dangerouslySetInnerHTML={{
                  __html: `
                    .modal-btn {
                      border: none;
                      border-radius: 4px;
                      padding: 6px 10px;
                      color: #fff;
                      font-weight: 600;
                      cursor: pointer;
                      transition: background-color 0.15s;
                      width: 100%;
                    }
                    .modal-btn:hover { opacity: 0.9; }
                  `,
                }}
              />

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
    </div>
    </>
  );
}

function Binder({
  viewSpread,
  setViewSpread,
  totalSpreads,
  active,
  setActive,
  presentNumbers,
  numToColor,
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
  active: { 
    card: Card; 
    page: number; 
    row: number; 
    column: number; 
    spreadCol: number; 
    spreadRow: number; 
  } | null;
  setActive: (v: { 
    card: Card; 
    page: number; 
    row: number; 
    column: number; 
    spreadCol: number; 
    spreadRow: number; 
  } | null)=>void;
  presentNumbers: Set<number>;
  numToColor: Map<number, string>;
  byNumber: Map<number, Card>;
  inventory: Inventory;
  inc: (n:number)=>void;
  dec: (n:number)=>void;
  setKey: SetKey;
  showHelpModal: boolean;
  setShowHelpModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const page = spreadToPrimaryPage(viewSpread);     // 1, 2, 4, 6, ...
  const leftPage = page % 2 === 0 ? page : page - 1;
  const rightPage = page % 2 === 1 ? page : page + 1;
  const showLeft = leftPage >= 2;

  const cols = 8, rows = 3;
  const cellW = 120, cellH = 170, gap = 16;
  const vbW = cols * cellW + (cols - 1) * gap + 32;
  const vbH = rows * cellH + (rows - 1) * gap + 32;

  const spreadLabel = page === 1
    ? 'Spread: Page 1'
    : `Spread: Page ${leftPage} (left) | Page ${rightPage} (right)`;

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

  return (
    <>
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
                const dot = numToColor.get(active.card.Number);
                return dot ? (
                  <span
                    style={{
                      width: 12, height: 12, borderRadius: 3, background: dot,
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
              <span className="pill">Column {active.spreadCol}</span>
              <span className="pill">Row {active.spreadRow}</span>
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
          <span style={{ fontWeight: 600 }}>Binder</span> — {spreadLabel}
        </div>
        <div className="pager">
          <button className="btn" onClick={() => setViewSpread(s => Math.max(0, s - 1))}>
            ‹ Prev <span className="key-pill">,</span>
          </button>
          <select value={viewSpread} onChange={e => setViewSpread(Number(e.target.value))}>
            {spreadOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn" onClick={() => setViewSpread(s => Math.min(totalSpreads - 1, s + 1))}>
            <span className="key-pill">.</span> Next ›
          </button>
        </div>
      </div>

      <div className="grid-wrap">
        <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet">
          <g transform="translate(16,16)">
            {Array.from({ length: rows }).map((_, rIdx) =>
              Array.from({ length: cols }).map((__, cIdx) => {
                const r = rIdx + 1;
                const c = cIdx + 1;
                const x = cIdx * (cellW + gap);
                const y = rIdx * (cellH + gap);

                const isLeftHalf = c <= 4;
                const pForCell = isLeftHalf ? leftPage : rightPage;
                const colOnPage = isLeftHalf ? c : c - 4;
                const hidden = isLeftHalf && !showLeft;

                const n = numberFromPRC(pForCell, r, colOnPage);
                const cardAt = byNumber.get(n);

                let fill = '#0f1017';
                let opacity = hidden ? 0.25 : 0.9;
                let stroke = '#2b2d3d';
                let strokeWidth = 2;
                let qtyText = '';

                if (!hidden && presentNumbers.has(n)) {
                  fill = numToColor.get(n) || NEUTRAL;
                  const qty = inventory[n] || 0;
                  const max = quotaForType(cardAt?.Type);
                  qtyText = `${qty}/${max}`;
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

                      const { page: bp, row: br, column: bc } = binderLayout(n);
                      // FIX: Added spreadCol (c) and spreadRow (r) to complete the active state
                      setActive({ 
                        card, 
                        page: bp, 
                        row: br, 
                        column: bc, 
                        spreadCol: c, 
                        spreadRow: r 
                      });
                      setViewSpread(pageToSpread(bp));
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

                    // label color; invert on Heroism white
                    const labelColor = String(fill).toLowerCase() === '#e5e7eb' ? '#11121a' : '#eaeaf0';

                    // data for this slot
                    const qty = inventory[n] || 0;
                    const max = quotaForType(cardAt?.Type);
                    const qtyText = `${qty}/${max}`;

                    // rarity + outline (will render bottom-right)
                    const sty = cardAt?.Rarity ? rarityGlyph(cardAt.Rarity) : null;
                    const rarityOutline = String(fill).toLowerCase() === '#e5e7eb' ? '#11121a' : '#ffffff';

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
            {/* dotted divider */}
            <line
              x1={(cellW + gap) * 4 - gap / 2}
              y1={-8}
              x2={(cellW + gap) * 4 - gap / 2}
              y2={vbH - 32 + 8}
              stroke="#424452ff"
              strokeOpacity={0.75}
              strokeWidth={4}
              strokeDasharray="0 12"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
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
      
      {/* Ensure key-pill style is available globally */}
      <style
          dangerouslySetInnerHTML={{
            __html: `
              .key-pill {
                display: inline-block;
                padding: 2px 5px;
                margin: 0 3px;
                border-radius: 4px;
                border: 1px solid #424452;
                background-color: #1a1b26;
                color: #e5e7eb;
                font-weight: 700;
                font-size: 0.85em;
                line-height: 1.2;
                font-family: monospace;
              }
            `,
          }}
        />
      </div>
    </>
  );
}
