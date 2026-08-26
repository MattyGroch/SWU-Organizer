import React from 'react'
import { FORMAT_RULES, type DeckLegality, type FormatChoice } from '../core/deckLegality'

const CHOICES: Array<{ value: FormatChoice; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'premier', label: FORMAT_RULES.premier.label },
  { value: 'twinSuns', label: FORMAT_RULES.twinSuns.label },
]

export function FormatPicker({
  value,
  onChange,
  id,
}: {
  value: FormatChoice
  onChange: (choice: FormatChoice) => void
  id?: string
}) {
  return (
    <label className="row" style={{ gap: 6, alignItems: 'center' }}>
      <span className="muted">Format</span>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value as FormatChoice)}
        style={{
          background: '#0f1017',
          color: '#eaeaf0',
          border: '1px solid #2b2d3d',
          borderRadius: 8,
          padding: '6px 10px',
        }}
      >
        {CHOICES.map(choice => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Compact "Premier" / "Twin Suns" badge, for places that list decks rather than inspect one. */
export function FormatPill({ legality }: { legality: DeckLegality }) {
  return (
    <span className="pill" title={legality.autoDetected ? 'Format detected from the decklist' : undefined}>
      {legality.rules.label}
    </span>
  )
}

export function DeckLegalityPanel({ legality }: { legality: DeckLegality }) {
  const { stats, rules, issues } = legality
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="pill">
          {rules.label}
          {legality.autoDetected ? ' (detected)' : ''}
        </span>
        <span className="pill">
          {legality.legal ? 'Legal ✓' : `${errors.length} rule issue${errors.length === 1 ? '' : 's'}`}
        </span>
        <span className="pill">
          Leaders: {stats.leaderCount}/{rules.leaders}
        </span>
        <span className="pill">Base: {stats.baseCount}/1</span>
        <span className="pill">
          Deck: {stats.mainDeckSize}/{rules.minDeck}
        </span>
        {stats.sideboardSize > 0 && (
          <span className="pill">
            Sideboard: {stats.sideboardSize}/{rules.maxSideboard}
          </span>
        )}
        <span className="pill" title="Copies allowed per card title, unless the card's own text says otherwise">
          Max copies: {rules.copyLimit}
        </span>
      </div>

      {errors.length > 0 && (
        <ul style={{ margin: '8px 0 0', padding: '0 0 0 18px' }}>
          {errors.map((issue, i) => (
            <li key={i} className="err">
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul style={{ margin: '8px 0 0', padding: '0 0 0 18px' }}>
          {warnings.map((issue, i) => (
            <li key={i} className="muted">
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
