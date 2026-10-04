import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';

import { db } from '~/data/db';
import { updateDeckLibrary } from '~/data/deckLibrary';
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
  applyDeconstruct,
  type TakeFromDeck,
  type VariantLookup,
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
  const row = useLiveQuery(() => db.deckLibrary.get('library'), []);

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
    async (
      deckId: string,
      fromBinder: DeckCardRef[],
      takes: TakeFromDeck[],
      owned: VariantLookup,
    ) => {
      await updateDeckLibrary((current) =>
        applyConstruct(current, deckId, fromBinder, takes, owned),
      );
    },
    [],
  );

  const deconstruct = useCallback(async (deckId: string) => {
    await updateDeckLibrary((current) => applyDeconstruct(current, deckId));
  }, []);

  const adjustBox = useCallback(
    async (
      deckId: string,
      setKey: SetKey,
      baseNumber: number,
      delta: 1 | -1,
      max: number,
      owned: VariantLookup,
    ) => {
      await updateDeckLibrary((current) =>
        adjustInBox(current, deckId, setKey, baseNumber, delta, max, owned),
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
