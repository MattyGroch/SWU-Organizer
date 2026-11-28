import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';

import { db } from '~/data/db';
import { useSharedCollection } from '~/data/shared';
import {
  deconstructDeck,
  editDeck,
  readDeckLibrary,
  updateDeckLibrary,
  writeDeckLibrary,
} from '~/data/deckLibrary';
import type { QuotaOf } from '~/data/spill';
import {
  createSavedDeck,
  emptyDeckLibrary,
  parseDeckLibrary,
  preconDeckId,
  withoutPrecons,
  withPrecons,
  type DeckLibrary,
  type NewSavedDeckInput,
  type SavedDeck,
} from '~/domain/decks';
import {
  adjustInBox,
  applyConstruct,
  swapAllInBox,
  swapInBox,
  type AppliedSwap,
  type DeckEdit,
  type HomeLookup,
  type TakeFromDeck,
} from '~/domain/deckBuild';
import type { VariantSlug } from '~/domain/catalog';
import type { DeckCardRef } from '~/domain/deckContents';
import type { PreconCatalogEntry } from '~/domain/precons';
import type { ResolvedDeckRow } from '~/domain/decklist';
import type { SetKey } from '~/domain/types';

/**
 * Live deck library, with the mutations the Decks view needs.
 *
 * Reads go through `useLiveQuery`, so a change from anywhere — this tab, another tab, a
 * sync pull — re-renders without explicit notification plumbing.
 */
const NO_PRECONS: PreconCatalogEntry[] = [];

/** A library with the deck that stood in for each precon in `keys` forgotten. */
function forgetPreconDecks(library: DeckLibrary, keys: readonly string[]): DeckLibrary {
  const ids = new Set(keys.map(preconDeckId));
  return { ...library, customDecks: library.customDecks.filter((deck) => !ids.has(deck.id)) };
}

/**
 * Pass the precon catalog to see owned precons as built decks beside the saved ones (see
 * `withPrecons`); without it, `library` is exactly what is stored.
 */
export function useDeckLibrary(precons: PreconCatalogEntry[] = NO_PRECONS) {
  // `null` when no library has been saved yet: `undefined` must mean only "not read yet",
  // or a device that has never saved a deck would wait on it forever.
  // Viewing a share, the decks are the owner's: what they hold out of the binder.
  const shared = useSharedCollection();
  const row = useLiveQuery(
    async () => (shared ? undefined : ((await db.deckLibrary.get('library')) ?? null)),
    [shared],
  );

  const library = useMemo<DeckLibrary>(() => {
    const stored = shared
      ? shared.library
      : row === undefined
        ? emptyDeckLibrary
        : parseDeckLibrary(row?.json ?? null);
    return withPrecons(stored, precons);
  }, [row, shared, precons]);

  /** An update made on the library as the view shows it, saved back without the stand-ins. */
  const updateWithPrecons = useCallback(
    async (update: (current: DeckLibrary) => DeckLibrary) => {
      await updateDeckLibrary((current) => withoutPrecons(update(withPrecons(current, precons))));
    },
    [precons],
  );

  const togglePrecon = useCallback(async (key: string) => {
    await updateDeckLibrary((current) => {
      const owned = (current.preconOwnership[key] ?? 0) > 0;
      const next = {
        ...current,
        preconOwnership: { ...current.preconOwnership, [key]: owned ? 0 : 1 },
      };
      // Not owned any more: copies refilled into it from the binder are simply back there.
      return owned ? forgetPreconDecks(next, [key]) : next;
    });
  }, []);

  const setPreconCopies = useCallback(async (key: string, copies: number) => {
    await updateDeckLibrary((current) => {
      const next = {
        ...current,
        preconOwnership: { ...current.preconOwnership, [key]: Math.max(0, Math.floor(copies)) },
      };
      return copies > 0 ? next : forgetPreconDecks(next, [key]);
    });
  }, []);

  const addDeck = useCallback(async (rows: ResolvedDeckRow[], input: NewSavedDeckInput) => {
    const result = createSavedDeck(rows, input);
    if (!result.ok) return result;
    await updateDeckLibrary((current) => ({
      ...current,
      customDecks: [...current.customDecks, result.deck],
    }));
    return result;
  }, []);

  const updateDeck = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<SavedDeck, 'name' | 'physical' | 'copies' | 'constructed' | 'pulledCards'>
      >,
    ) => {
      await updateDeckLibrary((current) => ({
        ...current,
        customDecks: current.customDecks.map((deck) =>
          deck.id === id ? { ...deck, ...patch, updatedAt: new Date().toISOString() } : deck,
        ),
      }));
    },
    [],
  );

  const deleteDeck = useCallback(async (id: string) => {
    await updateDeckLibrary((current) => ({
      ...current,
      customDecks: current.customDecks.filter((deck) => deck.id !== id),
      // Remembered so a sync merge with another device cannot bring the deck back.
      deletedDecks: { ...current.deletedDecks, [id]: new Date().toISOString() },
    }));
  }, []);

  /** Sets several precons owned or not in one write — the select all / none buttons. */
  const setPreconsOwned = useCallback(async (keys: readonly string[], owned: boolean) => {
    await updateDeckLibrary((current) => {
      const preconOwnership = { ...current.preconOwnership };
      for (const key of keys) preconOwnership[key] = owned ? 1 : 0;
      const next = { ...current, preconOwnership };
      return owned ? next : forgetPreconDecks(next, keys);
    });
  }, []);

  const construct = useCallback(
    async (deckId: string, pulls: DeckCardRef[], takes: TakeFromDeck[], homes: HomeLookup) => {
      await updateWithPrecons((current) => applyConstruct(current, deckId, pulls, takes, homes));
    },
    [updateWithPrecons],
  );

  /** Returns how many copies went to the bulk box because their pocket had filled up. */
  const deconstruct = useCallback(
    (deckId: string, quotaOf: QuotaOf) =>
      deconstructDeck(deckId, quotaOf, undefined, undefined, precons),
    [precons],
  );

  /** Saves an edited list; cards it drops refill any precon missing them before going home. */
  const edit = useCallback(
    (deckId: string, change: DeckEdit, quotaOf: QuotaOf) =>
      editDeck(deckId, change, quotaOf, undefined, undefined, precons),
    [precons],
  );

  const adjustBox = useCallback(
    async (
      deckId: string,
      setKey: SetKey,
      baseNumber: number,
      delta: 1 | -1,
      max: number,
      homes: HomeLookup,
    ) => {
      await updateWithPrecons((current) =>
        adjustInBox(current, deckId, setKey, baseNumber, delta, max, homes),
      );
    },
    [updateWithPrecons],
  );

  /**
   * Trades one copy in a built deck's box for a better printing from the binder. Writes
   * only when the swap still holds, and returns where the old copy goes (`toBulk`), or
   * null when it no longer applies and nothing was written.
   */
  const swap = useCallback(
    async (
      deckId: string,
      setKey: SetKey,
      baseNumber: number,
      from: VariantSlug,
      to: VariantSlug,
      homes: HomeLookup,
    ): Promise<{ toBulk: boolean } | null> => {
      const result = swapInBox(
        withPrecons(await readDeckLibrary(), precons),
        deckId,
        setKey,
        baseNumber,
        from,
        to,
        homes,
      );
      if (!result) return null;
      await writeDeckLibrary(withoutPrecons(result.library));
      return { toBulk: result.toBulk };
    },
    [precons],
  );

  /**
   * Every swap in `swaps` for one deck, in a single write. Each is re-checked against the
   * stored library, so any that no longer hold are skipped. Returns what was applied.
   */
  const swapAll = useCallback(
    async (
      deckId: string,
      swaps: Parameters<typeof swapAllInBox>[2],
      homes: HomeLookup,
    ): Promise<AppliedSwap[]> => {
      const result = swapAllInBox(
        withPrecons(await readDeckLibrary(), precons),
        deckId,
        swaps,
        homes,
      );
      if (result.applied.length) await writeDeckLibrary(withoutPrecons(result.library));
      return result.applied;
    },
    [precons],
  );

  /** Puts a deleted deck back where it was — the undo for `deleteDeck`. */
  const restoreDeck = useCallback(async (deck: SavedDeck, index: number) => {
    await updateDeckLibrary((current) => {
      if (current.customDecks.some((d) => d.id === deck.id)) return current;
      const customDecks = [...current.customDecks];
      // Restored now, so it is newer than its own deletion on every device.
      customDecks.splice(Math.min(index, customDecks.length), 0, {
        ...deck,
        updatedAt: new Date().toISOString(),
      });
      const deletedDecks = { ...current.deletedDecks };
      delete deletedDecks[deck.id];
      return { ...current, customDecks, deletedDecks };
    });
  }, []);

  return {
    library,
    /** `undefined` until the first read resolves, so the UI can avoid a flash of "no decks". */
    loading: row === undefined,
    togglePrecon,
    setPreconCopies,
    addDeck,
    updateDeck,
    deleteDeck,
    restoreDeck,
    setPreconsOwned,
    construct,
    deconstruct,
    edit,
    adjustBox,
    swap,
    swapAll,
  };
}
