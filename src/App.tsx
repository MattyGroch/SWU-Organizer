import React, { useEffect, useMemo, useRef, useState } from 'react';

type Card = {
  Name: string;
  Subtitle?: string;
  Number: number;
  Aspects?: string[];
  Type?: string;
  Rarity?: string;
  MarketPrice?: number;
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
const BTN = 32;          // button diameter
const GAP = 8;           // CSS gap between buttons
const GROUP_W = BTN * 2 + GAP;  // 72
const GROUP_H = BTN;             // 32

const RARITY_STYLE: Record<string, {letter: string; color: string}> = {
  Common:    { letter: 'C',  color: '#8B5E3C' }, // brown
  Uncommon:  { letter: 'U',  color: '#9AA0B4' }, // gray
  Rare:      { letter: 'R',  color: '#FACC15' }, // yellow
  Legendary: { letter: 'L',  color: '#7DD3FC' }, // light blue
  'Starter Deck Exclusive': { letter: 'S', color: '#000000' }, // black
  Starter:   { letter: 'S',  color: '#000000' },
  Special:   { letter: 'S', color: '#000000' },
};

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

export default function App() {
  const [sets, setSets] = useState<SetMeta[]>([]);
  const [setKey, setSetKey] = useState<SetKey>('LOF'); // default/fallback
  const searchRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // toggle: search only current set vs all sets
  const [searchAll, setSearchAll] = useState(false);

  // cache parsed data for sets (so we don't refetch repeatedly)
  type ParsedSet = {
    key: string;
    byNumber: Map<number, Card>;
    baseToAll: Map<number, number[]>;
    nameRows: Array<{ key: string; number: number; name: string; type?: string }>;
  };
  const parsedCacheRef = useRef<Map<string, ParsedSet>>(new Map());

  // global index built when searchAll = true
  const [globalNames, setGlobalNames] = useState<ParsedSet["nameRows"]>([]);

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
      s: 'Starter Deck Exclusive',
      starter: 'Starter Deck Exclusive',
      'starter deck exclusive': 'Starter Deck Exclusive',
      'starter deck-exclusive': 'Starter Deck Exclusive',
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
  function keyNameType(c: {Name: string; Type?: string}) {
    return `${c.Name.trim().toLowerCase()}|${(c.Type||'').trim().toLowerCase()}`;
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
  const [active, setActive] = useState<{ card: Card; page: number; row: number; column: number } | null>(null);

  // Spreads (instead of pages)
  const maxNumber = useMemo(() => cardsBase.reduce((m,c)=>Math.max(m,c.Number), 0), [cardsBase]);
  const totalPages = Math.max(1, Math.ceil(maxNumber / 12));
  const totalSpreads = 1 + Math.ceil(Math.max(0, totalPages - 1) / 2);
  const [viewSpread, setViewSpread] = useState<number>(0); // 0 => Page 1; >=1 => 2/3, 4/5, ...

  // Suggestions dropdown
  const [openSug, setOpenSug] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Load set JSON
  useEffect(() => {
    async function load() {
      setError(''); setQuery(''); setActive(null);
      setCardsAll([]); setCardsBase([]); setViewSpread(0);

      const meta = sets.find(s => s.key === setKey);
      if (!meta) return;                         // nothing to load yet

      const url = meta.file.startsWith('/') ? meta.file : `/sets/${meta.file}`;
      const res = await fetch(url);
      const obj = await res.json();
      const data = Array.isArray(obj) ? obj : obj.data;

      const mapped: Card[] = data.map((c: any) => {
        const rawName = String(c.Name || '').trim();
        // Assuming 'Subtitle' is the field name in your JSON data
        const rawSubtitle = String(c.Subtitle || '').trim();
        
        // Construct the full card name: "Name - Subtitle"
        const cardName = rawSubtitle
          ? `${rawName} - ${rawSubtitle}`
          : rawName;
          
        return {
          Name: cardName, // Use the constructed name here
          Number: Number(c.Number),
          Aspects: Array.isArray(c.Aspects) ? c.Aspects : [],
          Type:
            typeof c.Type === 'string'
              ? c.Type
              : (typeof c.Type?.Name === 'string' ? c.Type.Name : undefined),
          Rarity: normalizeRarity(c.Rarity ?? c.rarity ?? c.RarityCode ?? c.Rarity?.Name),
          MarketPrice: Number(c.MarketPrice ?? c.Price ?? 0), 
          Subtitle: rawSubtitle || undefined, // Storing the raw subtitle as well
        };
      }).filter((c: Card) => !!c.Name && Number.isFinite(c.Number));

      // 1) unique by Number (keep the version that has Aspects if duped)
      const byNum = new Map<number, Card>();
      for (const c of mapped.sort((a,b) => {
        const hasA = (a.Aspects?.length ?? 0) > 0 ? 1 : 0;
        const hasB = (b.Aspects?.length ?? 0) > 0 ? 1 : 0;
        return hasB - hasA || a.Number - b.Number;
      })) {
        if (!byNum.has(c.Number)) byNum.set(c.Number, c);
      }
      const allCards = Array.from(byNum.values()).sort((a,b)=>a.Number-b.Number);
      setCardsAll(allCards);

      // 2) base-only view = dedupe by (Name + Type), keep lowest Number
      const baseCards = baseOnly(allCards);
      setCardsBase(baseCards);

      // 3) build alt maps for search display & alt→base resolve
      const { baseToAll, altToBase } = buildAltMaps(allCards);
      setBaseToAll(baseToAll);
      setAltToBase(altToBase);
    }
    load().catch(() => setError('Failed to load set data.'));
  }, [setKey, sets]);

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
  type Suggestion = { kind: 'name' | 'number'; label: string; number: number; name: string };
  const suggestions: Suggestion[] = useMemo(() => {
    const raw = query.trim();
    if (!raw) return [];
    const isDigits = /^[0-9]+$/.test(raw);

    if (isDigits) {
      const qnorm = raw.replace(/^0+/, '') || '0';

      // ---- NUM hits (numbers starting with the query), grouped alt→base
      const matchedNums = cardsAll.filter(c => {
        const s = String(c.Number);
        return s.startsWith(raw) || s.startsWith(qnorm);
      });

      const byBase = new Map<number, Card>();
      for (const c of matchedNums) {
        const base = altToBase.get(c.Number) ?? c.Number;
        const baseCard = byNumber.get(base);           // baseCards map
        if (baseCard) byBase.set(base, baseCard);
      }
      const numSugs = Array.from(byBase.values())
        .sort((a,b)=>a.Number-b.Number)
        .slice(0, 10)
        .map(card => ({
          kind: 'number' as const,
          name: card.Name,
          number: card.Number,
          type: card.Type || '',
          label: `${card.Name} — #${card.Number}`,
        }));

      // ---- NAME hits (names that contain the digits, e.g., "HK-47")
      const qName = norm(raw);                          // "47"
      const nameHits = cardsBase.filter(c => norm(c.Name).includes(qName));
      const nameSugsRaw = nameHits
        .sort((a,b)=>a.Number-b.Number)
        .slice(0, 10)
        .map(card => ({
          kind: 'name' as const,
          name: card.Name,
          number: card.Number,
          type: card.Type || '',
          label: `${card.Name} — #${card.Number}`,
        }));

      // Dedupe: don't show the SAME base number twice; prefer [num] row
      const numSet = new Set(numSugs.map(s => s.number));
      const nameSugs = nameSugsRaw.filter(s => !numSet.has(s.number));

      // Merge: numeric first, then name
      return [...numSugs, ...nameSugs].slice(0, 10);
    }

    // (name path unchanged)
    const lower = raw.toLowerCase();
    return cardsBase
      .map(c => ({ c, idx: c.Name.toLowerCase().indexOf(lower) }))
      .filter(o => o.idx >= 0)
      .sort((a,b) => a.idx - b.idx || a.c.Name.localeCompare(b.c.Name))
      .slice(0, 10)
      .map(o => ({ kind: 'name', label: `${o.c.Name} — #${o.c.Number}`, number: o.c.Number, name: o.c.Name }));
  }, [query, cardsAll, cardsBase, altToBase, byNumber]);

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
    const baseNum = altToBase.get(n) ?? n;          // alt → base
    const card = byNumber.get(baseNum);
    if (!card) { setError('Number not found in this set.'); return; }
    const { page, row, column } = binderLayout(baseNum);
    setActive({ card, page, row, column });
    setError('');
    setViewSpread(pageToSpread(page));
  }
  function goFromName(name: string) {
    const base = baseByName.get(name);
    if (!base) { setError('Name not found in this set.'); return; }
    const { page, row, column } = binderLayout(base.Number);
    setActive({ card: base, page, row, column });
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
    if (s.kind === 'number') goFromNumberString(String(s.number));
    else goFromName(s.name);
    setQuery(''); setOpenSug(false);
  }

  const setKeys = useMemo(() => sets.map(s => s.key as SetKey), [sets]);

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

  function resetInv() { if (confirm('Reset inventory for this set?')) setInventory({}); }

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

      // Spread navigation + qty adjust (only when not typing)
      if (!typing) {
            if (e.key === 'Escape') {
          e.preventDefault();
          setActive(null);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setViewSpread(s => Math.max(0, s - 1));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setViewSpread(s => Math.min(totalSpreads - 1, s + 1));
        } else if (active && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) {
          e.preventDefault();
          inc(active.card.Number);
        } else if (active && (e.key === '-' || e.code === 'NumpadSubtract')) {
          e.preventDefault();
          dec(active.card.Number);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, query, setViewSpread, totalSpreads]);

  // Inventory table rows
  const invRows = useMemo(() => {
    const rows: {Number:number, Name:string, Type?:string, Qty:number, Max:number}[] = [];
    for (const [nStr, qty] of Object.entries(inventory)) {
      if ((qty as number) <= 0) continue;           // <-- guard
      const n = Number(nStr);
      if (!Number.isFinite(n)) continue;
      const c = byNumber.get(n) || cardsAll.find(x => x.Number === n);
      if (!c) continue;
      const max = quotaForType(c.Type);
      rows.push({ Number: n, Name: c.Name, Type: c.Type, Qty: qty as number, Max: max });
    }
    return rows.sort((a,b)=>a.Number-b.Number);
  }, [inventory, byNumber, cardsAll]);

  // --- Missing-cards tab state ---
  const [listView, setListView] = useState<'inventory' | 'missing'>('inventory');

  // Build rows of cards that are below max (include 0s and partials)
  // Counts across base + all alt printings
  const missingRows = useMemo(() => {
    const rows: {
      Number: number;
      Name: string;
      Type?: string;
      Have: number;
      Max: number;
      Needed: number;
      Price: number;     // unit price (MarketPrice)
      RowTotal: number;  // Needed * Price
    }[] = [];

    for (const baseCard of cardsBase) {
      const baseNum = baseCard.Number;
      const nums = baseToAll.get(baseNum) || [baseNum];       // base + alts
      const have = nums.reduce((sum, n) => sum + (inventory[n] || 0), 0);
      const max = quotaForType(baseCard.Type);
      const needed = Math.max(0, max - have);
      const price = Number(baseCard?.MarketPrice ?? 0);
      if (have < max) {
        rows.push({
          Number: baseNum,
          Name: baseCard.Name,
          Type: baseCard.Type,
          Have: have,
          Max: max,
          Needed: Math.max(0, max - have),
          Price: price,
          RowTotal: needed * price,
        });
      }
    }

    return rows.sort((a, b) => a.Number - b.Number);
  }, [cardsBase, baseToAll, inventory]);

  const fmtUSD = (n: number) =>
    n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const missingCost = useMemo( () => missingRows.reduce((sum, r) => sum + r.RowTotal, 0), [missingRows] );

  return (
    <div className="container">
      {/* Top bar (no page control here anymore) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 className="title">SWU Binder Organizer</h1>
        <div className="row controls-row" style={{ marginTop: 8 }} ref={boxRef}>
          <label className="pill">
            <span className="set-label">Set</span>
            <select value={setKey} onChange={e => { setSetKey(e.target.value as SetKey); }}>
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
                  const card = byNumber.get(s.number);
                  const typeText = card?.Type ? card.Type : '';

                  // show base + alt numbers for BOTH kinds
                  const nums = baseToAll.get(s.number) || [s.number];
                  const numsLabel = nums.map((n) => `#${n}`).join(', ');

                  return (
                    <div
                      key={`${s.kind}:${s.number}`}
                      className={`sug-item ${i === highlightIdx ? 'active' : ''}`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onMouseDown={(e) => { e.preventDefault(); onChoose(s); }}
                      role="option"
                      aria-selected={i === highlightIdx}
                    >
                      <span className="sug-name">
                        {s.name}
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
              {/* Import (uses your hidden file input via ref) */}
              <button
                className="tbtn"
                onClick={() => importRef.current?.click()}
                title="Import inventory JSON"
                aria-label="Import inventory JSON"
              >
                <span className="icon" aria-hidden="true">upload</span>
                <span>Import…</span>
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files && importAllInv(e.target.files[0])}
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
                onClick={() => resetInv()}
                title="Reset all inventory"
                aria-label="Reset all inventory"
              >
                <span className="icon" aria-hidden="true">delete</span>
                <span>Reset</span>
              </button>
            </div>
          </div>

          {error && <span className="err">{error}</span>}
        </div>
      </div>
      
      {/* Binder (with spread pager + dropdown) */}
      <div className="card">
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
        />
      </div>

      {/* Inventory table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent:'space-between', alignItems: 'center' }}>
          <div className="title" style={{ margin: 0 }}>
            {listView === 'inventory' ? 'Inventory' : 'Missing Cards'}
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <div className="toolbar-group" role="tablist" aria-label="Inventory view">
              <button
                className="tbtn"
                role="tab"
                aria-selected={listView === 'inventory'}
                onClick={() => setListView('inventory')}
                title="Show your current inventory"
              >
                Inventory
              </button>
              <button
                className="tbtn"
                role="tab"
                aria-selected={listView === 'missing'}
                onClick={() => setListView('missing')}
                title="Show cards you don’t have yet"
              >
                Missing
              </button>
            </div>
            <div className="muted"
              style={{
                width: '300px',        // ← choose a width wide enough for longest string
                textAlign: 'right',    // keeps text tidy
                whiteSpace: 'nowrap',  // prevents wrapping
              }}
            >
            {listView === 'missing' ? (
              <div className="muted" aria-live="polite">
                Cost to Complete: {fmtUSD(missingCost)}
              </div>
            ) : (
              <div className="muted">
                Tip: counts auto-save, and you can export/import JSON.
              </div>
            )}
            </div>
          </div>
        </div>

        {listView === 'inventory' ? (
          invRows.length ? (
            <div className="inventory-scroll">
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
                  {invRows.map(r => {
                    const dot = numToColor.get(r.Number);
                    const card = byNumber.get(r.Number) || cardsAll.find(x => x.Number === r.Number);
                    const complete = r.Qty >= r.Max;
                    return (
                      <tr key={r.Number}>
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
                        <td>{r.Name}</td>
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
            <div className="muted">No entries yet. Click any slot’s +/− or use this table once you add cards.</div>
          )
        ) : (
          <div className="inventory-scroll">
            {missingRows.length ? (
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
                  {missingRows.map(r => {
                    const dot = numToColor.get(r.Number);
                    const card = byNumber.get(r.Number) || cardsAll.find(x => x.Number === r.Number);
                    return (
                      <tr key={r.Number}>
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
                        <td>{r.Name}</td>
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
                            {/* Adds to the base number; if you prefer to pick a specific printing, we can add a chooser later */}
                            <button
                              className="plus"
                              aria-label={`Add one ${r.Name}`}
                              onClick={()=>inc(r.Number)}
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
            ) : (
              <div className="muted">Nothing missing — nice!</div>
            )}
          </div>
        )}
      </div>
    </div>
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
}: {
  viewSpread: number;
  setViewSpread: React.Dispatch<React.SetStateAction<number>>;
  totalSpreads: number;
  active: { card: Card; page: number; row: number; column: number } | null;
  setActive: (v: { card: Card; page: number; row: number; column: number } | null)=>void;
  presentNumbers: Set<number>;
  numToColor: Map<number, string>;
  byNumber: Map<number, Card>;
  inventory: Inventory;
  inc: (n:number)=>void;
  dec: (n:number)=>void;
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
              <div className="big" style={{ fontSize: 20 }}>{active.card.Name}</div>
              <span className="pill">Page {active.page}</span>
              <span className="pill">Row {active.row}</span>
              <span className="pill">Column {active.column}</span>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 25 }}>No card selected</div>
          )}
        </div>

        {/* right: tip */}
        <div className="muted" style={{ whiteSpace: 'nowrap' }}>
          Tip: Click a card, then press <b>+</b>/<b>&minus;</b> to adjust quantity. Press <b>Esc</b> to clear.
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
        <div className="binder-subtitle">Binder — {spreadLabel}</div>
        <div className="pager">
          <button className="btn" onClick={() => setViewSpread(s => Math.max(0, s - 1))}>‹ Prev</button>
          <select value={viewSpread} onChange={e => setViewSpread(Number(e.target.value))}>
            {spreadOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn" onClick={() => setViewSpread(s => Math.min(totalSpreads - 1, s + 1))}>Next ›</button>
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
                      setActive({ card, page: bp, row: br, column: bc });
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
                        {/* TOP-LEFT: Type then Name (Name clamped to 2 lines) */}
                        <g transform={`translate(${x + 10}, ${y + 10})`} style={{ pointerEvents: 'none' }}>
                          <foreignObject width={cellW - 20} height={48}>
                            <div
                                style={{
                                  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
                                  color: labelColor,
                                  lineHeight: 1.18,
                                  display: 'flex', flexDirection: 'column', gap: 2,
                                }}>
                              <div style={{ fontSize: 10, opacity: 0.85 }}>{cardAt?.Type || ''}</div>
                              <div style={{
                                fontSize: 12, fontWeight: 600,
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: NAME_MAX_LINES,
                                WebkitBoxOrient: 'vertical',
                              }}>
                                {cardAt?.Name}
                              </div>
                            </div>
                          </foreignObject>
                        </g>

                        {/* CENTER: big quantity, centered */}
                        <text
                          x={x + cellW / 2}
                          y={y + cellH / 2 - QTY_Y_OFFSET}
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
                          transform={`translate(${x + (cellW - GROUP_W) / 2}, ${y + cellH / 2 + 10})`}
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
      </div>
    </>
  );
}
