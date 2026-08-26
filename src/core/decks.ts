import type { ResolvedDeckRow } from './decklist'
import {
  addDeckContentsToTotals,
  deckContentsFromRows,
  isDeckCardRef,
  isDeckContents,
  type DeckCardRef,
  type DeckContents,
  type DeckContentsFailureReason,
  type OwnedTotals,
} from './deckContents'
import type { PreconCatalogEntry } from './precons'

export type SavedDeck = DeckContents & {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** True = these are real extra cards not already counted in the binder (e.g. a fully-built/boxed deck). */
  physical: boolean
  /** Physical copies owned; only meaningful when `physical` is true. */
  copies: number
  /** Original pasted text, kept so the deck can be re-parsed/edited later. */
  sourceText: string
  /** True once the user has pulled this deck's cards out of the binders and physically assembled it. */
  constructed: boolean
  /** Snapshot of exactly what was pulled from the binder at construct time. Only meaningful while constructed=true; cleared on deconstruct. */
  pulledCards: DeckCardRef[]
}

export type DeckLibrary = {
  customDecks: SavedDeck[]
  /** precon catalog key -> owned copies (0 or 1 in practice). */
  preconOwnership: Record<string, number>
}

export const DECKS_STORAGE_KEY = 'decks:v1'

export const emptyDeckLibrary: DeckLibrary = { customDecks: [], preconOwnership: {} }

export type NewSavedDeckInput = {
  name: string
  physical: boolean
  copies: number
  sourceText: string
}

export type CreateSavedDeckResult =
  | { ok: true; deck: SavedDeck }
  | { ok: false; reason: DeckContentsFailureReason }

/** Describes the problem only; callers add what it blocks ("it can't be saved yet", etc.). */
const DECK_CONTENTS_FAILURE_MESSAGE: Record<DeckContentsFailureReason, string> = {
  'missing-leader': "This decklist doesn't have a leader.",
  'missing-base': "This decklist doesn't have a base.",
  'too-many-leaders':
    "This decklist's leaders don't fit a deck — Premier takes one leader, Twin Suns takes two different ones.",
  'too-many-bases': 'This decklist has more than one base.',
}

export function deckContentsFailureMessage(reason: DeckContentsFailureReason): string {
  return DECK_CONTENTS_FAILURE_MESSAGE[reason]
}

export function createSavedDeck(
  rows: ResolvedDeckRow[],
  input: NewSavedDeckInput,
  deps: { now?: () => string; makeId?: () => string } = {},
): CreateSavedDeckResult {
  const now = deps.now ?? (() => new Date().toISOString())
  const makeId = deps.makeId ?? (() => crypto.randomUUID())
  const contentsResult = deckContentsFromRows(rows)
  if (!contentsResult.ok) return { ok: false, reason: contentsResult.reason }

  const timestamp = now()
  return {
    ok: true,
    deck: {
      ...contentsResult.contents,
      id: makeId(),
      name: input.name.trim() || 'Untitled deck',
      createdAt: timestamp,
      updatedAt: timestamp,
      physical: input.physical,
      copies: Math.max(1, Math.floor(input.copies) || 1),
      sourceText: input.sourceText,
      constructed: false,
      pulledCards: [],
    },
  }
}

/** Owned totals contributed by the deck library: owned precons + physical custom decks, uncapped. */
export function deriveOwnedTotals(
  library: DeckLibrary,
  preconCatalog: PreconCatalogEntry[],
): OwnedTotals {
  const totals: OwnedTotals = {}

  for (const entry of preconCatalog) {
    const owned = library.preconOwnership[entry.key] ?? 0
    addDeckContentsToTotals(totals, entry.contents, owned)
  }

  for (const deck of library.customDecks) {
    if (!deck.physical) continue
    addDeckContentsToTotals(totals, deck, deck.copies)
  }

  return totals
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSavedDeck(value: unknown): value is SavedDeck {
  if (!isRecord(value) || !isDeckContents(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.physical === 'boolean' &&
    Number.isFinite(v.copies) &&
    typeof v.sourceText === 'string' &&
    (v.constructed === undefined || typeof v.constructed === 'boolean') &&
    (v.pulledCards === undefined || (Array.isArray(v.pulledCards) && v.pulledCards.every(isDeckCardRef)))
  )
}

function isPreconOwnership(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(v => typeof v === 'number' && Number.isFinite(v))
}

export function parseDeckLibrary(raw: string | null): DeckLibrary {
  if (!raw) return { ...emptyDeckLibrary }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...emptyDeckLibrary }
    const customDecks = Array.isArray(parsed.customDecks)
      ? parsed.customDecks
          .filter(isSavedDeck)
          .map(d => ({ ...d, constructed: d.constructed ?? false, pulledCards: d.pulledCards ?? [] }))
      : []
    const preconOwnership = isPreconOwnership(parsed.preconOwnership) ? parsed.preconOwnership : {}
    return { customDecks, preconOwnership }
  } catch {
    return { ...emptyDeckLibrary }
  }
}

export function loadDeckLibrary(storage: Pick<Storage, 'getItem'>): DeckLibrary {
  try {
    return parseDeckLibrary(storage.getItem(DECKS_STORAGE_KEY))
  } catch {
    return { ...emptyDeckLibrary }
  }
}

export function persistDeckLibrary(storage: Pick<Storage, 'setItem'>, library: DeckLibrary): boolean {
  try {
    storage.setItem(DECKS_STORAGE_KEY, JSON.stringify(library))
    return true
  } catch {
    return false
  }
}
