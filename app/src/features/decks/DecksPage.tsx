import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { queueDeck } from '~/data/intake';

import type { LoadedSet } from '~/domain/catalog';
import type { SavedDeck } from '~/domain/decks';
import type { PreconCatalogEntry } from '~/domain/precons';
import type { SetKey } from '~/domain/types';
import { useToast } from '~/ui/toastContext';

import { DeckCheck } from './DeckCheck';
import styles from './DecksPage.module.css';
import { PickListDialog } from './PickListDialog';
import { PreconList } from './PreconList';
import { SavedDecks } from './SavedDecks';
import { useDeckCollection, type OwnershipBySet } from './useDeckCollection';
import { useDeckLibrary } from './useDeckLibrary';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  binderOwnership: OwnershipBySet;
  precons: PreconCatalogEntry[];
};

export function DecksPage({ sets, binderOwnership, precons }: Props) {
  const deckLibrary = useDeckLibrary();
  const { library, loading } = deckLibrary;
  const showToast = useToast();
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [pickList, setPickList] = useState<{
    id: string;
    mode: 'construct' | 'deconstruct';
  } | null>(null);

  const { lookup, setOrder, owned, homes, pullable, quotaOf } = useDeckCollection(
    sets,
    binderOwnership,
    library,
  );

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
        homes={homes}
        pullable={pullable}
        onUpdate={(id, patch) => void deckLibrary.updateDeck(id, patch)}
        onDelete={onDelete}
        onOpenPickList={(deck, mode) => setPickList({ id: deck.id, mode })}
        onQueue={(deck) => void onQueue(deck)}
        onImport={() => setImporting(true)}
        onAdjustBox={(deck, row, delta, max) =>
          void deckLibrary.adjustBox(deck.id, row.setKey, row.baseNumber, delta, max, homes)
        }
      />

      {importing && (
        <DeckCheck
          sets={sets}
          lookup={lookup}
          owned={owned}
          onSave={deckLibrary.addDeck}
          onClose={() => setImporting(false)}
        />
      )}

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
          homes={homes}
          quotaOf={quotaOf}
          onClose={() => setPickList(null)}
          onConstruct={(pulls, takes) =>
            void deckLibrary.construct(pickListDeck.id, pulls, takes, homes)
          }
          onDeconstruct={() => deckLibrary.deconstruct(pickListDeck.id, quotaOf)}
        />
      )}
    </div>
  );
}
