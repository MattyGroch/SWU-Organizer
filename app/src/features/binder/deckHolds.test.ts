import { describe, expect, it } from 'vitest';

import { allDecksTitle, pocketDeckNames } from './deckHolds';

const decks = [
  { deckId: 'b', name: 'Sabine Rush', binder: 1, bulk: 1 },
  { deckId: 'a', name: 'Vader Aggro', binder: 1, bulk: 0 },
  { deckId: 'c', name: 'Bulk Only', binder: 0, bulk: 2 },
];

describe('deck names', () => {
  it('lists every deck for the Decks column, noting bulk copies', () => {
    expect(allDecksTitle(decks)).toBe(
      'Sabine Rush ×2 (1 from bulk)\nVader Aggro\nBulk Only ×2 (from bulk)',
    );
    expect(allDecksTitle([])).toBeUndefined();
  });

  it('names only decks holding binder copies for a pocket', () => {
    expect(pocketDeckNames(decks)).toBe('Sabine Rush, Vader Aggro');
  });
});
