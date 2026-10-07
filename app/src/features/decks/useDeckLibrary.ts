import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';

import { db } from '~/data/db';
import { deconstructDeck, updateDeckLibrary } from '~/data/deckLibrary';
import type { QuotaOf } from '~/data/spill';
import {
  createSavedDeck,
  emptyDeckLibrary,
  parseDeckLibrary,
  type DeckLibrary,
  type NewSavedDeckInput,
  type SavedDeck,
} from '~/domain/decks';
import {
  adjustInBox,
  applyConstruct,
  type HomeLookup,
  type TakeFromDeck,
} from '~/domain/deckBuild';
import type { DeckCardRef } from '~/domain/deckContents';
import type { ResolvedDeckRow } from '~/domain/decklist';
import type { SetKey } from '~/domain/types';

/**
 * Live deck library, with the mutations the Decks view needs.
 *
 * Reads go through `useLiveQuery`, so a change from anywhere — this tab, another tab, a
 * sync pull — re-renders without explicit notification plumbing.
 */
export function useDeckLibrary() {
  // `null` when no library has been saved yet: `undefined` must mean only "not read yet",
  // or a device that has never saved a deck would wait on it forever.
  const row = useLiveQuery(async () => (await db.deckLibrary.get('library')) ?? null, []);

  const library = useMemo<DeckLibrary>(
    () => (row === undefined ? emptyDeckLibrary : parseDeckLibrary(row?.json ?? null)),
    [row],
  );

  const togglePrecon = useCallback(async (key: string) => {
    await updateDeckLibrary((current) => {
      const owned = (current.preconOwnership[key] ?? 0) > 0;
      return {
        ...current,
        preconOwnership: { ...current.preconOwnership, [key]: owned ? 0 : 1 },
      };
    });
  }, []);

  const setPreconCopies = useCallback(async (key: string, copies: number) => {
    await updateDeckLibrary((current) => ({
      ...current,
      preconOwnership: { ...current.preconOwnership, [key]: Math.max(0, Math.floor(copies)) },
    }));
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
      return { ...current, preconOwnership };
    });
  }, []);

  const construct = useCallback(
    async (deckId: string, pulls: DeckCardRef[], takes: TakeFromDeck[], homes: HomeLookup) => {
      await updateDeckLibrary((current) => applyConstruct(current, deckId, pulls, takes, homes));
    },
    [],
  );

  /** Returns how many copies went to the bulk box because their pocket had filled up. */
  const deconstruct = useCallback(
    (deckId: string, quotaOf: QuotaOf) => deconstructDeck(deckId, quotaOf),
    [],
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
      await updateDeckLibrary((current) =>
        adjustInBox(current, deckId, setKey, baseNumber, delta, max, homes),
      );
    },
    [],
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
    adjustBox,
  };
}
