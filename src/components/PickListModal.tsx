import React from 'react'
import type { DeckLookupSet, DeckRowWithNeed } from '../core/decklist'
import { formatMissingCardsList } from '../core/decklist'
import type { SetKey } from '../core/types'
import { buildPickList, buildPutBackList, type PickListGroup, type PickListItem } from '../core/pickList'
import type { DeckLibrary, SavedDeck } from '../core/decks'

type Props = {
  deck: SavedDeck
  mode: 'construct' | 'deconstruct'
  parsedSets: Map<SetKey, DeckLookupSet>
  setOrder: SetKey[]
  buildBinderAvailableLookup: () => (setKey: SetKey, baseNumber: number) => number
  dealRows: DeckRowWithNeed[]
  deckLibrary: DeckLibrary
  onClose: () => void
  onUpdateDeck: (id: string, patch: Partial<Pick<SavedDeck, 'constructed' | 'pulledCards'>>) => void
}

function copyToClipboard(text: string, onDone: (ok: boolean) => void) {
  navigator.clipboard.writeText(text).then(
    () => onDone(true),
    () => onDone(false),
  )
}

export function PickListModal({
  deck,
  mode,
  parsedSets,
  setOrder,
  buildBinderAvailableLookup,
  dealRows,
  deckLibrary,
  onClose,
  onUpdateDeck,
}: Props) {
  const [includeSideboard, setIncludeSideboard] = React.useState(false)
  const [acknowledgedShortfall, setAcknowledgedShortfall] = React.useState(false)
  const [copyFeedback, setCopyFeedback] = React.useState<'idle' | 'copied' | 'failed'>('idle')

  const ownedByBase = React.useMemo(() => buildBinderAvailableLookup(), [buildBinderAvailableLookup])

  const groups: PickListGroup[] = React.useMemo(() => {
    if (mode === 'deconstruct') return buildPutBackList(deck.pulledCards, parsedSets, setOrder)
    return buildPickList(deck, parsedSets, ownedByBase, setOrder, includeSideboard)
  }, [mode, deck, parsedSets, ownedByBase, setOrder, includeSideboard])

  const allItems: PickListItem[] = React.useMemo(() => groups.flatMap(g => g.items), [groups])

  const dealNeededByKey = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const row of dealRows) map.set(`${row.setKey}:${row.baseNumber}`, row.needed)
    return map
  }, [dealRows])

  const reservedBySources = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const other of deckLibrary.customDecks) {
      if (other.id === deck.id || !other.constructed) continue
      for (const ref of other.pulledCards) {
        const key = `${ref.setKey}:${ref.baseNumber}`
        const list = map.get(key) ?? []
        list.push(other.name)
        map.set(key, list)
      }
    }
    return map
  }, [deckLibrary, deck.id])

  const shortfalls = React.useMemo(() => {
    return allItems
      .filter(item => item.short > 0)
      .map(item => {
        const key = `${item.setKey}:${item.baseNumber}`
        const buyNeeded = Math.min(item.short, dealNeededByKey.get(key) ?? 0)
        const reservedNeeded = item.short - buyNeeded
        return { item, buyNeeded, reservedNeeded, reservedBy: reservedBySources.get(key) ?? [] }
      })
  }, [allItems, dealNeededByKey, reservedBySources])

  const totalShort = shortfalls.reduce((sum, s) => sum + s.item.short, 0)
  const purchaseRows = dealRows.filter(r => r.needed > 0)
  const reservedShortfalls = shortfalls.filter(s => s.reservedNeeded > 0)

  const gated = mode === 'construct' && totalShort > 0 && !acknowledgedShortfall

  function handleCopyPurchaseList() {
    const list = formatMissingCardsList(purchaseRows, includeSideboard)
    if (!list) return
    copyToClipboard(list, ok => {
      setCopyFeedback(ok ? 'copied' : 'failed')
      window.setTimeout(() => setCopyFeedback('idle'), 2200)
    })
  }

  function handleMarkConstructed() {
    const pulledCards = allItems
      .filter(item => item.pull > 0)
      .map(item => ({ setKey: item.setKey, baseNumber: item.baseNumber, count: item.pull }))
    onUpdateDeck(deck.id, { constructed: true, pulledCards })
    onClose()
  }

  function handleMarkDeconstructed() {
    onUpdateDeck(deck.id, { constructed: false, pulledCards: [] })
    onClose()
  }

  const verb = mode === 'construct' ? 'Pull' : 'Put back'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${mode === 'construct' ? 'Construct' : 'Deconstruct'} ${deck.name}`}
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
          <h2 style={{ marginTop: 0 }}>
            {mode === 'construct' ? 'Construct' : 'Deconstruct'}: {deck.name}
          </h2>
          <button type="button" className="tbtn" onClick={onClose} aria-label="Close">
            <span className="icon" aria-hidden="true">close</span>
          </button>
        </div>

        <p className="muted" style={{ marginTop: 0 }}>
          {mode === 'construct'
            ? 'Flip through your binders front to back and pull each card below in order.'
            : 'Flip through your binders front to back and put each card below back in its slot.'}
        </p>

        {mode === 'construct' && (
          <label className="row" style={{ gap: 6, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={includeSideboard}
              onChange={e => {
                setIncludeSideboard(e.target.checked)
                setAcknowledgedShortfall(false)
              }}
            />
            <span>Include sideboard</span>
          </label>
        )}

        {gated ? (
          <div className="card" style={{ padding: 16, background: '#1a1410', border: '1px solid #4a3a00' }}>
            <p style={{ marginTop: 0 }}>
              <span className="err">Missing complete copies of {shortfalls.length} card{shortfalls.length === 1 ? '' : 's'}.</span>
            </p>
            <p className="muted">
              {purchaseRows.length > 0 && <>{purchaseRows.length} to buy. </>}
              {reservedShortfalls.length > 0 && (
                <>{reservedShortfalls.length} reserved by other built deck{reservedShortfalls.length === 1 ? '' : 's'}. </>
              )}
              A purchase list is included below once you continue.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="tbtn" onClick={() => setAcknowledgedShortfall(true)}>
                <span>Continue anyway</span>
              </button>
              <button type="button" className="tbtn" onClick={onClose}>
                <span>Cancel</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ gap: 16, marginBottom: 12 }}>
              <span className="pill">
                Total cards: {allItems.reduce((sum, i) => sum + (mode === 'construct' ? i.pull : i.count), 0)}
              </span>
              {totalShort > 0 && (
                <span className="err">
                  Short {totalShort} card{totalShort === 1 ? '' : 's'} — pull what you have
                </span>
              )}
            </div>

            {groups.length === 0 ? (
              <p className="muted">Nothing to {verb.toLowerCase()} — this deck has no cards in tracked sets.</p>
            ) : (
              groups.map(group => (
                <div key={group.setKey} style={{ marginTop: 16 }}>
                  <h4 style={{ marginBottom: 6 }}>
                    <span className="pill">{group.setKey}</span>
                  </h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Page</th>
                          <th>Row</th>
                          <th>Col</th>
                          <th>Card</th>
                          <th>Role</th>
                          <th>{verb}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(item => (
                          <tr key={`${item.setKey}:${item.baseNumber}`}>
                            <td className="mono">{item.page}</td>
                            <td className="mono">{item.row}</td>
                            <td className="mono">{item.column}</td>
                            <td>
                              {item.name}
                              {item.subtitle && <span className="muted"> - {item.subtitle}</span>}
                            </td>
                            <td className="mono">{item.roles.join('+')}</td>
                            <td className="mono">
                              {mode === 'construct' && item.short > 0 ? (
                                <span className="err">{item.pull} of {item.count}</span>
                              ) : (
                                mode === 'construct' ? item.pull : item.count
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}

            {mode === 'construct' && purchaseRows.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ marginBottom: 6 }}>Purchase list</h4>
                <p className="muted" style={{ marginTop: 0 }}>
                  These cards aren't owned in enough quantity to complete the deck.
                </p>
                <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
                  {purchaseRows.map(r => (
                    <li key={`${r.setKey}:${r.baseNumber}`}>
                      {r.needed}x {r.name}
                      {r.subtitle ? ` - ${r.subtitle}` : ''} ({r.setKey})
                    </li>
                  ))}
                </ul>
                <button type="button" className="tbtn" onClick={handleCopyPurchaseList}>
                  <span className="icon" aria-hidden="true">
                    {copyFeedback === 'copied' ? 'check_circle' : copyFeedback === 'failed' ? 'error' : 'content_paste'}
                  </span>
                  <span>
                    {copyFeedback === 'copied' ? 'Copied!' : copyFeedback === 'failed' ? 'Copy failed' : 'Copy purchase list'}
                  </span>
                </button>
              </div>
            )}

            {mode === 'construct' && reservedShortfalls.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ marginBottom: 6 }}>Reserved by other built decks</h4>
                <p className="muted" style={{ marginTop: 0 }}>
                  You own these, but they're currently pulled into another constructed deck. Deconstruct that
                  deck or buy another copy.
                </p>
                <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
                  {reservedShortfalls.map(s => (
                    <li key={`${s.item.setKey}:${s.item.baseNumber}`}>
                      {s.reservedNeeded}x {s.item.name}
                      {s.item.subtitle ? ` - ${s.item.subtitle}` : ''} ({s.item.setKey}) — held by{' '}
                      {s.reservedBy.join(', ') || 'another deck'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="row" style={{ marginTop: 16, gap: 8 }}>
              {mode === 'construct' ? (
                <button type="button" className="tbtn" onClick={handleMarkConstructed}>
                  <span className="icon" aria-hidden="true">check_circle</span>
                  <span>Mark as Constructed</span>
                </button>
              ) : (
                <button type="button" className="tbtn" onClick={handleMarkDeconstructed}>
                  <span className="icon" aria-hidden="true">inventory_2</span>
                  <span>Mark as Deconstructed</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
