import type { DeckLibrary, SavedDeck } from './decks';

/**
 * How two devices' copies combine when both changed since they last agreed.
 *
 * Both are three-way: `base` is the last copy this device and the server agreed on, so a
 * change can be told apart from a value the other side simply never had.
 */

/**
 * Card counts, per printing: the server's count plus whatever this device changed since
 * the base. One device adding two copies while the other removes one keeps both edits.
 * Without a base (never synced), the higher count wins rather than adding them up twice.
 */
export function mergeInventory(
  local: Record<string, number>,
  remote: Record<string, number>,
  base: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base ?? {})]);
  for (const key of keys) {
    const merged = base
      ? (remote[key] ?? 0) + ((local[key] ?? 0) - (base[key] ?? 0))
      : Math.max(local[key] ?? 0, remote[key] ?? 0);
    if (merged > 0) out[key] = merged;
  }
  return out;
}

const newer = (a: string, b: string) => (Date.parse(a) || 0) >= (Date.parse(b) || 0);

/**
 * Deck libraries, per deck: a deck changed on both sides keeps the more recent edit; a
 * deck deleted on either side stays deleted unless it was edited after the deletion.
 * Precon ownership keeps this device's choice where it changed, else the server's.
 */
export function mergeDeckLibraries(
  local: DeckLibrary,
  remote: DeckLibrary,
  base: DeckLibrary | undefined,
): DeckLibrary {
  const deletedDecks: Record<string, string> = { ...remote.deletedDecks };
  for (const [id, at] of Object.entries(local.deletedDecks ?? {})) {
    const other = deletedDecks[id];
    if (!other || newer(at, other)) deletedDecks[id] = at;
  }

  const order: string[] = [];
  const byId = new Map<string, SavedDeck>();
  for (const deck of [...local.customDecks, ...remote.customDecks]) {
    const seen = byId.get(deck.id);
    if (!seen) order.push(deck.id);
    if (!seen || !newer(seen.updatedAt, deck.updatedAt)) byId.set(deck.id, deck);
  }

  const customDecks = order
    .map((id) => byId.get(id)!)
    .filter((deck) => {
      const deletedAt = deletedDecks[deck.id];
      return !deletedAt || !newer(deletedAt, deck.updatedAt);
    });
  // A deck that survives was edited after its deletion; its deletion no longer applies.
  for (const deck of customDecks) delete deletedDecks[deck.id];

  const preconOwnership: Record<string, number> = { ...remote.preconOwnership };
  for (const [key, value] of Object.entries(local.preconOwnership)) {
    if ((base?.preconOwnership[key] ?? 0) !== value || !(key in preconOwnership)) {
      preconOwnership[key] = value;
    }
  }

  return Object.keys(deletedDecks).length
    ? { customDecks, preconOwnership, deletedDecks }
    : { customDecks, preconOwnership };
}
