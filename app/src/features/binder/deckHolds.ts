import type { DeckHold } from '~/domain/deckBuild';

/** "Vader Aggro ×2, Sabine Rush" — the decks holding a pocket's missing copies. */
export function pocketDeckNames(decks: readonly DeckHold[]): string {
  return decks
    .filter((d) => d.binder > 0)
    .map((d) => (d.binder > 1 ? `${d.name} ×${d.binder}` : d.name))
    .join(', ');
}

/** Every deck holding a card, one per line, noting copies from the bulk box. */
export function allDecksTitle(decks: readonly DeckHold[]): string | undefined {
  if (!decks.length) return undefined;
  return decks
    .map((d) => {
      const count = d.binder + d.bulk;
      const bulk = d.bulk ? ` (${d.binder ? `${d.bulk} ` : ''}from bulk)` : '';
      return `${d.name}${count > 1 ? ` ×${count}` : ''}${bulk}`;
    })
    .join('\n');
}

/** The ⇢N badge's tooltip: how many are out, then one deck per line. */
export function pocketDecksTitle(count: number, decks: readonly DeckHold[]): string {
  const lines = decks
    .filter((d) => d.binder > 0)
    .map((d) => (d.binder > 1 ? `${d.name} ×${d.binder}` : d.name));
  return (
    `${count} missing from this pocket, out in built decks` +
    (lines.length ? `:\n${lines.join('\n')}` : '')
  );
}
