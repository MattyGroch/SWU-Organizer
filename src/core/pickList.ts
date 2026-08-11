import { binderLayout } from './binder'
import type { DeckCardRef, DeckContents } from './deckContents'
import type { DeckLookupSet, DeckRole } from './decklist'
import type { SetKey } from './types'

export type PickListItem = {
  setKey: SetKey
  baseNumber: number
  name: string
  subtitle?: string
  /** All roles this physical card serves in the deck, priority-sorted (leader, base, deck, sideboard). */
  roles: DeckRole[]
  /** Total copies the deck needs from this binder slot. */
  count: number
  /** Copies available to pull, per the ownedByBase lookup passed in. */
  have: number
  /** min(count, have) — how many to actually pull. */
  pull: number
  /** count - pull — how many couldn't be pulled. */
  short: number
  page: number
  row: number
  column: number
}

export type PickListGroup = { setKey: SetKey; items: PickListItem[] }

const ROLE_PRIORITY: Record<DeckRole, number> = { leader: 0, base: 1, deck: 2, sideboard: 3 }

type Bucket = { setKey: SetKey; baseNumber: number; roles: Set<DeckRole>; count: number }

function addRef(buckets: Map<string, Bucket>, ref: DeckCardRef, role: DeckRole) {
  const key = `${ref.setKey}:${ref.baseNumber}`
  const existing = buckets.get(key)
  if (existing) {
    existing.roles.add(role)
    existing.count += ref.count
  } else {
    buckets.set(key, { setKey: ref.setKey, baseNumber: ref.baseNumber, roles: new Set([role]), count: ref.count })
  }
}

/** Builds a binder-ordered pull list for a deck: grouped by set (in setOrder), sorted by page/row/column within each group. */
export function buildPickList(
  contents: DeckContents,
  parsedSets: Map<SetKey, DeckLookupSet>,
  ownedByBase: (setKey: SetKey, baseNumber: number) => number,
  setOrder: SetKey[],
  includeSideboard: boolean,
): PickListGroup[] {
  const buckets = new Map<string, Bucket>()

  addRef(buckets, contents.leader, 'leader')
  if (contents.secondLeader) addRef(buckets, contents.secondLeader, 'leader')
  addRef(buckets, contents.base, 'base')
  for (const ref of contents.mainDeck) addRef(buckets, ref, 'deck')
  if (includeSideboard) for (const ref of contents.sideboard) addRef(buckets, ref, 'sideboard')

  const groups = new Map<SetKey, PickListItem[]>()
  for (const bucket of buckets.values()) {
    const card = parsedSets.get(bucket.setKey)?.byNumber.get(bucket.baseNumber)
    if (!card) continue

    const have = Math.max(0, ownedByBase(bucket.setKey, bucket.baseNumber))
    const pull = Math.min(bucket.count, have)
    const { page, row, column } = binderLayout(bucket.baseNumber)

    const item: PickListItem = {
      setKey: bucket.setKey,
      baseNumber: bucket.baseNumber,
      name: card.Name,
      subtitle: card.Subtitle,
      roles: [...bucket.roles].sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b]),
      count: bucket.count,
      have,
      pull,
      short: bucket.count - pull,
      page,
      row,
      column,
    }

    const list = groups.get(bucket.setKey) ?? []
    list.push(item)
    groups.set(bucket.setKey, list)
  }

  return groupAndSort(groups, setOrder)
}

function groupAndSort(groups: Map<SetKey, PickListItem[]>, setOrder: SetKey[]): PickListGroup[] {
  for (const list of groups.values()) {
    list.sort((a, b) => a.page - b.page || a.row - b.row || a.column - b.column)
  }
  return setOrder.filter(sk => groups.has(sk)).map(setKey => ({ setKey, items: groups.get(setKey)! }))
}

/** Builds the "put it back" list from a deck's pulledCards snapshot — no shortfall concept, since these are exactly the cards that were pulled. */
export function buildPutBackList(
  pulledCards: DeckCardRef[],
  parsedSets: Map<SetKey, DeckLookupSet>,
  setOrder: SetKey[],
): PickListGroup[] {
  const groups = new Map<SetKey, PickListItem[]>()
  for (const ref of pulledCards) {
    const card = parsedSets.get(ref.setKey)?.byNumber.get(ref.baseNumber)
    if (!card) continue

    const { page, row, column } = binderLayout(ref.baseNumber)
    const item: PickListItem = {
      setKey: ref.setKey,
      baseNumber: ref.baseNumber,
      name: card.Name,
      subtitle: card.Subtitle,
      roles: [],
      count: ref.count,
      have: ref.count,
      pull: ref.count,
      short: 0,
      page,
      row,
      column,
    }
    const list = groups.get(ref.setKey) ?? []
    list.push(item)
    groups.set(ref.setKey, list)
  }

  return groupAndSort(groups, setOrder)
}
