import React, { useEffect, useMemo, useRef, useState } from 'react';

type Card = { Name: string; Number: number; Aspects?: string[]; Type?: string };
type SetKey = 'SOR' | 'SHD' | 'TWI' | 'JTL' | 'LOF';
type Inventory = Record<number, number>;

const SETS: Record<SetKey, { label: string; file: string }> = {
  SOR: { label: 'Spark of Rebellion (SOR)', file: '/sets/SWU-SOR.json' },
  SHD: { label: 'Shadows of the Galaxy (SHD)', file: '/sets/SWU-SHD.json' },
  TWI: { label: 'Twilight of the Republic (TWI)', file: '/sets/SWU-TWI.json' },
  JTL: { label: 'Jump to Lightspeed (JTL)', file: '/sets/SWU-JTL.json' },
  LOF: { label: 'Legacy of the Force (LOF)', file: '/sets/SWU-LOF.json' },
};

const SET_KEYS: SetKey[] = ['SOR','SHD','TWI','JTL','LOF'];

const ASPECT_HEX: Record<string, string> = {
  Vigilance: '#3b82f6', // blue
  Command:   '#22c55e', // green
  Aggression:'#ef4444', // red
  Cunning:   '#f59e0b', // yellow
  Heroism:   '#e5e7eb', // white
  Villainy:  '#0b0b0b', // black
};
const NEUTRAL = '#2f3545'; // for numbers that exist but have no aspect

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
  const [setKey, setSetKey] = useState<SetKey>('LOF');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Data variants
  const [cardsAll, setCardsAll] = useState<Card[]>([]);     // unique by Number (used to color pages)
  const [cardsBase, setCardsBase] = useState<Card[]>([]);   // base printing per Name (lowest Number)

  // Quick lookups
  const byNumber = useMemo(() => new Map(cardsAll.map(c => [c.Number, c])), [cardsAll]);
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

  // UI state
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<{ card: Card; page: number; row: number; column: number } | null>(null);

  // Spreads (instead of pages)
  const maxNumber = useMemo(() => cardsAll.reduce((m,c)=>Math.max(m,c.Number), 0), [cardsAll]);
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

      const meta = SETS[setKey];
      const res = await fetch(meta.file);
      const obj = await res.json();
      const data = Array.isArray(obj) ? obj : obj.data;

      const mapped: Card[] = data.map((c: any) => ({
        Name: String(c.Name || '').trim(),
        Number: Number(c.Number),
        Aspects: Array.isArray(c.Aspects) ? c.Aspects : [],
        Type: typeof c.Type === 'string' ? c.Type : (typeof c.Type?.Name === 'string' ? c.Type.Name : undefined)
      })).filter((c: Card) => !!c.Name && Number.isFinite(c.Number));

      // unique by Number (prefer entries that have an Aspect)
      const byNum = new Map<number, Card>();
      for (const c of mapped.sort((a,b) => {
        const hasA = (a.Aspects?.length ?? 0) > 0 ? 1 : 0;
        const hasB = (b.Aspects?.length ?? 0) > 0 ? 1 : 0;
        return hasB - hasA || a.Number - b.Number;
      })) {
        if (!byNum.has(c.Number)) byNum.set(c.Number, c);
      }
      setCardsAll(Array.from(byNum.values()).sort((a,b)=>a.Number-b.Number));

      // base printing per Name (lowest Number)
      const best = new Map<string, Card>();
      for (const c of mapped) {
        const prev = best.get(c.Name);
        if (!prev || c.Number < prev.Number) best.set(c.Name, c);
      }
      setCardsBase(Array.from(best.values()).sort((a,b)=>a.Number-b.Number));
    }
    load().catch(() => setError('Failed to load set data.'));
  }, [setKey]);

  // Build coloring map + presence
  const presentNumbers = useMemo(() => new Set(cardsAll.map(c => c.Number)), [cardsAll]);
  const numToColor = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cardsAll) {
      const a = c.Aspects?.[0];
      if (a && ASPECT_HEX[a]) m.set(c.Number, ASPECT_HEX[a]);
    }
    return m;
  }, [cardsAll]);

  // Suggestions (name or number)
  type Suggestion = { kind: 'name' | 'number'; label: string; number: number; name: string };
  const suggestions: Suggestion[] = useMemo(() => {
    const raw = query.trim();
    if (!raw) return [];
    const isDigits = /^[0-9]+$/.test(raw);

    if (isDigits) {
      const qnorm = raw.replace(/^0+/, '') || '0';   // <-- new
      return cardsAll
        .filter(c => {
          const s = String(c.Number);
          return s.startsWith(raw) || s.startsWith(qnorm);   // <-- new
        })
        .slice(0, 10)
        .map(c => ({ kind: 'number', label: `#${c.Number} — ${c.Name}`, number: c.Number, name: c.Name }));
    }

    // (name path unchanged)
    const lower = raw.toLowerCase();
    return cardsBase
      .map(c => ({ c, idx: c.Name.toLowerCase().indexOf(lower) }))
      .filter(o => o.idx >= 0)
      .sort((a,b) => a.idx - b.idx || a.c.Name.localeCompare(b.c.Name))
      .slice(0, 10)
      .map(o => ({ kind: 'name', label: `${o.c.Name} — #${o.c.Number}`, number: o.c.Number, name: o.c.Name }));
  }, [query, cardsAll, cardsBase]);

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
    const baseCard = resolveToBase(n);
    if (!baseCard) { setError('Number not found in this set.'); return; }
    const { page, row, column } = binderLayout(baseCard.Number);
    setActive({ card: baseCard, page, row, column });
    setError('');
    setViewSpread(pageToSpread(page)); // jump to spread
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
    const payload: InventoryAll = {
      version: 1,
            sets: Object.fromEntries(SET_KEYS.map(k => [k, readSetInv(k)])) as Record<SetKey, Inventory>
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'swu-inventory-all-sets.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importAllInv(file: File) {
    file.text().then(txt => {
      try {
        const raw = JSON.parse(txt);
        const sets: Partial<Record<SetKey, Inventory>> =
          raw?.version === 1 && raw?.sets ? raw.sets :
          Object.fromEntries(SET_KEYS.map(k => [k, raw?.[k] || {}]));

        SET_KEYS.forEach(k => {
          if (sets[k]) writeSetInv(k, pruneZeros(sets[k]!));
        });
        if (sets[setKey]) setInventory(pruneZeros(sets[setKey]!));
      } catch {
        alert('Import failed: invalid JSON format.');
      }
    });
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

  return (
    <div className="container">
      {/* Top bar (no page control here anymore) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 className="title">SWU Binder Organizer</h1>
        <div className="row" style={{ marginTop: 8 }} ref={boxRef}>
          <label className="pill">
            <span style={{ opacity: .7, marginRight: 8 }}>Set</span>
            <select value={setKey} onChange={e => { setSetKey(e.target.value as SetKey); }}>
              {Object.entries(SETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
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
            {openSug && suggestions.length > 0 && (
              <div className="sug">
                {suggestions.map((s, i) => (
                  <div
                    key={s.label}
                    className={`sug-item ${i === highlightIdx ? 'active' : ''}`}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onMouseDown={(e) => { e.preventDefault(); onChoose(s); }}
                  >
                    <span className="sug-name">{s.name}</span>
                    <span className="sug-num">#{s.number}</span>
                    <span className="sug-kind">{s.kind === 'number' ? 'num' : 'name'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <a href="#" className="btn" onClick={(e) => { e.preventDefault(); onEnter(); }}>Go</a>

          <div style={{ marginLeft: 'auto' }}>
            <div className="toolbar-group">
              {/* Import (button triggers hidden input) */}
              <button
                className="tbtn"
                title="Import all-set inventory JSON"
                onClick={() => importRef.current?.click()}
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l4 4h-3v8h-2V7H8l4-4z"/><path d="M5 19h14v2H5z"/>
                </svg>
                <span>Import…</span>
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files && importAllInv(e.target.files[0])}
              />

              {/* Export */}
              <button
                className="tbtn"
                title="Export all sets to JSON"
                onClick={() => exportAllInv()}
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 21l-4-4h3V5h2v12h3l-4 4z"/><path d="M5 3h14v2H5z"/>
                </svg>
                <span>Download</span>
              </button>

              {/* Reset */}
              <button
                className="tbtn tbtn-danger"
                title="Reset inventory for current set"
                onClick={() => resetInv()}
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3h6l1 2h3v2h-1l-1 12a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 7H6V5h3l1-2z"/>
                </svg>
                <span>Reset Inventory</span>
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
          resolveToBase={(n:number)=>{
            const found = byNumber.get(n);
            if (!found) return null;
            const base = baseByName.get(found.Name);
            return base || found;
          }}
          inventory={inventory}
          inc={inc}
          dec={dec}
        />
      </div>

      {/* Inventory table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent:'space-between' }}>
          <div className="title" style={{ margin: 0 }}>Inventory</div>
          <div className="muted">Tip: counts auto-save per set to your browser, and you can export/import JSON.</div>
        </div>
        {invRows.length ? (
          <table className="table">
            <thead>
              <tr><th>#</th><th>Name</th><th>Type</th><th>Qty</th><th>Max</th><th>Adjust</th></tr>
            </thead>
            <tbody>
              {invRows.map(r => (
                <tr key={r.Number}>
                  <td className="mono">#{r.Number}</td>
                  <td>{r.Name}</td>
                  <td>{r.Type || ''}</td>
                  <td className="mono">{r.Qty}</td>
                  <td className="mono">{r.Max}</td>
                  <td>
                    <div className="qtybtns small">
                      <button onClick={()=>dec(r.Number)}>-</button>
                      <button onClick={()=>inc(r.Number)}>+</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="muted">No entries yet. Click any slot’s +/− or use this table once you add cards.</div>}
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
  resolveToBase,
  inventory,
  inc,
  dec,
}: {
  viewSpread: number;
  setViewSpread: (s:number)=>void;
  totalSpreads: number;
  active: { card: Card; page: number; row: number; column: number } | null;
  setActive: (v: { card: Card; page: number; row: number; column: number } | null)=>void;
  presentNumbers: Set<number>;
  numToColor: Map<number, string>;
  byNumber: Map<number, Card>;
  resolveToBase: (n:number)=>Card|null;
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
      {/* Selected card row (small) */}
      {active && (
        <div className="row" style={{ marginBottom: 6, alignItems: 'center', gap: 10 }}>
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
        </div>
      )}

      {/* Binder header with small subtitle + spread controls */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div className="binder-subtitle">Binder — {spreadLabel}</div>
        <div className="pager">
          <button className="btn" onClick={()=>setViewSpread(s=>Math.max(0, s-1))}>‹ Prev</button>
          <select
            value={viewSpread}
            onChange={(e)=>setViewSpread(Number(e.target.value))}
          >
            {spreadOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn" onClick={()=>setViewSpread(s=>Math.min(totalSpreads-1, s+1))}>Next ›</button>
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
                      if (hidden) return;
                      if (!presentNumbers.has(n)) return;
                      const base = resolveToBase(n);
                      if (!base) return;
                      const { page: bp, row: br, column: bc } = binderLayout(base.Number);
                      setActive({ card: base, page: bp, row: br, column: bc });
                      setViewSpread(pageToSpread(bp)); // jump to spread
                    }}
                  >
                    {/* the card rectangle */}
                    <rect
                      x={x} y={y} width={cellW} height={cellH} rx="16"
                      fill={fill} opacity={opacity}
                      stroke={stroke} strokeWidth={strokeWidth}
                    />

                    {(() => {
                      // pick label color; invert on Heroism white (#e5e7eb)
                      const labelColor =
                        String(fill).toLowerCase() === '#e5e7eb' ? '#11121a' : '#eaeaf0';

                      return (
                        <>
                          {/* Name + Type label (top-left), truncated */}
                          {cardAt && !hidden && presentNumbers.has(n) && (
                            <g transform={`translate(${x + 10}, ${y + 28})`} style={{ pointerEvents: 'none' }}>
                              <foreignObject width={cellW - 20} height={50}>
                                <div
                                  xmlns="http://www.w3.org/1999/xhtml"
                                  style={{
                                    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2,
                                    lineHeight: 1.18,
                                    paddingBottom: 4,                            // extra breathing room for descenders
                                    color: (String(fill).toLowerCase() === '#e5e7eb') ? '#11121a' : '#eaeaf0', // invert on white
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {cardAt.Name}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      opacity: 0.85,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      marginTop: 3,                               // nudge type down
                                      transform: 'translateY(1px)',               // guard against clipping on some browsers
                                    }}
                                  >
                                    {cardAt.Type || ''}
                                  </div>
                                </div>
                              </foreignObject>
                            </g>
                          )}

                          {/* Card number (top-right) */}
                          {!hidden && presentNumbers.has(n) && (
                            <text
                              x={x + cellW - 10}
                              y={y + 18}
                              textAnchor="end"
                              fontSize="12"
                              fill={labelColor}
                              style={{ pointerEvents: 'none' }}
                            >
                              #{n}
                            </text>
                          )}

                          {/* Qty text (bottom-right) */}
                          {!hidden && presentNumbers.has(n) && (
                            <>
                              <text
                                x={x + cellW - 10}
                                y={y + cellH - 12}
                                textAnchor="end"
                                fontSize="16"
                                fill={labelColor}
                                style={{ pointerEvents: 'none' }}
                              >
                                {qtyText}
                              </text>

                              {/* +/- controls (don’t let clicks bubble) */}
                              <g transform={`translate(${x + 10}, ${y + cellH - 36})`} onClick={(e)=>e.stopPropagation()}>
                                <foreignObject width="64" height="26">
                                  <div xmlns="http://www.w3.org/1999/xhtml" className="qtybtns">
                                    <button onClick={()=>dec(n)}>-</button>
                                    <button onClick={()=>inc(n)}>+</button>
                                  </div>
                                </foreignObject>
                              </g>
                            </>
                          )}
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
              stroke="#c8ccd9"            // a bit lighter
              strokeWidth={5}             // thicker
              strokeDasharray="0 18"      // dotted pattern
              strokeLinecap="round"       // make dots round
              vectorEffect="non-scaling-stroke" // keep thickness consistent when SVG scales
            />
          </g>
        </svg>
      </div>
    </>
  );
}
