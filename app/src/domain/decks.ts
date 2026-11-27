import type { ResolvedDeckRow } from './decklist';
import {
  addDeckContentsToTotals,
  deckContentsFromRows,
  isDeckCardRef,
  isDeckContents,
  type DeckCardRef,
  type DeckContents,
  type DeckContentsFailureReason,
  type OwnedTotals,
} from './deckContents';
import { isPlayFormat, type PlayFormat } from './deckLegality';
import type { PreconCatalogEntry } from './precons';
import { newId } from './id';
import type { SetKey } from './types';

/**
 * Copies of one card taken out of an owned precon's box and now sitting in a built deck's
 * box. The precon's copies are not in the binder or the bulk box, so they cannot go back
 * by the usual home: this record says which precon each one returns to.
 */
export type PreconLoan = {
  preconKey: string;
  setKey: SetKey;
  baseNumber: number;
  count: number;
};

export type SavedDeck = DeckContents & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** True = these are real extra cards not already counted in the binder (e.g. a fully-built/boxed deck). */
  physical: boolean;
  /** Physical copies owned; only meaningful when `physical` is true. */
  copies: number;
  /** Original pasted text, kept so the deck can be re-parsed/edited later. */
  sourceText: string;
  /** True once the user has pulled this deck's cards out of the binders and physically assembled it. */
  constructed: boolean;
  /** Snapshot of exactly what was pulled from the binder at construct time. Only meaningful while constructed=true; cleared on deconstruct. */
  pulledCards: DeckCardRef[];
  /** The format it is built for. Absent on decks saved before formats were stored. */
  format?: PlayFormat;
  /**
   * Cards this built deck holds that belong to precons. Only meaningful while
   * `constructed`; cleared on deconstruct, which puts each back in its precon.
   */
  borrowed?: PreconLoan[];
  /**
   * Set on the deck that stands for an owned precon (see `withPrecons`): the precon's
   * catalog key. Its box holds the precon's own copies plus any pulled in from the binder.
   */
  precon?: string;
};

/** A deck's format; older decks without one are Twin Suns with two leaders, else Premier. */
export function deckFormat(deck: DeckContents & { format?: PlayFormat }): PlayFormat {
  return deck.format ?? (deck.secondLeader ? 'twinSuns' : 'premier');
}

export type DeckLibrary = {
  customDecks: SavedDeck[];
  /** precon catalog key -> owned copies (0 or 1 in practice). */
  preconOwnership: Record<string, number>;
  /**
   * Deck id -> ISO time it was deleted. Lets two devices' libraries merge without a
   * deleted deck coming back from the device that had not seen the deletion.
   */
  deletedDecks?: Record<string, string>;
};

export const emptyDeckLibrary: DeckLibrary = { customDecks: [], preconOwnership: {} };

export type NewSavedDeckInput = {
  name: string;
  physical: boolean;
  copies: number;
  sourceText: string;
  format?: PlayFormat;
};

export type CreateSavedDeckResult =
  { ok: true; deck: SavedDeck } | { ok: false; reason: DeckContentsFailureReason };

/** Describes the problem only; callers add what it blocks ("it can't be saved yet", etc.). */
const DECK_CONTENTS_FAILURE_MESSAGE: Record<DeckContentsFailureReason, string> = {
  'missing-leader': "This decklist doesn't have a leader.",
  'missing-base': "This decklist doesn't have a base.",
  'too-many-leaders':
    "This decklist's leaders don't fit a deck — Premier takes one leader, Twin Suns takes two different ones.",
  'too-many-bases': 'This decklist has more than one base.',
};

export function deckContentsFailureMessage(reason: DeckContentsFailureReason): string {
  return DECK_CONTENTS_FAILURE_MESSAGE[reason];
}

export function createSavedDeck(
  rows: ResolvedDeckRow[],
  input: NewSavedDeckInput,
  deps: { now?: () => string; makeId?: () => string } = {},
): CreateSavedDeckResult {
  const now = deps.now ?? (() => new Date().toISOString());
  const makeId = deps.makeId ?? (() => newId());
  const contentsResult = deckContentsFromRows(rows);
  if (!contentsResult.ok) return { ok: false, reason: contentsResult.reason };

  const timestamp = now();
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
      ...(input.format && { format: input.format }),
    },
  };
}

export type NewDeckInput = {
  name: string;
  format: PlayFormat;
  leader: DeckCardRef;
  secondLeader?: DeckCardRef;
  base: DeckCardRef;
};

/**
 * A deck started in the builder: its format, leaders and base, and nothing else yet. It
 * is not in the library until the editor saves it.
 */
export function newDeck(
  input: NewDeckInput,
  deps: { now?: () => string; makeId?: () => string } = {},
): SavedDeck {
  const timestamp = (deps.now ?? (() => new Date().toISOString()))();
  const one = (ref: DeckCardRef): DeckCardRef => ({
    setKey: ref.setKey,
    baseNumber: ref.baseNumber,
    count: 1,
  });
  return {
    id: (deps.makeId ?? newId)(),
    name: input.name.trim() || 'Untitled deck',
    createdAt: timestamp,
    updatedAt: timestamp,
    physical: false,
    copies: 1,
    sourceText: '',
    constructed: false,
    pulledCards: [],
    format: input.format,
    leader: one(input.leader),
    ...(input.format === 'twinSuns' &&
      input.secondLeader && { secondLeader: one(input.secondLeader) }),
    base: one(input.base),
    mainDeck: [],
    sideboard: [],
  };
}

export const PRECON_DECK_PREFIX = 'precon:';
export const preconDeckId = (key: string): string => `${PRECON_DECK_PREFIX}${key}`;

/**
 * The library as the Decks view sees it: each owned precon stands in as a built deck,
 * after the saved ones. It is derived, so nothing is stored until a precon is refilled
 * from the binder: only then is its deck kept in `customDecks`, holding just those
 * pulled-in cards. Its list always comes from the catalog.
 */
export function withPrecons(library: DeckLibrary, catalog: PreconCatalogEntry[]): DeckLibrary {
  const stored = new Map(library.customDecks.map((deck) => [deck.id, deck]));
  const listed = new Set(catalog.map((entry) => preconDeckId(entry.key)));
  const standIns: SavedDeck[] = [];
  for (const entry of catalog) {
    if ((library.preconOwnership[entry.key] ?? 0) <= 0) continue;
    const id = preconDeckId(entry.key);
    const own = stored.get(id);
    const { secondLeader, ...contents } = entry.contents;
    standIns.push({
      ...contents,
      ...(secondLeader && { secondLeader }),
      id,
      name: entry.label,
      createdAt: own?.createdAt ?? '',
      updatedAt: own?.updatedAt ?? '',
      physical: false,
      copies: 1,
      sourceText: '',
      constructed: true,
      pulledCards: own?.pulledCards ?? [],
      format: secondLeader ? 'twinSuns' : 'premier',
      precon: entry.key,
    });
  }
  return {
    ...library,
    // A stored precon deck is replaced by its stand-in, or dropped once the precon is no
    // longer owned. One the catalog did not load is left alone, so a write cannot lose it.
    customDecks: [...library.customDecks.filter((deck) => !listed.has(deck.id)), ...standIns],
  };
}

/**
 * The inverse of `withPrecons`, for saving. A precon's deck is kept only while it holds
 * cards pulled in from the binder; one that holds none is derived again on the next read.
 */
export function withoutPrecons(library: DeckLibrary): DeckLibrary {
  return {
    ...library,
    customDecks: library.customDecks.filter((deck) => !deck.precon || deck.pulledCards.length > 0),
  };
}

/** Owned totals contributed by the deck library: owned precons + physical custom decks, uncapped. */
export function deriveOwnedTotals(
  library: DeckLibrary,
  preconCatalog: PreconCatalogEntry[],
): OwnedTotals {
  const totals: OwnedTotals = {};

  for (const entry of preconCatalog) {
    const owned = library.preconOwnership[entry.key] ?? 0;
    addDeckContentsToTotals(totals, entry.contents, owned);
  }

  for (const deck of library.customDecks) {
    if (!deck.physical) continue;
    addDeckContentsToTotals(totals, deck, deck.copies);
  }

  return totals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSavedDeck(value: unknown): value is SavedDeck {
  if (!isRecord(value) || !isDeckContents(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.physical === 'boolean' &&
    Number.isFinite(v.copies) &&
    typeof v.sourceText === 'string' &&
    (v.constructed === undefined || typeof v.constructed === 'boolean') &&
    (v.format === undefined || isPlayFormat(v.format)) &&
    (v.pulledCards === undefined ||
      (Array.isArray(v.pulledCards) && v.pulledCards.every(isDeckCardRef)))
  );
}

function isPreconLoan(value: unknown): value is PreconLoan {
  return (
    isRecord(value) &&
    typeof value.preconKey === 'string' &&
    typeof value.setKey === 'string' &&
    Number.isInteger(value.baseNumber) &&
    Number.isInteger(value.count) &&
    (value.count as number) > 0
  );
}

function isDeletedDecks(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
}

function isPreconOwnership(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

export function parseDeckLibrary(raw: string | null): DeckLibrary {
  if (!raw) return { ...emptyDeckLibrary };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...emptyDeckLibrary };
    const customDecks = Array.isArray(parsed.customDecks)
      ? parsed.customDecks.filter(isSavedDeck).map((d) => {
          const { borrowed, ...rest } = d;
          const loans = Array.isArray(borrowed) ? borrowed.filter(isPreconLoan) : [];
          return {
            ...rest,
            constructed: d.constructed ?? false,
            pulledCards: d.pulledCards ?? [],
            ...(loans.length > 0 && { borrowed: loans }),
          };
        })
      : [];
    const preconOwnership = isPreconOwnership(parsed.preconOwnership) ? parsed.preconOwnership : {};
    const deletedDecks = isDeletedDecks(parsed.deletedDecks) ? parsed.deletedDecks : undefined;
    return deletedDecks
      ? { customDecks, preconOwnership, deletedDecks }
      : { customDecks, preconOwnership };
  } catch {
    return { ...emptyDeckLibrary };
  }
}
