import React from 'react'
import type { CanonicalCatalog } from '../core/inventory'
import type { SetKey } from '../core/types'
import {
  computeDeckRows,
  formatMissingCardsList,
  parseDeckList,
  resolveDeckList,
  type DeckLookupSet,
  type DeckResolution,
  type DeckRowWithNeed,
} from '../core/decklist'
import { allCardRefs, deckContentsFromRows, type DeckCardRef, type DeckContents } from '../core/deckContents'
import { createSavedDeck, type DeckLibrary, type SavedDeck } from '../core/decks'
import type { PreconCatalogEntry } from '../core/precons'
import { DeckRowsTable } from './DeckRowsTable'

type Props = {
  preconCatalog: PreconCatalogEntry[]
  deckLibrary: DeckLibrary
  onTogglePrecon: (key: string) => void
  onSaveDeck: (deck: SavedDeck) => void
  onUpdateDeck: (id: string, patch: Partial<Pick<SavedDeck, 'name' | 'physical' | 'copies'>>) => void
  onDeleteDeck: (id: string) => void
  canonicalCatalog: CanonicalCatalog
  parsedSets: Map<SetKey, DeckLookupSet>
  trackedSetKeys: SetKey[]
  buildOwnedLookup: () => (setKey: SetKey, baseNumber: number) => number
  showToast: (message: string, kind?: 'success' | 'error' | 'warning') => void
}

const inputStyle: React.CSSProperties = {
  background: '#0f1017',
  color: '#eaeaf0',
  border: '1px solid #2b2d3d',
  borderRadius: 8,
  padding: '6px 10px',
}

function cardRefToRow(
  ref: DeckCardRef,
  role: 'leader' | 'base' | 'deck' | 'sideboard',
  parsedSets: Map<SetKey, DeckLookupSet>,
  ownedByBase: (setKey: SetKey, baseNumber: number) => number,
): DeckRowWithNeed | null {
  const card = parsedSets.get(ref.setKey)?.byNumber.get(ref.baseNumber)
  if (!card) return null
  const have = ownedByBase(ref.setKey, ref.baseNumber)
  const price = Number(card.MarketPrice ?? 0)
  const needed = Math.max(0, ref.count - have)
  return {
    role,
    count: ref.count,
    setKey: ref.setKey,
    baseNumber: ref.baseNumber,
    name: card.Name,
    subtitle: card.Subtitle,
    type: card.Type,
    price,
    ambiguous: false,
    have,
    needed,
    rowCost: needed * price,
  }
}

function contentsToRows(
  contents: DeckContents,
  parsedSets: Map<SetKey, DeckLookupSet>,
  ownedByBase: (setKey: SetKey, baseNumber: number) => number,
): DeckRowWithNeed[] {
  const roled: Array<[DeckCardRef, 'leader' | 'base' | 'deck' | 'sideboard']> = [[contents.leader, 'leader']]
  if (contents.secondLeader) roled.push([contents.secondLeader, 'leader'])
  roled.push([contents.base, 'base'])
  for (const ref of contents.mainDeck) roled.push([ref, 'deck'])
  for (const ref of contents.sideboard) roled.push([ref, 'sideboard'])

  const rows: DeckRowWithNeed[] = []
  for (const [ref, role] of roled) {
    const row = cardRefToRow(ref, role, parsedSets, ownedByBase)
    if (row) rows.push(row)
  }
  return rows
}

function cardsNeeded(contents: DeckContents, ownedByBase: (setKey: SetKey, baseNumber: number) => number): number {
  let needed = 0
  for (const ref of allCardRefs(contents)) needed += Math.max(0, ref.count - ownedByBase(ref.setKey, ref.baseNumber))
  return needed
}

function copyToClipboard(text: string, showToast: Props['showToast'], label: string) {
  navigator.clipboard.writeText(text).then(
    () => showToast(`${label} copied to clipboard.`, 'success'),
    () => showToast('Copy failed.', 'error'),
  )
}

function DeckImportForm({
  canonicalCatalog,
  parsedSets,
  trackedSetKeys,
  buildOwnedLookup,
  onSaveDeck,
  showToast,
  onDone,
}: Pick<Props, 'canonicalCatalog' | 'parsedSets' | 'trackedSetKeys' | 'buildOwnedLookup' | 'onSaveDeck' | 'showToast'> & {
  onDone: () => void
}) {
  const [text, setText] = React.useState('')
  const [resolution, setResolution] = React.useState<DeckResolution | null>(null)
  const [name, setName] = React.useState('')
  const [physical, setPhysical] = React.useState(false)
  const [copies, setCopies] = React.useState(1)

  function handleResolve() {
    if (!text.trim()) {
      showToast('Paste a decklist first.', 'warning')
      return
    }
    if (canonicalCatalog.size === 0) {
      showToast('Card catalog is still loading. Please try again.', 'warning')
      return
    }
    const parsed = parseDeckList(text)
    const owned = buildOwnedLookup()
    const resolved = resolveDeckList(parsed, canonicalCatalog, parsedSets, trackedSetKeys, owned)
    setResolution(resolved)
    setName(resolved.deckName ?? '')
  }

  function handleSave() {
    if (!resolution) return
    const result = createSavedDeck(resolution.rows, { name, physical, copies, sourceText: text })
    if (!result.ok) {
      showToast(
        result.reason === 'missing-leader'
          ? "This decklist doesn't have a leader — it can't be saved yet."
          : "This decklist doesn't have a base — it can't be saved yet.",
        'warning',
      )
      return
    }
    onSaveDeck(result.deck)
    showToast('Deck saved.', 'success')
    onDone()
  }

  const owned = React.useMemo(() => buildOwnedLookup(), [buildOwnedLookup])
  const previewRows = resolution ? computeDeckRows(resolution.rows, owned) : []

  return (
    <div className="card" style={{ padding: 12, marginTop: 8 }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste your decklist here…"
        rows={6}
        style={{ width: '100%', boxSizing: 'border-box', ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 13, resize: 'vertical' }}
      />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button type="button" className="tbtn" onClick={handleResolve}>
          <span className="icon" aria-hidden="true">checklist</span>
          <span>Resolve</span>
        </button>
      </div>

      {resolution && (
        <>
          {previewRows.length > 0 && <DeckRowsTable rows={previewRows} />}
          {resolution.unresolved.length > 0 && (
            <p className="muted">{resolution.unresolved.length} line(s) couldn't be matched to a card.</p>
          )}
          <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Deck name"
              style={{ ...inputStyle, minWidth: 200 }}
            />
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={physical} onChange={e => setPhysical(e.target.checked)} />
              <span title="Turn this on if this deck is physically built/boxed and not counted in your binder.">
                Physical (owned outside my binder)
              </span>
            </label>
            {physical && (
              <label className="row" style={{ gap: 6 }}>
                <span>Copies</span>
                <input
                  type="number"
                  min={1}
                  value={copies}
                  onChange={e => setCopies(Math.max(1, Number(e.target.value) || 1))}
                  style={{ ...inputStyle, width: 60 }}
                />
              </label>
            )}
            <button type="button" className="tbtn" onClick={handleSave}>
              <span className="icon" aria-hidden="true">save</span>
              <span>Save deck</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function PreconJsonBuilder({
  canonicalCatalog,
  parsedSets,
  trackedSetKeys,
  showToast,
}: Pick<Props, 'canonicalCatalog' | 'parsedSets' | 'trackedSetKeys' | 'showToast'>) {
  const [text, setText] = React.useState('')
  const [resolution, setResolution] = React.useState<DeckResolution | null>(null)
  const [key, setKey] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [setKeyInput, setSetKeyInput] = React.useState('')
  const [aspect, setAspect] = React.useState('Heroism')

  function handleResolve() {
    if (!text.trim()) {
      showToast('Paste a precon decklist first.', 'warning')
      return
    }
    if (canonicalCatalog.size === 0) {
      showToast('Card catalog is still loading. Please try again.', 'warning')
      return
    }
    const parsed = parseDeckList(text)
    const resolved = resolveDeckList(parsed, canonicalCatalog, parsedSets, trackedSetKeys, () => 0)
    setResolution(resolved)
  }

  const contentsResult = resolution ? deckContentsFromRows(resolution.rows) : null

  function handleCopyFile() {
    if (!contentsResult?.ok) return
    copyToClipboard(JSON.stringify(contentsResult.contents, null, 2), showToast, 'Precon deck JSON')
  }

  function handleCopyManifestEntry() {
    if (!key.trim()) {
      showToast('Enter a key first (e.g. SOR-heroism).', 'warning')
      return
    }
    const entry = { key: key.trim(), label: label.trim() || key.trim(), setKey: setKeyInput.trim().toUpperCase(), aspect, file: `${key.trim()}.json` }
    copyToClipboard(JSON.stringify(entry, null, 2), showToast, 'Manifest entry')
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Paste a precon's decklist to generate the JSON files for <code>public/precons/</code>. This is a
        one-time authoring step per precon — nothing here is saved automatically; copy the output and commit
        it yourself.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste the precon's decklist here…"
        rows={6}
        style={{ width: '100%', boxSizing: 'border-box', ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 13, resize: 'vertical' }}
      />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button type="button" className="tbtn" onClick={handleResolve}>
          <span className="icon" aria-hidden="true">checklist</span>
          <span>Resolve</span>
        </button>
      </div>

      {resolution && (
        <>
          {resolution.unresolved.length > 0 && (
            <p className="muted">{resolution.unresolved.length} line(s) couldn't be matched to a card.</p>
          )}
          {contentsResult && !contentsResult.ok && (
            <p className="err">
              Missing a {contentsResult.reason === 'missing-leader' ? 'leader' : 'base'} — this decklist can't
              become a precon file yet.
            </p>
          )}
          {contentsResult?.ok && (
            <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="text" value={key} onChange={e => setKey(e.target.value)} placeholder="Key (e.g. SOR-heroism)" style={{ ...inputStyle, minWidth: 180 }} />
              <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" style={{ ...inputStyle, minWidth: 200 }} />
              <input type="text" value={setKeyInput} onChange={e => setSetKeyInput(e.target.value)} placeholder="Set key (e.g. SOR)" style={{ ...inputStyle, width: 120 }} />
              <input
                type="text"
                list="precon-aspect-options"
                value={aspect}
                onChange={e => setAspect(e.target.value)}
                placeholder="Aspect (e.g. Heroism, Villainy, Twin Suns)"
                style={{ ...inputStyle, minWidth: 160 }}
              />
              <datalist id="precon-aspect-options">
                <option value="Heroism" />
                <option value="Villainy" />
                <option value="Twin Suns" />
              </datalist>
              <button type="button" className="tbtn" onClick={handleCopyFile}>
                <span className="icon" aria-hidden="true">content_copy</span>
                <span>Copy deck JSON</span>
              </button>
              <button type="button" className="tbtn" onClick={handleCopyManifestEntry}>
                <span className="icon" aria-hidden="true">content_copy</span>
                <span>Copy manifest entry</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SavedDeckRow({
  deck,
  needed,
  expanded,
  onToggleExpand,
  onUpdateDeck,
  onDeleteDeck,
  rows,
  showToast,
}: {
  deck: SavedDeck
  needed: number
  expanded: boolean
  onToggleExpand: () => void
  onUpdateDeck: Props['onUpdateDeck']
  onDeleteDeck: Props['onDeleteDeck']
  rows: DeckRowWithNeed[]
  showToast: Props['showToast']
}) {
  function handleCopyMissing() {
    const list = formatMissingCardsList(rows, true)
    if (!list) {
      showToast('No missing cards to copy!', 'warning')
      return
    }
    copyToClipboard(list, showToast, 'Missing cards')
  }

  return (
    <div className="card" style={{ padding: 12, marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="tbtn" onClick={onToggleExpand} style={{ fontWeight: 700 }}>
          <span className="icon" aria-hidden="true">{expanded ? 'expand_less' : 'expand_more'}</span>
          <span>{deck.name}</span>
        </button>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="pill">{deck.physical ? `Physical × ${deck.copies}` : 'Reference'}</span>
          <span className="pill">Needed: {needed}</span>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={deck.physical}
              onChange={e => onUpdateDeck(deck.id, { physical: e.target.checked })}
            />
            <span>Physical</span>
          </label>
          {deck.physical && (
            <input
              type="number"
              min={1}
              value={deck.copies}
              onChange={e => onUpdateDeck(deck.id, { copies: Math.max(1, Number(e.target.value) || 1) })}
              style={{ ...inputStyle, width: 56 }}
            />
          )}
          <button type="button" className="tbtn" onClick={handleCopyMissing} aria-label={`Copy missing cards for ${deck.name}`}>
            <span className="icon" aria-hidden="true">content_paste</span>
            <span>Copy missing</span>
          </button>
          <button type="button" className="tbtn" onClick={() => onDeleteDeck(deck.id)} aria-label={`Delete ${deck.name}`}>
            <span className="icon" aria-hidden="true">delete</span>
          </button>
        </div>
      </div>
      {expanded && <DeckRowsTable rows={rows} />}
    </div>
  )
}

export function DecksView({
  preconCatalog,
  deckLibrary,
  onTogglePrecon,
  onSaveDeck,
  onUpdateDeck,
  onDeleteDeck,
  canonicalCatalog,
  parsedSets,
  trackedSetKeys,
  buildOwnedLookup,
  showToast,
}: Props) {
  const ownedByBase = React.useMemo(() => buildOwnedLookup(), [buildOwnedLookup])
  const [expandedPrecon, setExpandedPrecon] = React.useState<string | null>(null)
  const [expandedDeckId, setExpandedDeckId] = React.useState<string | null>(null)
  const [showImport, setShowImport] = React.useState(false)

  const preconsBySet = React.useMemo(() => {
    const groups = new Map<SetKey, PreconCatalogEntry[]>()
    for (const entry of preconCatalog) {
      const list = groups.get(entry.setKey) ?? []
      list.push(entry)
      groups.set(entry.setKey, list)
    }
    return groups
  }, [preconCatalog])

  return (
    <div>
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Precon decks I own</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Check off the preconstructed decks you own. Their cards count as "owned" in Deck Check, on top of
          your binders — without being added to your binder inventory.
        </p>
        {preconCatalog.length === 0 ? (
          <p className="muted">
            No precon decks in the catalog yet. Use "Build precon JSON" below to add one to{' '}
            <code>public/precons/</code>.
          </p>
        ) : (
          [...preconsBySet.entries()].map(([setKey, entries]) => (
            <div key={setKey} style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="pill">{setKey}</span>
              </div>
              {entries.map(entry => {
                const owned = (deckLibrary.preconOwnership[entry.key] ?? 0) > 0
                const isExpanded = expandedPrecon === entry.key
                return (
                  <div key={entry.key} style={{ marginTop: 6 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <label className="row" style={{ gap: 6 }}>
                        <input type="checkbox" checked={owned} onChange={() => onTogglePrecon(entry.key)} />
                        <span>{entry.label}</span>
                      </label>
                      <span className="pill">{entry.aspect}</span>
                      <button
                        type="button"
                        className="tbtn"
                        onClick={() => setExpandedPrecon(isExpanded ? null : entry.key)}
                      >
                        <span>{isExpanded ? 'Hide' : 'View'} contents</span>
                      </button>
                    </div>
                    {isExpanded && <DeckRowsTable rows={contentsToRows(entry.contents, parsedSets, ownedByBase)} />}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>My decks</h3>
          <button type="button" className="tbtn" onClick={() => setShowImport(v => !v)}>
            <span className="icon" aria-hidden="true">add</span>
            <span>Import deck</span>
          </button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Save decklists for reuse. Reference decks don't add to your owned totals (their cards are assumed
          to already be in your binder or a physical deck); mark a deck Physical if it's fully built/boxed
          on its own.
        </p>

        {showImport && (
          <DeckImportForm
            canonicalCatalog={canonicalCatalog}
            parsedSets={parsedSets}
            trackedSetKeys={trackedSetKeys}
            buildOwnedLookup={buildOwnedLookup}
            onSaveDeck={deck => {
              onSaveDeck(deck)
              setShowImport(false)
            }}
            showToast={showToast}
            onDone={() => setShowImport(false)}
          />
        )}

        {deckLibrary.customDecks.length === 0 ? (
          <p className="muted">No saved decks yet.</p>
        ) : (
          deckLibrary.customDecks.map(deck => (
            <SavedDeckRow
              key={deck.id}
              deck={deck}
              needed={cardsNeeded(deck, ownedByBase)}
              expanded={expandedDeckId === deck.id}
              onToggleExpand={() => setExpandedDeckId(expandedDeckId === deck.id ? null : deck.id)}
              onUpdateDeck={onUpdateDeck}
              onDeleteDeck={onDeleteDeck}
              rows={contentsToRows(deck, parsedSets, ownedByBase)}
              showToast={showToast}
            />
          ))
        )}
      </div>

      <details className="card" style={{ padding: 16, marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Build precon JSON (data authoring helper)</summary>
        <div style={{ marginTop: 12 }}>
          <PreconJsonBuilder
            canonicalCatalog={canonicalCatalog}
            parsedSets={parsedSets}
            trackedSetKeys={trackedSetKeys}
            showToast={showToast}
          />
        </div>
      </details>
    </div>
  )
}
