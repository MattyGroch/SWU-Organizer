import type { SetKey } from './types'
import type { ResolvedDeckRow } from './decklist'

export type DeckCardRef = { setKey: SetKey; baseNumber: number; count: number }

export type DeckContents = {
  leader: DeckCardRef
  secondLeader?: DeckCardRef
  base: DeckCardRef
  mainDeck: DeckCardRef[]
  sideboard: DeckCardRef[]
}

export type DeckContentsResult =
  | { ok: true; contents: DeckContents }
  | { ok: false; reason: 'missing-leader' | 'missing-base' }

function toRef(row: ResolvedDeckRow): DeckCardRef {
  return { setKey: row.setKey, baseNumber: row.baseNumber, count: row.count }
}

/** Groups resolved rows (from decklist.ts) into a DeckContents shape, used by both the static precon catalog and the personal deck library. */
export function deckContentsFromRows(rows: ResolvedDeckRow[]): DeckContentsResult {
  const leaders = rows.filter(r => r.role === 'leader')
  const bases = rows.filter(r => r.role === 'base')
  if (leaders.length === 0) return { ok: false, reason: 'missing-leader' }
  if (bases.length === 0) return { ok: false, reason: 'missing-base' }

  const [leader, secondLeader] = leaders
  const [base] = bases

  return {
    ok: true,
    contents: {
      leader: toRef(leader!),
      secondLeader: secondLeader ? toRef(secondLeader) : undefined,
      base: toRef(base!),
      mainDeck: rows.filter(r => r.role === 'deck').map(toRef),
      sideboard: rows.filter(r => r.role === 'sideboard').map(toRef),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isDeckCardRef(value: unknown): value is DeckCardRef {
  return (
    isRecord(value) &&
    typeof value.setKey === 'string' &&
    Number.isInteger(value.baseNumber) &&
    Number.isInteger(value.count) &&
    (value.count as number) > 0
  )
}

function isDeckCardRefArray(value: unknown): value is DeckCardRef[] {
  return Array.isArray(value) && value.every(isDeckCardRef)
}

export function isDeckContents(value: unknown): value is DeckContents {
  if (
    !isRecord(value) ||
    !isDeckCardRef(value.leader) ||
    !isDeckCardRef(value.base) ||
    !isDeckCardRefArray(value.mainDeck) ||
    !isDeckCardRefArray(value.sideboard)
  ) {
    return false
  }
  return value.secondLeader === undefined || isDeckCardRef(value.secondLeader)
}

export function parseDeckContents(payload: unknown): DeckContents {
  if (!isDeckContents(payload)) throw new Error('Invalid deck contents payload.')
  return {
    leader: payload.leader,
    secondLeader: payload.secondLeader,
    base: payload.base,
    mainDeck: payload.mainDeck,
    sideboard: payload.sideboard,
  }
}

export function allCardRefs(contents: DeckContents): DeckCardRef[] {
  const refs = [contents.leader, contents.base, ...contents.mainDeck, ...contents.sideboard]
  if (contents.secondLeader) refs.push(contents.secondLeader)
  return refs
}

export type OwnedTotals = Record<SetKey, Record<number, number>>

/** Adds `contents` (multiplied by `multiplier`, e.g. copies owned) into a running owned-cards total. Uncapped — physical/precon copies aren't subject to the binder's playset quota. */
export function addDeckContentsToTotals(
  totals: OwnedTotals,
  contents: DeckContents,
  multiplier: number,
): void {
  if (multiplier <= 0) return
  for (const ref of allCardRefs(contents)) {
    const bucket = totals[ref.setKey] ?? (totals[ref.setKey] = {})
    bucket[ref.baseNumber] = (bucket[ref.baseNumber] ?? 0) + ref.count * multiplier
  }
}
