import { describe, expect, it } from 'vitest'
import type { Card, SetKey } from './types'
import type { DeckContents } from './deckContents'
import type { DeckLookupSet } from './decklist'
import { buildPickList, buildPutBackList } from './pickList'

function card(partial: Partial<Card> & { Name: string; Number: number; Set: SetKey }): Card {
  return { MarketPrice: 0, ...partial }
}

// Number 1 -> page 1/row 1/col 1; 5 -> page 1/row 2/col 1; 13 -> page 2/row 1/col 1; 25 -> page 3/row 1/col 1.
const SOR_CARDS: Card[] = [
  card({ Set: 'SOR', Number: 1, Name: 'Leader Card', Type: 'Leader' }),
  card({ Set: 'SOR', Number: 2, Name: 'Second Leader', Type: 'Leader' }),
  card({ Set: 'SOR', Number: 3, Name: 'Base Card', Type: 'Base' }),
  card({ Set: 'SOR', Number: 4, Name: 'Mid Card', Subtitle: 'Sub', Type: 'Unit' }),
  card({ Set: 'SOR', Number: 5, Name: 'Row Two Card', Type: 'Unit' }),
  card({ Set: 'SOR', Number: 13, Name: 'Page Two Card', Type: 'Unit' }),
  card({ Set: 'SOR', Number: 25, Name: 'Page Three Card', Type: 'Unit' }),
  card({ Set: 'SOR', Number: 30, Name: 'Sideboard Card', Type: 'Unit' }),
  card({ Set: 'SOR', Number: 31, Name: 'Both Roles Card', Type: 'Unit' }),
]

const SHD_CARDS: Card[] = [card({ Set: 'SHD', Number: 1, Name: 'Other Set Card', Type: 'Unit' })]

const PARSED_SETS: Map<SetKey, DeckLookupSet> = new Map([
  ['SOR', { baseCards: SOR_CARDS, byNumber: new Map(SOR_CARDS.map(c => [c.Number, c])) }],
  ['SHD', { baseCards: SHD_CARDS, byNumber: new Map(SHD_CARDS.map(c => [c.Number, c])) }],
])

function ownedAll(): (setKey: SetKey, baseNumber: number) => number {
  return () => 3
}

const baseContents: DeckContents = {
  leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
  base: { setKey: 'SOR', baseNumber: 3, count: 1 },
  mainDeck: [
    { setKey: 'SOR', baseNumber: 25, count: 2 },
    { setKey: 'SOR', baseNumber: 5, count: 3 },
    { setKey: 'SOR', baseNumber: 13, count: 3 },
    { setKey: 'SOR', baseNumber: 4, count: 3 },
  ],
  sideboard: [],
}

describe('buildPickList', () => {
  it('computes binder positions from collector numbers', () => {
    const groups = buildPickList(baseContents, PARSED_SETS, ownedAll(), ['SOR'], false)
    const bySlot = new Map(groups[0]!.items.map(i => [i.baseNumber, i]))
    expect(bySlot.get(1)).toMatchObject({ page: 1, row: 1, column: 1 })
    expect(bySlot.get(5)).toMatchObject({ page: 1, row: 2, column: 1 })
    expect(bySlot.get(13)).toMatchObject({ page: 2, row: 1, column: 1 })
    expect(bySlot.get(25)).toMatchObject({ page: 3, row: 1, column: 1 })
  })

  it('sorts items within a group by page, then row, then column regardless of input order', () => {
    const groups = buildPickList(baseContents, PARSED_SETS, ownedAll(), ['SOR'], false)
    expect(groups[0]!.items.map(i => i.baseNumber)).toEqual([1, 3, 4, 5, 13, 25])
  })

  it('orders groups by setOrder, not alphabetically or by insertion order', () => {
    const contents: DeckContents = {
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 3, count: 1 },
      mainDeck: [{ setKey: 'SHD', baseNumber: 1, count: 1 }],
      sideboard: [],
    }
    const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SHD', 'SOR'], false)
    expect(groups.map(g => g.setKey)).toEqual(['SHD', 'SOR'])
  })

  it('omits sets that end up with no items', () => {
    const contents: DeckContents = {
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 3, count: 1 },
      mainDeck: [],
      sideboard: [{ setKey: 'SHD', baseNumber: 1, count: 1 }],
    }
    const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR', 'SHD'], false)
    expect(groups.map(g => g.setKey)).toEqual(['SOR'])
  })

  describe('includeSideboard', () => {
    const contents: DeckContents = {
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 3, count: 1 },
      mainDeck: [{ setKey: 'SOR', baseNumber: 31, count: 1 }],
      sideboard: [
        { setKey: 'SOR', baseNumber: 30, count: 2 },
        { setKey: 'SOR', baseNumber: 31, count: 1 },
      ],
    }

    it('excludes sideboard-only cards and does not merge sideboard counts when false', () => {
      const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR'], false)
      const numbers = groups[0]!.items.map(i => i.baseNumber)
      expect(numbers).not.toContain(30)
      const both = groups[0]!.items.find(i => i.baseNumber === 31)!
      expect(both.count).toBe(1)
      expect(both.roles).toEqual(['deck'])
    })

    it('includes sideboard cards and merges counts for cards in both mainDeck and sideboard when true', () => {
      const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR'], true)
      const numbers = groups[0]!.items.map(i => i.baseNumber)
      expect(numbers).toContain(30)
      const both = groups[0]!.items.find(i => i.baseNumber === 31)!
      expect(both.count).toBe(2)
      expect(both.roles).toEqual(['deck', 'sideboard'])
    })
  })

  it('computes shortfall when have < count, without dropping the item', () => {
    const owned = (_setKey: SetKey, baseNumber: number) => (baseNumber === 5 ? 1 : 3)
    const groups = buildPickList(baseContents, PARSED_SETS, owned, ['SOR'], false)
    const item = groups[0]!.items.find(i => i.baseNumber === 5)!
    expect(item).toMatchObject({ count: 3, have: 1, pull: 1, short: 2 })
  })

  it('treats an unowned card as a full shortfall rather than throwing', () => {
    const owned = () => 0
    const groups = buildPickList(baseContents, PARSED_SETS, owned, ['SOR'], false)
    const item = groups[0]!.items.find(i => i.baseNumber === 1)!
    expect(item).toMatchObject({ have: 0, pull: 0, short: 1 })
  })

  it('produces two leader-role items for a secondLeader (Twin Suns) deck', () => {
    const contents: DeckContents = {
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      secondLeader: { setKey: 'SOR', baseNumber: 2, count: 1 },
      base: { setKey: 'SOR', baseNumber: 3, count: 1 },
      mainDeck: [],
      sideboard: [],
    }
    const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR'], false)
    const leaders = groups[0]!.items.filter(i => i.roles.includes('leader'))
    expect(leaders.map(i => i.baseNumber).sort()).toEqual([1, 2])
  })

  it('skips cards that cannot be resolved in parsedSets instead of throwing', () => {
    const contents: DeckContents = {
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 3, count: 1 },
      mainDeck: [{ setKey: 'SOR', baseNumber: 9999, count: 1 }],
      sideboard: [],
    }
    expect(() => buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR'], false)).not.toThrow()
    const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR'], false)
    expect(groups[0]!.items.map(i => i.baseNumber)).not.toContain(9999)
  })

  describe('buildPutBackList', () => {
    it('groups and sorts a pulledCards snapshot the same way as buildPickList, with no shortfall', () => {
      const groups = buildPutBackList(
        [
          { setKey: 'SOR', baseNumber: 25, count: 2 },
          { setKey: 'SOR', baseNumber: 1, count: 1 },
        ],
        PARSED_SETS,
        ['SOR'],
      )
      expect(groups[0]!.items.map(i => i.baseNumber)).toEqual([1, 25])
      const item = groups[0]!.items.find(i => i.baseNumber === 25)!
      expect(item).toMatchObject({ count: 2, have: 2, pull: 2, short: 0, page: 3, row: 1, column: 1 })
    })

    it('skips cards that cannot be resolved without throwing', () => {
      expect(() =>
        buildPutBackList([{ setKey: 'SOR', baseNumber: 9999, count: 1 }], PARSED_SETS, ['SOR']),
      ).not.toThrow()
    })
  })

  it('sorts roles within an item by priority: leader, base, deck, sideboard', () => {
    const contents: DeckContents = {
      leader: { setKey: 'SOR', baseNumber: 31, count: 1 },
      base: { setKey: 'SOR', baseNumber: 3, count: 1 },
      mainDeck: [{ setKey: 'SOR', baseNumber: 31, count: 1 }],
      sideboard: [{ setKey: 'SOR', baseNumber: 31, count: 1 }],
    }
    const groups = buildPickList(contents, PARSED_SETS, ownedAll(), ['SOR'], true)
    const item = groups[0]!.items.find(i => i.baseNumber === 31)!
    expect(item.roles).toEqual(['leader', 'deck', 'sideboard'])
  })
})
