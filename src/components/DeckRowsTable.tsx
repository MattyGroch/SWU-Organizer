import React from 'react'
import type { DeckRowWithNeed } from '../core/decklist'

const ROLE_LABEL: Record<'leader' | 'base' | 'deck' | 'sideboard', string> = {
  leader: 'Leader',
  base: 'Base',
  deck: 'Deck',
  sideboard: 'Sideboard',
}

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function Row({ row }: { row: DeckRowWithNeed }) {
  return (
    <tr>
      <td>{ROLE_LABEL[row.role]}</td>
      <td>
        {row.name}
        {row.subtitle && <span className="muted"> - {row.subtitle}</span>}
        {row.ambiguous && (
          <span
            className="muted"
            title={
              row.ambiguousOtherSets?.length
                ? `Name also matches: ${row.ambiguousOtherSets.join(', ')} — guessed ${row.setKey}`
                : 'Guessed which printing you meant'
            }
            style={{ marginLeft: 6 }}
          >
            ⚠
          </span>
        )}
      </td>
      <td className="mono">{row.setKey}</td>
      <td className="mono">{row.have}</td>
      <td className="mono">{row.count}</td>
      <td className="mono">{row.needed}</td>
      <td className="mono">{money(row.price)}</td>
      <td className="mono">{money(row.rowCost)}</td>
    </tr>
  )
}

export function DeckRowsTable({ rows }: { rows: DeckRowWithNeed[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Role</th>
            <th>Card</th>
            <th>Set</th>
            <th>Have</th>
            <th>Deck</th>
            <th>Needed</th>
            <th>Price</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <Row key={`${row.role}:${row.setKey}:${row.baseNumber}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
