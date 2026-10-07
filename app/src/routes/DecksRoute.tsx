import type { LoadedSet } from '~/domain/catalog';
import type { PreconCatalogEntry } from '~/domain/precons';
import type { SetKey } from '~/domain/types';
import { DeckEditorPage } from '~/features/decks/DeckEditorPage';
import { DecksPage } from '~/features/decks/DecksPage';
import { NewDeckPage } from '~/features/decks/NewDeckPage';
import { useOwnershipBySet } from '~/features/decks/useDeckCollection';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  precons: PreconCatalogEntry[];
};

export function DecksRoute({ sets, precons }: Props) {
  return <DecksPage sets={sets} binderOwnership={useOwnershipBySet()} precons={precons} />;
}

export function DeckEditRoute({ sets, deckId }: { sets: Map<SetKey, LoadedSet>; deckId: string }) {
  return <DeckEditorPage sets={sets} binderOwnership={useOwnershipBySet()} deckId={deckId} />;
}

export function NewDeckRoute({ sets }: { sets: Map<SetKey, LoadedSet> }) {
  return <NewDeckPage sets={sets} binderOwnership={useOwnershipBySet()} />;
}
