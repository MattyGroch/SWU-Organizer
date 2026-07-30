import { describe, expect, it } from 'vitest'
import type { Card, SetKey } from './types'
import type { CanonicalCatalog } from './inventory'
import {
  computeDeckRows,
  detectDeckFormat,
  formatMissingLine,
  parseDeckGeneric,
  parseDeckJson,
  parseDeckMelee,
  parseDeckPicklist,
  resolveDeckList,
  summarizeDeck,
  type DeckLookupSet,
} from './decklist'

// ---------------------------------------------------------------------------
// Shared fixtures: four fake tracked sets with a couple of same-named cards
// across sets (to exercise ambiguity) and a couple of Type-less cards (to
// exercise the leader/base ordinal fallback).
// ---------------------------------------------------------------------------

function card(partial: Partial<Card> & { Name: string; Number: number; Set: SetKey }): Card {
  return { MarketPrice: 0, ...partial }
}

const ASH_CARDS: Card[] = [
  card({ Set: 'ASH', Number: 10, Name: 'Bo-Katan Kryze', Subtitle: 'Reclaiming Mandalore', Type: 'Leader', MarketPrice: 5 }),
  card({ Set: 'ASH', Number: 140, Name: 'Stronger Together', Type: 'Unit', MarketPrice: 2 }),
  card({ Set: 'ASH', Number: 79, Name: 'Koska Reeves', Subtitle: 'Warrior of Mandalore', Type: 'Unit', MarketPrice: 3 }),
  card({ Set: 'ASH', Number: 999, Name: 'Vanquish', Type: 'Event', MarketPrice: 1 }),
  card({ Set: 'ASH', Number: 500, Name: 'Mystery Card A', MarketPrice: 1 }),
]

const JTL_CARDS: Card[] = [
  card({ Set: 'JTL', Number: 19, Name: 'City in the Clouds', Type: 'Base', MarketPrice: 4 }),
  card({ Set: 'JTL', Number: 999, Name: 'Vanquish', Type: 'Event', MarketPrice: 1 }),
  card({ Set: 'JTL', Number: 501, Name: 'Mystery Card B', MarketPrice: 1 }),
]

const SEC_CARDS: Card[] = [
  card({ Set: 'SEC', Number: 47, Name: 'Coronet', Subtitle: 'Stately Vessel', Type: 'Unit', MarketPrice: 2 }),
]

const LAW_CARDS: Card[] = [
  card({ Set: 'LAW', Number: 133, Name: 'Lost and Forgotten', Type: 'Event', MarketPrice: 1 }),
]

const TRACKED_SET_KEYS: SetKey[] = ['ASH', 'JTL', 'SEC', 'LAW']

const ALL_SET_CARDS: Record<SetKey, Card[]> = {
  ASH: ASH_CARDS,
  JTL: JTL_CARDS,
  SEC: SEC_CARDS,
  LAW: LAW_CARDS,
}

const PARSED_SETS: Map<SetKey, DeckLookupSet> = new Map(
  TRACKED_SET_KEYS.map(setKey => [
    setKey,
    {
      baseCards: ALL_SET_CARDS[setKey],
      byNumber: new Map(ALL_SET_CARDS[setKey].map(c => [c.Number, c])),
    },
  ]),
)

const CATALOG: CanonicalCatalog = new Map(
  TRACKED_SET_KEYS.flatMap(setKey =>
    ALL_SET_CARDS[setKey].map(c => [
      `${setKey}:${c.Number}`,
      { setKey, printingNumber: c.Number, baseNumber: c.Number, type: c.Type },
    ] as const),
  ),
)

const NO_OWNERSHIP = () => 0

// ---------------------------------------------------------------------------
// detectDeckFormat
// ---------------------------------------------------------------------------

describe('detectDeckFormat', () => {
  it('detects JSON format', () => {
    expect(detectDeckFormat('{"leader":{"id":"ASH_010","count":1},"deck":[]}')).toBe('json')
  })

  it('detects Melee format', () => {
    expect(detectDeckFormat('Leader\n1 | Bo-Katan Kryze\n\nMainDeck\n3 | Covert Veteran')).toBe('melee')
  })

  it('detects Picklist format', () => {
    expect(detectDeckFormat('Picklist: My Deck\n\n[ ] Some Card\n ASH 010')).toBe('picklist')
  })

  it('falls back to generic for plain lines', () => {
    expect(detectDeckFormat('3 Vanquish (SOR)\n2x Effective Position')).toBe('generic')
  })

  it('falls back to generic for empty text', () => {
    expect(detectDeckFormat('   ')).toBe('generic')
  })

  it('falls back to generic for JSON without leader/base/deck shape', () => {
    expect(detectDeckFormat('{"foo":1}')).toBe('generic')
  })
})

// ---------------------------------------------------------------------------
// parseDeckJson
// ---------------------------------------------------------------------------

describe('parseDeckJson', () => {
  const sample = JSON.stringify({
    metadata: { name: 'So many MANDALORIANS!!!!!', author: 'Guydud3' },
    leader: { id: 'ASH_010', count: 1 },
    base: { id: 'JTL_019', count: 1 },
    deck: [
      { id: 'ASH_140', count: 2 },
      { id: 'SEC_047', count: 2 },
    ],
    sideboard: [{ id: 'JTL_078', count: 3 }],
  })

  it('parses leader/base/deck/sideboard entries with exact identities', () => {
    const parsed = parseDeckJson(sample)
    expect(parsed.format).toBe('json')
    expect(parsed.deckName).toBe('So many MANDALORIANS!!!!!')
    expect(parsed.malformed).toEqual([])
    expect(parsed.entries).toEqual([
      { role: 'leader', name: 'ASH_010', count: 1, exact: { setKey: 'ASH', printingNumber: 10 } },
      { role: 'base', name: 'JTL_019', count: 1, exact: { setKey: 'JTL', printingNumber: 19 } },
      { role: 'deck', name: 'ASH_140', count: 2, exact: { setKey: 'ASH', printingNumber: 140 } },
      { role: 'deck', name: 'SEC_047', count: 2, exact: { setKey: 'SEC', printingNumber: 47 } },
      { role: 'sideboard', name: 'JTL_078', count: 3, exact: { setKey: 'JTL', printingNumber: 78 } },
    ])
  })

  it('defaults sideboard to empty when absent', () => {
    const parsed = parseDeckJson(
      JSON.stringify({ leader: { id: 'ASH_010', count: 1 }, base: { id: 'JTL_019', count: 1 }, deck: [] }),
    )
    expect(parsed.entries.filter(e => e.role === 'sideboard')).toEqual([])
  })

  it('records a malformed id as skipped rather than throwing', () => {
    const parsed = parseDeckJson(
      JSON.stringify({ leader: { id: 'ASH_010', count: 1 }, base: { id: 'JTL_019', count: 1 }, deck: [{ id: 'not-an-id', count: 2 }] }),
    )
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.malformed).toHaveLength(1)
  })

  it('parses a Twin Suns deck with a secondleader key as a second leader entry', () => {
    const parsed = parseDeckJson(
      JSON.stringify({
        leader: { id: 'SHD_012', count: 1 },
        secondleader: { id: 'ASH_001', count: 1 },
        base: { id: 'SOR_030', count: 1 },
        deck: [],
      }),
    )
    expect(parsed.entries.filter(e => e.role === 'leader')).toEqual([
      { role: 'leader', name: 'SHD_012', count: 1, exact: { setKey: 'SHD', printingNumber: 12 } },
      { role: 'leader', name: 'ASH_001', count: 1, exact: { setKey: 'ASH', printingNumber: 1 } },
    ])
  })
})

// ---------------------------------------------------------------------------
// parseDeckMelee
// ---------------------------------------------------------------------------

describe('parseDeckMelee', () => {
  it('parses the sample Melee export', () => {
    const text = [
      'Leader',
      '1 | Bo-Katan Kryze | Reclaiming Mandalore',
      '',
      'Base',
      '1 | City in the Clouds',
      '',
      'MainDeck',
      '3 | Covert Veteran',
      '2 | Coronet | Stately Vessel',
      '',
      'Sideboard',
      '3 | Direct Hit',
    ].join('\n')

    const parsed = parseDeckMelee(text)
    expect(parsed.malformed).toEqual([])
    expect(parsed.entries).toEqual([
      { role: 'leader', name: 'Bo-Katan Kryze', subtitle: 'Reclaiming Mandalore', count: 1 },
      { role: 'base', name: 'City in the Clouds', subtitle: undefined, count: 1 },
      { role: 'deck', name: 'Covert Veteran', subtitle: undefined, count: 3 },
      { role: 'deck', name: 'Coronet', subtitle: 'Stately Vessel', count: 2 },
      { role: 'sideboard', name: 'Direct Hit', subtitle: undefined, count: 3 },
    ])
  })

  it('handles Sideboard appearing before MainDeck', () => {
    const text = ['Sideboard', '2 | Direct Hit', '', 'MainDeck', '3 | Covert Veteran'].join('\n')
    const parsed = parseDeckMelee(text)
    expect(parsed.entries.map(e => e.role)).toEqual(['sideboard', 'deck'])
  })

  it('ignores lines before any section header', () => {
    const text = ['3 | Stray Line', 'MainDeck', '3 | Covert Veteran'].join('\n')
    const parsed = parseDeckMelee(text)
    expect(parsed.entries).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// parseDeckPicklist
// ---------------------------------------------------------------------------

describe('parseDeckPicklist', () => {
  const sample = [
    'Picklist: So many MANDALORIANS!!!!!',
    '',
    '[ ]          Bo-Katan Kryze | Reclaiming Mandalore',
    '             ASH 010, ASH 274, ASH 776',
    '',
    '[ ]          City in the Clouds',
    '             JTL 019, JTL 281',
    '',
    '-----',
    '',
    '[ ] [ ] [ ]  Koska Reeves | Warrior of Mandalore',
    '             P26 194, ASH 079, ASH 343, ASH 581',
    '',
    '[ ] [ ]      Stronger Together',
    '             ASH 140, ASH 404, ASH 642',
    '',
    '-----',
    '',
    'Needed tokens: Advantage, Shield, Credit, Experience',
  ].join('\n')

  it('parses deck name, leader/base section, and main-deck section', () => {
    const parsed = parseDeckPicklist(sample)
    expect(parsed.deckName).toBe('So many MANDALORIANS!!!!!')
    expect(parsed.malformed).toEqual([])
    expect(parsed.entries).toEqual([
      {
        role: 'leaderOrBase',
        name: 'Bo-Katan Kryze',
        subtitle: 'Reclaiming Mandalore',
        count: 1,
        alternates: [
          { setKey: 'ASH', printingNumber: 10 },
          { setKey: 'ASH', printingNumber: 274 },
          { setKey: 'ASH', printingNumber: 776 },
        ],
      },
      {
        role: 'leaderOrBase',
        name: 'City in the Clouds',
        subtitle: undefined,
        count: 1,
        alternates: [
          { setKey: 'JTL', printingNumber: 19 },
          { setKey: 'JTL', printingNumber: 281 },
        ],
      },
      {
        role: 'deck',
        name: 'Koska Reeves',
        subtitle: 'Warrior of Mandalore',
        count: 3,
        alternates: [
          { setKey: 'P26', printingNumber: 194 },
          { setKey: 'ASH', printingNumber: 79 },
          { setKey: 'ASH', printingNumber: 343 },
          { setKey: 'ASH', printingNumber: 581 },
        ],
      },
      {
        role: 'deck',
        name: 'Stronger Together',
        subtitle: undefined,
        count: 2,
        alternates: [
          { setKey: 'ASH', printingNumber: 140 },
          { setKey: 'ASH', printingNumber: 404 },
          { setKey: 'ASH', printingNumber: 642 },
        ],
      },
    ])
  })

  it('treats a third section as sideboard', () => {
    const text = [
      'Picklist: Deck',
      '[ ] Leader Card',
      'ASH 1',
      '-----',
      '[ ] Deck Card',
      'ASH 2',
      '-----',
      '[ ] Side Card',
      'ASH 3',
    ].join('\n')
    const parsed = parseDeckPicklist(text)
    expect(parsed.entries.map(e => e.role)).toEqual(['leaderOrBase', 'deck', 'sideboard'])
  })

  it('ignores the trailing "Needed tokens:" line', () => {
    const parsed = parseDeckPicklist(sample)
    expect(parsed.entries.some(e => e.name.includes('Needed tokens'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseDeckGeneric
// ---------------------------------------------------------------------------

describe('parseDeckGeneric', () => {
  it('parses "qty Name (SET)"', () => {
    const parsed = parseDeckGeneric('3 Vanquish (SOR)')
    expect(parsed.entries).toEqual([{ role: 'deck', name: 'Vanquish', subtitle: undefined, count: 3, setHint: 'SOR' }])
  })

  it('parses "qtyx Name" with no set hint', () => {
    const parsed = parseDeckGeneric('3x Vanquish')
    expect(parsed.entries).toEqual([{ role: 'deck', name: 'Vanquish', subtitle: undefined, count: 3, setHint: undefined }])
  })

  it('parses "qty Name - Subtitle"', () => {
    const parsed = parseDeckGeneric('2 Coronet - Stately Vessel')
    expect(parsed.entries).toEqual([{ role: 'deck', name: 'Coronet', subtitle: 'Stately Vessel', count: 2, setHint: undefined }])
  })

  it('marks lines without a leading quantity as malformed', () => {
    const parsed = parseDeckGeneric('no count here')
    expect(parsed.entries).toEqual([])
    expect(parsed.malformed).toEqual(['no count here'])
  })

  it('parses the compact "qtyxSET_NUM" id shorthand with no space', () => {
    const parsed = parseDeckGeneric('3xASH_140')
    expect(parsed.entries).toEqual([
      { role: 'deck', name: 'ASH_140', count: 3, exact: { setKey: 'ASH', printingNumber: 140 } },
    ])
    expect(parsed.malformed).toEqual([])
  })

  it('parses several compact id lines, one per line', () => {
    const parsed = parseDeckGeneric('1xASH_010\n2xJTL_019')
    expect(parsed.entries).toEqual([
      { role: 'deck', name: 'ASH_010', count: 1, exact: { setKey: 'ASH', printingNumber: 10 } },
      { role: 'deck', name: 'JTL_019', count: 2, exact: { setKey: 'JTL', printingNumber: 19 } },
    ])
  })

  it('does not let the compact id shorthand swallow an ordinary "3x Card Name" line', () => {
    const parsed = parseDeckGeneric('3x Vanquish')
    expect(parsed.entries).toEqual([{ role: 'deck', name: 'Vanquish', subtitle: undefined, count: 3, setHint: undefined }])
  })
})

// ---------------------------------------------------------------------------
// resolveDeckList
// ---------------------------------------------------------------------------

describe('resolveDeckList', () => {
  it('resolves an exact (Format A style) identity', () => {
    const resolution = resolveDeckList(
      { format: 'json', entries: [{ role: 'deck', name: 'ASH_140', count: 2, exact: { setKey: 'ASH', printingNumber: 140 } }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.unresolved).toEqual([])
    expect(resolution.rows).toEqual([
      { role: 'deck', count: 2, setKey: 'ASH', baseNumber: 140, name: 'Stronger Together', subtitle: undefined, type: 'Unit', price: 2, ambiguous: false, ambiguousOtherSets: undefined },
    ])
  })

  it('falls through untracked alternates to the first tracked one (Format C style)', () => {
    const resolution = resolveDeckList(
      {
        format: 'picklist',
        entries: [
          {
            role: 'deck',
            name: 'Koska Reeves',
            subtitle: 'Warrior of Mandalore',
            count: 3,
            alternates: [
              { setKey: 'P26', printingNumber: 194 },
              { setKey: 'ASH', printingNumber: 79 },
            ],
          },
        ],
        malformed: [],
      },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.unresolved).toEqual([])
    expect(resolution.rows[0].setKey).toBe('ASH')
    expect(resolution.rows[0].baseNumber).toBe(79)
  })

  it('marks a card unresolved when none of its alternates are tracked', () => {
    const resolution = resolveDeckList(
      { format: 'picklist', entries: [{ role: 'deck', name: 'Promo Only', count: 1, alternates: [{ setKey: 'P26', printingNumber: 1 }] }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.rows).toEqual([])
    expect(resolution.unresolved).toEqual([{ role: 'deck', name: 'Promo Only', subtitle: undefined, count: 1, reason: 'unknown-set' }])
  })

  it('resolves a unique name-only match', () => {
    const resolution = resolveDeckList(
      { format: 'melee', entries: [{ role: 'deck', name: 'Coronet', subtitle: 'Stately Vessel', count: 2 }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.rows[0].setKey).toBe('SEC')
    expect(resolution.rows[0].ambiguous).toBe(false)
  })

  it('disambiguates a name matching multiple sets by preferring a set the user already owns', () => {
    const owned = (setKey: SetKey, baseNumber: number) => (setKey === 'JTL' && baseNumber === 999 ? 1 : 0)
    const resolution = resolveDeckList(
      { format: 'melee', entries: [{ role: 'deck', name: 'Vanquish', count: 3 }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      owned,
    )
    expect(resolution.rows[0].setKey).toBe('JTL')
    expect(resolution.rows[0].ambiguous).toBe(true)
    expect(resolution.rows[0].ambiguousOtherSets).toEqual(['ASH'])
  })

  it('disambiguates a name matching multiple sets by manifest order when nothing is owned', () => {
    const resolution = resolveDeckList(
      { format: 'melee', entries: [{ role: 'deck', name: 'Vanquish', count: 3 }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS, // ASH before JTL
      NO_OWNERSHIP,
    )
    expect(resolution.rows[0].setKey).toBe('ASH')
    expect(resolution.rows[0].ambiguous).toBe(true)
  })

  it('marks a name with no match anywhere as unresolved', () => {
    const resolution = resolveDeckList(
      { format: 'melee', entries: [{ role: 'deck', name: 'Nonexistent Card', count: 1 }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.rows).toEqual([])
    expect(resolution.unresolved).toEqual([{ role: 'deck', name: 'Nonexistent Card', subtitle: undefined, count: 1, reason: 'no-name-match' }])
  })

  it('marks an exact identity referencing an unknown printing as unresolved', () => {
    const resolution = resolveDeckList(
      { format: 'json', entries: [{ role: 'deck', name: 'ASH_9999', count: 1, exact: { setKey: 'ASH', printingNumber: 9999 } }], malformed: [] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.rows).toEqual([])
    expect(resolution.unresolved[0].reason).toBe('unknown-set')
  })

  it('reclassifies leaderOrBase entries using the resolved card Type', () => {
    const resolution = resolveDeckList(
      {
        format: 'picklist',
        entries: [
          { role: 'leaderOrBase', name: 'City in the Clouds', count: 1, alternates: [{ setKey: 'JTL', printingNumber: 19 }] },
          { role: 'leaderOrBase', name: 'Bo-Katan Kryze', subtitle: 'Reclaiming Mandalore', count: 1, alternates: [{ setKey: 'ASH', printingNumber: 10 }] },
        ],
        malformed: [],
      },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    const base = resolution.rows.find(r => r.baseNumber === 19)
    const leader = resolution.rows.find(r => r.baseNumber === 10)
    expect(base?.role).toBe('base')
    expect(leader?.role).toBe('leader')
  })

  it('falls back to first-is-leader/second-is-base ordering when Type is unavailable', () => {
    const resolution = resolveDeckList(
      {
        format: 'picklist',
        entries: [
          { role: 'leaderOrBase', name: 'Mystery Card A', count: 1, alternates: [{ setKey: 'ASH', printingNumber: 500 }] },
          { role: 'leaderOrBase', name: 'Mystery Card B', count: 1, alternates: [{ setKey: 'JTL', printingNumber: 501 }] },
        ],
        malformed: [],
      },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    const first = resolution.rows.find(r => r.baseNumber === 500)
    const second = resolution.rows.find(r => r.baseNumber === 501)
    expect(first?.role).toBe('leader')
    expect(second?.role).toBe('base')
  })

  it('auto-promotes Leader/Base-typed cards out of a generic plain list, since it has no sections', () => {
    const resolution = resolveDeckList(
      {
        format: 'generic',
        entries: [
          { role: 'deck', name: 'ASH_010', count: 1, exact: { setKey: 'ASH', printingNumber: 10 } },
          { role: 'deck', name: 'JTL_019', count: 1, exact: { setKey: 'JTL', printingNumber: 19 } },
          { role: 'deck', name: 'ASH_140', count: 2, exact: { setKey: 'ASH', printingNumber: 140 } },
        ],
        malformed: [],
      },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    const leader = resolution.rows.find(r => r.baseNumber === 10)
    const base = resolution.rows.find(r => r.baseNumber === 19)
    const unit = resolution.rows.find(r => r.baseNumber === 140)
    expect(leader?.role).toBe('leader')
    expect(base?.role).toBe('base')
    expect(unit?.role).toBe('deck')
  })

  it('does not promote Leader/Base-typed cards for non-generic formats — they must use explicit sections', () => {
    const resolution = resolveDeckList(
      {
        format: 'melee',
        entries: [{ role: 'deck', name: 'ASH_010', count: 1, exact: { setKey: 'ASH', printingNumber: 10 } }],
        malformed: [],
      },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.rows[0].role).toBe('deck')
  })

  it('surfaces malformed parser lines in the unresolved list', () => {
    const resolution = resolveDeckList(
      { format: 'generic', entries: [], malformed: ['garbled line'] },
      CATALOG,
      PARSED_SETS,
      TRACKED_SET_KEYS,
      NO_OWNERSHIP,
    )
    expect(resolution.unresolved).toEqual([{ role: 'deck', name: 'garbled line', count: 0, reason: 'malformed' }])
  })
})

// ---------------------------------------------------------------------------
// computeDeckRows / summarizeDeck
// ---------------------------------------------------------------------------

describe('computeDeckRows and summarizeDeck', () => {
  const baseRows = [
    { role: 'leader' as const, count: 1, setKey: 'ASH', baseNumber: 10, name: 'Bo-Katan Kryze', subtitle: 'Reclaiming Mandalore', type: 'Leader', price: 5, ambiguous: false },
    { role: 'base' as const, count: 1, setKey: 'JTL', baseNumber: 19, name: 'City in the Clouds', type: 'Base', price: 4, ambiguous: false },
    { role: 'deck' as const, count: 3, setKey: 'ASH', baseNumber: 140, name: 'Stronger Together', type: 'Unit', price: 2, ambiguous: false },
    { role: 'sideboard' as const, count: 2, setKey: 'SEC', baseNumber: 47, name: 'Coronet', subtitle: 'Stately Vessel', type: 'Unit', price: 2, ambiguous: false },
  ]

  it('computes have/needed/cost per row', () => {
    const owned = (setKey: SetKey, baseNumber: number) => (setKey === 'ASH' && baseNumber === 140 ? 1 : 0)
    const computed = computeDeckRows(baseRows, owned)
    const stronger = computed.find(r => r.baseNumber === 140)!
    expect(stronger.have).toBe(1)
    expect(stronger.needed).toBe(2)
    expect(stronger.rowCost).toBe(4)
  })

  it('floors needed at zero when the user owns enough', () => {
    const owned = () => 10
    const computed = computeDeckRows(baseRows, owned)
    expect(computed.every(r => r.needed === 0)).toBe(true)
  })

  it('excludes sideboard from totals by default', () => {
    const computed = computeDeckRows(baseRows, NO_OWNERSHIP)
    const summary = summarizeDeck(computed, false)
    // leader(1) + base(1) + deck(3) = 5, sideboard(2) excluded
    expect(summary.totalNeededCards).toBe(5)
  })

  it('includes sideboard in totals when toggled on', () => {
    const computed = computeDeckRows(baseRows, NO_OWNERSHIP)
    const summary = summarizeDeck(computed, true)
    expect(summary.totalNeededCards).toBe(7)
  })

  it('reports leaderOwned/baseOwned based on ownership, and null when absent', () => {
    const owned = (setKey: SetKey, baseNumber: number) => (setKey === 'ASH' && baseNumber === 10 ? 1 : 0)
    const computed = computeDeckRows(baseRows, owned)
    const summary = summarizeDeck(computed, false)
    expect(summary.leaderOwned).toBe(true)
    expect(summary.baseOwned).toBe(false)

    const noLeaderBase = computeDeckRows(baseRows.filter(r => r.role === 'deck'), NO_OWNERSHIP)
    const summaryNoLeaderBase = summarizeDeck(noLeaderBase, false)
    expect(summaryNoLeaderBase.leaderOwned).toBeNull()
    expect(summaryNoLeaderBase.baseOwned).toBeNull()
  })

  it('requires ALL leader rows to be owned for a Twin Suns two-leader deck', () => {
    const twinSunsRows = [
      ...baseRows,
      { role: 'leader' as const, count: 1, setKey: 'SEC', baseNumber: 1, name: 'Second Leader', type: 'Leader', price: 3, ambiguous: false },
    ]

    // Only the first leader (ASH:10) is owned; the second (SEC:1) is not.
    const ownedFirstOnly = (setKey: SetKey, baseNumber: number) => (setKey === 'ASH' && baseNumber === 10 ? 1 : 0)
    const partial = summarizeDeck(computeDeckRows(twinSunsRows, ownedFirstOnly), false)
    expect(partial.leaderOwned).toBe(false)

    // Both leaders owned.
    const ownedBoth = (setKey: SetKey, baseNumber: number) =>
      (setKey === 'ASH' && baseNumber === 10) || (setKey === 'SEC' && baseNumber === 1) ? 1 : 0
    const complete = summarizeDeck(computeDeckRows(twinSunsRows, ownedBoth), false)
    expect(complete.leaderOwned).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// formatMissingLine
// ---------------------------------------------------------------------------

describe('formatMissingLine', () => {
  it('formats with a subtitle', () => {
    expect(formatMissingLine('Bo-Katan Kryze', 'Reclaiming Mandalore', 'ASH', 2)).toBe(
      '2 Bo-Katan Kryze - Reclaiming Mandalore [ASH]',
    )
  })

  it('formats without a subtitle', () => {
    expect(formatMissingLine('Stronger Together', undefined, 'ASH', 3)).toBe('3 Stronger Together [ASH]')
  })
})
