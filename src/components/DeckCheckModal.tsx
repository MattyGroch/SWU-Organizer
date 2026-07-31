import React from 'react'
import type { CanonicalCatalog } from '../core/inventory'
import type { SetKey } from '../core/types'
import {
  computeDeckRows,
  detectDeckFormat,
  formatMissingCardsList,
  parseDeckList,
  resolveDeckList,
  summarizeDeck,
  type DeckLookupSet,
  type DeckResolution,
  type DeckRowWithNeed,
} from '../core/decklist'
import { DeckRowsTable } from './DeckRowsTable'
import { createSavedDeck, type SavedDeck } from '../core/decks'

type Props = {
  canonicalCatalog: CanonicalCatalog
  parsedSets: Map<SetKey, DeckLookupSet>
  trackedSetKeys: SetKey[]
  buildOwnedLookup: () => (setKey: SetKey, baseNumber: number) => number
  showToast: (message: string, kind?: 'success' | 'error' | 'warning') => void
  onSaveDeck: (deck: SavedDeck) => void
  onClose: () => void
  ownershipScope: 'combined' | 'bindersOnly'
  onOwnershipScopeChange: (scope: 'combined' | 'bindersOnly') => void
}

const FORMAT_LABEL: Record<DeckResolution['format'], string> = {
  json: 'JSON',
  melee: 'Melee text',
  picklist: 'Picklist',
  generic: 'Plain list',
}

const REASON_LABEL: Record<'unknown-set' | 'no-name-match' | 'malformed', string> = {
  'unknown-set': 'Set not tracked or printing not found',
  'no-name-match': 'No matching card found by name',
  malformed: 'Could not parse this line',
}

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

export function DeckCheckModal({
  canonicalCatalog,
  parsedSets,
  trackedSetKeys,
  buildOwnedLookup,
  showToast,
  onSaveDeck,
  onClose,
  ownershipScope,
  onOwnershipScopeChange,
}: Props) {
  const [text, setText] = React.useState('')
  const [resolution, setResolution] = React.useState<DeckResolution | null>(null)
  const [rows, setRows] = React.useState<DeckRowWithNeed[]>([])
  const [includeSideboard, setIncludeSideboard] = React.useState(false)
  const [copyFeedback, setCopyFeedback] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const copyFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showSaveForm, setShowSaveForm] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')
  const [savePhysical, setSavePhysical] = React.useState(false)
  const [saveCopies, setSaveCopies] = React.useState(1)

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current != null) clearTimeout(copyFeedbackTimerRef.current)
    }
  }, [])

  // Keep already-computed rows in sync when the ownership scope changes, without
  // requiring the user to re-click "Check Deck".
  React.useEffect(() => {
    if (!resolution) return
    setRows(computeDeckRows(resolution.rows, buildOwnedLookup()))
  }, [resolution, buildOwnedLookup])

  function handleParse() {
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
    setRows(computeDeckRows(resolved.rows, owned))
    setShowSaveForm(false)
    setSaveName(resolved.deckName ?? '')
    setSavePhysical(false)
    setSaveCopies(1)
  }

  function handleSaveDeck() {
    if (!resolution) return
    const result = createSavedDeck(resolution.rows, {
      name: saveName,
      physical: savePhysical,
      copies: saveCopies,
      sourceText: text,
    })
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
    setShowSaveForm(false)
  }

  const summary = React.useMemo(() => summarizeDeck(rows, includeSideboard), [rows, includeSideboard])
  const mainRows = rows.filter(r => r.role !== 'sideboard')
  const sideboardRows = rows.filter(r => r.role === 'sideboard')
  const detectedFormat = text.trim() ? FORMAT_LABEL[detectDeckFormat(text)] : null

  function copyMissingDeckCards() {
    const list = formatMissingCardsList(rows, includeSideboard)

    if (!list) {
      showToast('No missing cards to copy!', 'warning')
      return
    }

    if (copyFeedbackTimerRef.current != null) {
      clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }

    navigator.clipboard.writeText(list).then(
      () => {
        setCopyFeedback('copied')
        copyFeedbackTimerRef.current = setTimeout(() => setCopyFeedback('idle'), 2200)
      },
      () => {
        setCopyFeedback('failed')
        showToast('Copy failed.', 'error')
        copyFeedbackTimerRef.current = setTimeout(() => setCopyFeedback('idle'), 3200)
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deck check"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 900,
          width: '92%',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: 20,
          background: '#141821',
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <h2 style={{ marginTop: 0 }}>Deck Check</h2>
          <button type="button" className="tbtn" onClick={onClose} aria-label="Close">
            <span className="icon" aria-hidden="true">close</span>
          </button>
        </div>

        <p className="muted" style={{ marginTop: 0 }}>
          Paste a decklist (JSON, Melee, Picklist, or a plain "3x Card Name" list) to see which cards
          you own, which are missing, and what it would cost to complete the deck.
        </p>

        <label className="row" style={{ gap: 6, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={ownershipScope === 'combined'}
            onChange={e => onOwnershipScopeChange(e.target.checked ? 'combined' : 'bindersOnly')}
          />
          <span className="muted">Count owned precons &amp; physical decks as owned, on top of your binders</span>
        </label>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste your decklist here…"
          rows={8}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#0f1017',
            color: '#eaeaf0',
            border: '1px solid #2b2d3d',
            borderRadius: 10,
            padding: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            resize: 'vertical',
          }}
        />

        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="tbtn" onClick={handleParse}>
            <span className="icon" aria-hidden="true">checklist</span>
            <span>Check Deck</span>
          </button>
          {detectedFormat && <span className="pill">Detected: {detectedFormat}</span>}
        </div>

        {resolution && (
          <>
            <div className="row" style={{ marginTop: 20, justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{resolution.deckName ?? 'Pasted decklist'}</h3>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={includeSideboard}
                  onChange={e => setIncludeSideboard(e.target.checked)}
                />
                <span>Include sideboard in totals &amp; export</span>
              </label>
            </div>

            <div className="row" style={{ marginTop: 8, gap: 16 }}>
              <span className="pill">Needed cards: {summary.totalNeededCards}</span>
              <span className="pill">Cost to complete: {money(summary.totalCost)}</span>
              {summary.leaderOwned !== null && (
                <span className="pill">
                  {rows.filter(r => r.role === 'leader').length > 1 ? 'Leaders' : 'Leader'}:{' '}
                  {summary.leaderOwned ? 'Owned ✓' : 'Missing'}
                </span>
              )}
              {summary.baseOwned !== null && (
                <span className="pill">Base: {summary.baseOwned ? 'Owned ✓' : 'Missing'}</span>
              )}
            </div>

            <DeckRowsTable rows={mainRows} />

            {sideboardRows.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Sideboard</h4>
                <DeckRowsTable rows={sideboardRows} />
              </>
            )}

            {resolution.unresolved.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>
                  <span className="err">Unresolved ({resolution.unresolved.length})</span>
                </h4>
                <p className="muted" style={{ marginTop: 0 }}>
                  These lines couldn't be matched to a card. Fix them in the pasted text and check again.
                </p>
                <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
                  {resolution.unresolved.map((entry, i) => (
                    <li key={i} className="muted">
                      {entry.count > 0 ? `${entry.count} ` : ''}
                      {entry.name}
                      {entry.subtitle ? ` - ${entry.subtitle}` : ''}
                      {' — '}
                      {REASON_LABEL[entry.reason]}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="row" style={{ marginTop: 16, gap: 8 }}>
              <button type="button" className="tbtn" onClick={copyMissingDeckCards}>
                <span className="icon" aria-hidden="true">
                  {copyFeedback === 'copied' ? 'check_circle' : copyFeedback === 'failed' ? 'error' : 'content_paste'}
                </span>
                <span>
                  {copyFeedback === 'copied'
                    ? 'Copied!'
                    : copyFeedback === 'failed'
                    ? 'Copy failed'
                    : 'Copy missing to clipboard'}
                </span>
              </button>
              <button type="button" className="tbtn" onClick={() => setShowSaveForm(v => !v)}>
                <span className="icon" aria-hidden="true">bookmark_add</span>
                <span>Save as Deck</span>
              </button>
            </div>

            {showSaveForm && (
              <div
                className="row"
                style={{ marginTop: 12, gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
              >
                <input
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="Deck name"
                  style={{
                    background: '#0f1017',
                    color: '#eaeaf0',
                    border: '1px solid #2b2d3d',
                    borderRadius: 8,
                    padding: '6px 10px',
                    minWidth: 200,
                  }}
                />
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={savePhysical}
                    onChange={e => setSavePhysical(e.target.checked)}
                  />
                  <span title="Turn this on if this deck is physically built/boxed and not counted in your binder — its cards will count as owned.">
                    Physical (owned outside my binder)
                  </span>
                </label>
                {savePhysical && (
                  <label className="row" style={{ gap: 6 }}>
                    <span>Copies</span>
                    <input
                      type="number"
                      min={1}
                      value={saveCopies}
                      onChange={e => setSaveCopies(Math.max(1, Number(e.target.value) || 1))}
                      style={{
                        width: 60,
                        background: '#0f1017',
                        color: '#eaeaf0',
                        border: '1px solid #2b2d3d',
                        borderRadius: 8,
                        padding: '6px 10px',
                      }}
                    />
                  </label>
                )}
                <button type="button" className="tbtn" onClick={handleSaveDeck}>
                  <span className="icon" aria-hidden="true">save</span>
                  <span>Save</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
