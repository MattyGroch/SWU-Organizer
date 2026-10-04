import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { queueDeck } from '~/data/intake';

import type { LoadedSet } from '~/domain/catalog';
import { binderAvailable, type OwnedLookup, type VariantLookup } from '~/domain/deckBuild';
import type { DeckLookupSet } from '~/domain/decklist';
import type { SavedDeck } from '~/domain/decks';
import type { OwnedCounts } from '~/domain/ownership';
import type { PreconCatalogEntry } from '~/domain/precons';
import type { SetKey } from '~/domain/types';
import { useToast } from '~/ui/toastContext';

import { DeckCheck } from './DeckCheck';
import styles from './DecksPage.module.css';
import { PickListDialog } from './PickListDialog';
import { PreconList } from './PreconList';
import { SavedDecks } from './SavedDecks';
import { useDeckLibrary } from './useDeckLibrary';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  binderOwnership: Map<SetKey, ReadonlyMap<number, OwnedCounts>>;
  precons: PreconCatalogEntry[];
};

export function DecksPage({ sets, binderOwnership, precons }: Props) {
  const deckLibrary = useDeckLibrary();
  const { library, loading } = deckLibrary;
  const showToast = useToast();
  const navigate = useNavigate();
  const [pickList, setPickList] = useState<{
    id: string;
    mode: 'construct' | 'deconstruct';
  } | null>(null);

  const lookup = useMemo<Map<SetKey, DeckLookupSet>>(() => {
    const map = new Map<SetKey, DeckLookupSet>();
    for (const [setKey, set] of sets) {
      map.set(setKey, { byNumber: set.byNumber, baseCards: set.baseCards });
    }
    return map;
  }, [sets]);
  const setOrder = useMemo(() => [...sets.keys()], [sets]);

  /**
   * Copies you can build with: the whole collection, spares and cards already in built
   * decks included. Precons are left out on purpose — they stay sealed, so their cards are
   * owned but never available to a deck.
   */
  const owned = useMemo<OwnedLookup>(
    () => (setKey, base) => binderOwnership.get(setKey)?.get(base)?.total ?? 0,
    [binderOwnership],
  );
  /** The same, per printing — what decks need to know which printings they hold. */
  const ownedVariants = useMemo<VariantLookup>(
    () => (setKey, base) => binderOwnership.get(setKey)?.get(base)?.byVariant ?? {},
    [binderOwnership],
  );

  const inBinder = useMemo(() => binderAvailable(ownedVariants, library), [ownedVariants, library]);

  function onDelete(deck: SavedDeck, index: number) {
    void deckLibrary.deleteDeck(deck.id);
    showToast({
      tone: 'danger',
      message: `Deleted “${deck.name}”.`,
      action: { label: 'Undo', onAction: () => deckLibrary.restoreDeck(deck, index) },
    });
  }

  async function onQueue(deck: SavedDeck) {
    await queueDeck(deck, sets);
    showToast({
      tone: 'info',
      message: `“${deck.name}” queued — check its printings, then add it.`,
    });
    void navigate({ to: '/intake' });
  }

  const pickListDeck = pickList
    ? (library.customDecks.find((d) => d.id === pickList.id) ?? null)
    : null;

  return (
    <div className={styles.page}>
      <SavedDecks
        library={library}
        loading={loading}
        lookup={lookup}
        owned={owned}
        ownedVariants={ownedVariants}
        binderAvailable={inBinder}
        onUpdate={(id, patch) => void deckLibrary.updateDeck(id, patch)}
        onDelete={onDelete}
        onOpenPickList={(deck, mode) => setPickList({ id: deck.id, mode })}
        onQueue={(deck) => void onQueue(deck)}
        onAdjustBox={(deck, row, delta, max) =>
          void deckLibrary.adjustBox(deck.id, row.setKey, row.baseNumber, delta, max, ownedVariants)
        }
      />

      <DeckCheck sets={sets} lookup={lookup} owned={owned} onSave={deckLibrary.addDeck} />

      <PreconList
        precons={precons}
        ownership={library.preconOwnership}
        onToggle={(key) => void deckLibrary.togglePrecon(key)}
        onSetOwned={(keys, value) => void deckLibrary.setPreconsOwned(keys, value)}
      />

      {pickList && pickListDeck && (
        <PickListDialog
          // A fresh dialog per open, so choices from a previous one never carry over.
          key={`${pickList.id}:${pickList.mode}`}
          deck={pickListDeck}
          mode={pickList.mode}
          library={library}
          lookup={lookup}
          setOrder={setOrder}
          owned={ownedVariants}
          onClose={() => setPickList(null)}
          onConstruct={(fromBinder, takes) =>
            void deckLibrary.construct(pickListDeck.id, fromBinder, takes, ownedVariants)
          }
          onDeconstruct={() => void deckLibrary.deconstruct(pickListDeck.id)}
        />
      )}
    </div>
  );
}
